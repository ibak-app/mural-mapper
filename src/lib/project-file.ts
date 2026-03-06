// Project file export/import — .mmp files are ZIP archives
// containing manifest.json + wall/mural image blobs

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { generateThumb } from '@/lib/image-cache';
import type { Wall, MuralPlacement, Corner, QuadSurface, MuralPoolEntry } from '@/App';

/* ------------------------------------------------------------------ */
/*  Manifest schema                                                    */
/* ------------------------------------------------------------------ */

interface ManifestMural {
  id: string;
  muralPoolId: string;
  imageFile: string;
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  rotationLocked: boolean;
  opacity: number;
  blendMode: string;
  clipLeft: number;
  clipRight: number;
  clipTop: number;
  clipBottom: number;
  comment: string;
  liked: boolean;
}

interface ManifestQuad {
  id: string;
  corners: [Corner, Corner, Corner, Corner];
  label?: string;
  linkId?: string;
  murals: ManifestMural[];
}

interface ManifestWall {
  id: string;
  imageFile: string;
  crop?: { x: number; y: number; w: number; h: number };
  quads: ManifestQuad[];
}

interface ManifestPoolEntry {
  id: string;
  imageFile: string;
}

interface ProjectManifest {
  version: 2;
  name: string;
  walls: ManifestWall[];
  muralPool: ManifestPoolEntry[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

function guessExt(file: File | Blob): string {
  const type = file.type || '';
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('gif')) return 'gif';
  if (type.includes('bmp')) return 'bmp';
  if (file instanceof File) {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext) return ext;
  }
  return 'jpg';
}

/* ------------------------------------------------------------------ */
/*  Export                                                              */
/* ------------------------------------------------------------------ */

export async function exportProject(
  name: string,
  walls: Wall[],
  muralPool: MuralPoolEntry[],
): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};

  // Track which mural pool blobs we've already added
  const poolBlobsAdded = new Set<string>();

  const manifestWalls: ManifestWall[] = [];

  for (const wall of walls) {
    // Add wall image
    const wallExt = guessExt(wall.file);
    const wallImageFile = `walls/${wall.id}.${wallExt}`;
    files[wallImageFile] = await blobToUint8Array(wall.blob);

    const manifestQuads: ManifestQuad[] = [];

    for (const quad of wall.quads) {
      const manifestMurals: ManifestMural[] = [];

      for (const mural of quad.murals) {
        // Add mural image (from file blob)
        const muralExt = guessExt(mural.file);
        const muralImageFile = `murals/${mural.id}.${muralExt}`;
        files[muralImageFile] = await blobToUint8Array(mural.file);

        manifestMurals.push({
          id: mural.id,
          muralPoolId: mural.muralPoolId,
          imageFile: muralImageFile,
          scale: mural.scale,
          offsetX: mural.offsetX,
          offsetY: mural.offsetY,
          rotation: mural.rotation ?? 0,
          rotationLocked: mural.rotationLocked ?? false,
          opacity: mural.opacity ?? 1,
          blendMode: (mural.blendMode as string) ?? 'source-over',
          clipLeft: mural.clipLeft ?? 0,
          clipRight: mural.clipRight ?? 0,
          clipTop: mural.clipTop ?? 0,
          clipBottom: mural.clipBottom ?? 0,
          comment: mural.comment ?? '',
          liked: mural.liked ?? false,
        });
      }

      manifestQuads.push({
        id: quad.id,
        corners: quad.corners,
        label: quad.label,
        linkId: quad.linkId,
        murals: manifestMurals,
      });
    }

    manifestWalls.push({
      id: wall.id,
      imageFile: wallImageFile,
      crop: wall.crop,
      quads: manifestQuads,
    });
  }

  // Add mural pool entries
  const manifestPool: ManifestPoolEntry[] = [];

  for (const entry of muralPool) {
    const ext = guessExt(entry.file);
    const poolImageFile = `pool/${entry.id}.${ext}`;
    if (!poolBlobsAdded.has(entry.id)) {
      files[poolImageFile] = await blobToUint8Array(entry.blob);
      poolBlobsAdded.add(entry.id);
    }
    manifestPool.push({
      id: entry.id,
      imageFile: poolImageFile,
    });
  }

  // Build manifest
  const manifest: ProjectManifest = {
    version: 2,
    name,
    walls: manifestWalls,
    muralPool: manifestPool,
  };

  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));

  // Create ZIP
  return zipSync(files, { level: 6 });
}

/* ------------------------------------------------------------------ */
/*  Import                                                             */
/* ------------------------------------------------------------------ */

export async function importProject(
  zipData: Uint8Array,
): Promise<{ name: string; walls: Wall[]; muralPool: MuralPoolEntry[] }> {
  const extracted = unzipSync(zipData);

  // Read manifest
  const manifestBytes = extracted['manifest.json'];
  if (!manifestBytes) throw new Error('Invalid .mmp file: missing manifest.json');
  const manifest: ProjectManifest = JSON.parse(strFromU8(manifestBytes));

  // Helper to get file data from zip
  function getFileData(path: string): Uint8Array {
    const data = extracted[path];
    if (!data) throw new Error(`Missing file in archive: ${path}`);
    return data;
  }

  function mimeFromExt(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() ?? 'jpg';
    const map: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
      bmp: 'image/bmp',
    };
    return map[ext] ?? 'image/jpeg';
  }

  // Reconstruct mural pool
  const muralPool: MuralPoolEntry[] = [];
  // Map pool entry id -> pool entry for mural reconstruction
  const poolMap = new Map<string, MuralPoolEntry>();

  for (const entry of manifest.muralPool) {
    const data = getFileData(entry.imageFile);
    const mime = mimeFromExt(entry.imageFile);
    const blob = new Blob([data as BlobPart], { type: mime });
    const file = new File([data as BlobPart], entry.imageFile.split('/').pop()!, { type: mime });
    const thumbUrl = await generateThumb(blob);

    const poolEntry: MuralPoolEntry = {
      id: entry.id,
      file,
      blob,
      thumbUrl,
    };
    muralPool.push(poolEntry);
    poolMap.set(entry.id, poolEntry);
  }

  // Reconstruct walls
  const walls: Wall[] = [];

  for (const mWall of manifest.walls) {
    const wallData = getFileData(mWall.imageFile);
    const wallMime = mimeFromExt(mWall.imageFile);
    const wallBlob = new Blob([wallData as BlobPart], { type: wallMime });
    const wallFile = new File([wallData as BlobPart], mWall.imageFile.split('/').pop()!, { type: wallMime });
    const wallThumb = await generateThumb(wallBlob);

    const quads: QuadSurface[] = [];

    for (const mQuad of mWall.quads) {
      const murals: MuralPlacement[] = [];

      for (const mMural of mQuad.murals) {
        const muralData = getFileData(mMural.imageFile);
        const muralMime = mimeFromExt(mMural.imageFile);
        const muralFile = new File([muralData as BlobPart], mMural.imageFile.split('/').pop()!, { type: muralMime });
        const muralThumb = await generateThumb(muralFile);

        murals.push({
          id: mMural.id,
          muralPoolId: mMural.muralPoolId,
          file: muralFile,
          thumbUrl: muralThumb,
          scale: mMural.scale,
          offsetX: mMural.offsetX,
          offsetY: mMural.offsetY,
          rotation: mMural.rotation,
          rotationLocked: mMural.rotationLocked,
          opacity: mMural.opacity,
          blendMode: mMural.blendMode as GlobalCompositeOperation,
          clipLeft: mMural.clipLeft,
          clipRight: mMural.clipRight,
          clipTop: mMural.clipTop,
          clipBottom: mMural.clipBottom,
          comment: mMural.comment,
          liked: mMural.liked,
        });
      }

      quads.push({
        id: mQuad.id,
        corners: mQuad.corners,
        label: mQuad.label,
        linkId: mQuad.linkId,
        murals,
      });
    }

    walls.push({
      id: mWall.id,
      file: wallFile,
      thumbUrl: wallThumb,
      blob: wallBlob,
      crop: mWall.crop,
      quads,
    });
  }

  return { name: manifest.name, walls, muralPool };
}
