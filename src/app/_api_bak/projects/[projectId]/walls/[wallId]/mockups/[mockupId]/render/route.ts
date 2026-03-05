import { NextRequest, NextResponse } from 'next/server';
import { getProject, getWallImage, getMuralImage, saveMockupRender, getMockupRender } from '@/lib/storage';
import sharp from 'sharp';
import path from 'path';
import type { Region, SolidColorFill, MuralImageFill } from '@/lib/types';

type RouteParams = {
  params: Promise<{ projectId: string; wallId: string; mockupId: string }>;
};

function parseHex(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function pointsToSvgPath(points: { x: number; y: number }[], w: number, h: number, offX = 0, offY = 0): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x * w - offX},${p.y * h - offY}`)
    .join(' ') + ' Z';
}

async function buildColorOverlay(
  region: Region,
  fill: SolidColorFill,
  imgW: number,
  imgH: number,
): Promise<sharp.OverlayOptions | null> {
  const { r, g, b } = parseHex(fill.color);
  const a = region.opacity;
  const geo = region.geometry;
  let svgBody: string;

  switch (geo.type) {
    case 'rectangle': {
      const x = geo.x * imgW, y = geo.y * imgH;
      const w = geo.width * imgW, h = geo.height * imgH;
      svgBody = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(${r},${g},${b},${a})"/>`;
      break;
    }
    case 'polygon':
      if (geo.points.length < 3) return null;
      svgBody = `<path d="${pointsToSvgPath(geo.points, imgW, imgH)}" fill="rgba(${r},${g},${b},${a})"/>`;
      break;
    case 'whole-wall':
      svgBody = `<rect x="0" y="0" width="${imgW}" height="${imgH}" fill="rgba(${r},${g},${b},${a})"/>`;
      break;
    case 'quad':
      svgBody = `<path d="${pointsToSvgPath(geo.corners, imgW, imgH)}" fill="rgba(${r},${g},${b},${a})"/>`;
      break;
    case 'brush': {
      if (geo.points.length < 2) return null;
      const sw = (geo.strokeWidth || 0.02) * Math.min(imgW, imgH);
      const d = geo.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x * imgW},${p.y * imgH}`).join(' ');
      svgBody = `<path d="${d}" stroke="rgba(${r},${g},${b},${a})" stroke-width="${sw}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
      break;
    }
    default:
      return null;
  }

  const svg = `<svg width="${imgW}" height="${imgH}" xmlns="http://www.w3.org/2000/svg">${svgBody}</svg>`;
  return {
    input: Buffer.from(svg),
    blend: region.blendMode === 'normal' ? 'over' : (region.blendMode as sharp.Blend),
  };
}

async function buildMuralOverlay(
  region: Region,
  fill: MuralImageFill,
  imgW: number,
  imgH: number,
  projectId: string,
  muralExt: string,
): Promise<sharp.OverlayOptions | null> {
  const muralBuf = await getMuralImage(projectId, fill.muralId, muralExt);
  if (!muralBuf) return null;

  const geo = region.geometry;
  let clipX = 0, clipY = 0, clipW = imgW, clipH = imgH;
  let svgClip: string;

  switch (geo.type) {
    case 'rectangle':
      clipX = Math.round(geo.x * imgW);
      clipY = Math.round(geo.y * imgH);
      clipW = Math.round(geo.width * imgW);
      clipH = Math.round(geo.height * imgH);
      svgClip = `M0,0 L${clipW},0 L${clipW},${clipH} L0,${clipH} Z`;
      break;
    case 'polygon':
      if (geo.points.length < 3) return null;
      clipX = Math.round(Math.min(...geo.points.map((p) => p.x)) * imgW);
      clipY = Math.round(Math.min(...geo.points.map((p) => p.y)) * imgH);
      clipW = Math.round(Math.max(...geo.points.map((p) => p.x)) * imgW - clipX);
      clipH = Math.round(Math.max(...geo.points.map((p) => p.y)) * imgH - clipY);
      svgClip = pointsToSvgPath(geo.points, imgW, imgH, clipX, clipY);
      break;
    case 'whole-wall':
      svgClip = `M0,0 L${imgW},0 L${imgW},${imgH} L0,${imgH} Z`;
      break;
    case 'quad':
      clipX = Math.round(Math.min(...geo.corners.map((c) => c.x)) * imgW);
      clipY = Math.round(Math.min(...geo.corners.map((c) => c.y)) * imgH);
      clipW = Math.round(Math.max(...geo.corners.map((c) => c.x)) * imgW - clipX);
      clipH = Math.round(Math.max(...geo.corners.map((c) => c.y)) * imgH - clipY);
      svgClip = pointsToSvgPath(geo.corners, imgW, imgH, clipX, clipY);
      break;
    default:
      return null;
  }

  if (clipW <= 0 || clipH <= 0) return null;

  const fitMap: Record<string, keyof sharp.FitEnum> = {
    contain: 'contain', cover: 'cover', stretch: 'fill', tile: 'contain',
  };

  const resized = await sharp(muralBuf)
    .resize(clipW, clipH, { fit: fitMap[fill.fitMode] || 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const maskSvg = `<svg width="${clipW}" height="${clipH}" xmlns="http://www.w3.org/2000/svg"><path d="${svgClip}" fill="white"/></svg>`;

  const masked = await sharp(resized)
    .resize(clipW, clipH, { fit: 'fill' })
    .composite([{ input: Buffer.from(maskSvg), blend: 'dest-in' }])
    .ensureAlpha(region.opacity)
    .png()
    .toBuffer();

  return {
    input: masked,
    left: clipX,
    top: clipY,
    blend: region.blendMode === 'normal' ? 'over' : (region.blendMode as sharp.Blend),
  };
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { projectId, wallId, mockupId } = await params;

  // Try cached render first
  const cached = await getMockupRender(projectId, wallId, mockupId);
  if (cached) {
    return new NextResponse(cached as unknown as BodyInit, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=60' },
    });
  }

  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const wall = project.walls.find((w) => w.id === wallId);
  if (!wall) return NextResponse.json({ error: 'Wall not found' }, { status: 404 });

  const mockup = wall.mockups.find((m) => m.id === mockupId);
  if (!mockup) return NextResponse.json({ error: 'Mockup not found' }, { status: 404 });

  const wallBuf = await getWallImage(projectId, wallId, 'original.jpg');
  if (!wallBuf) return NextResponse.json({ error: 'Wall image not found' }, { status: 404 });

  const meta = await sharp(wallBuf).metadata();
  const imgW = meta.width || 1920;
  const imgH = meta.height || 1080;

  const visible = mockup.regions
    .filter((r) => r.visible && r.fill)
    .sort((a, b) => a.order - b.order);

  if (visible.length === 0) {
    const png = await sharp(wallBuf).png().toBuffer();
    return new NextResponse(png as unknown as BodyInit, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=60' },
    });
  }

  const overlays: sharp.OverlayOptions[] = [];
  for (const region of visible) {
    try {
      if (region.fill.type === 'solid-color') {
        const ov = await buildColorOverlay(region, region.fill, imgW, imgH);
        if (ov) overlays.push(ov);
      } else if (region.fill.type === 'mural-image') {
        const mural = project.murals.find((m) => m.id === (region.fill as MuralImageFill).muralId);
        if (!mural) continue;
        const ext = path.extname(mural.originalFileName) || '.png';
        const ov = await buildMuralOverlay(region, region.fill as MuralImageFill, imgW, imgH, projectId, ext);
        if (ov) overlays.push(ov);
      }
    } catch {
      // Skip failed regions
    }
  }

  const result = await sharp(wallBuf).composite(overlays).png().toBuffer();

  // Cache render (non-blocking)
  saveMockupRender(projectId, wallId, mockupId, result).catch(() => {});

  return new NextResponse(result as unknown as BodyInit, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=60' },
  });
}

/**
 * POST: Upload a client-rendered image, or invalidate cache.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { projectId, wallId, mockupId } = await params;
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    // Client uploading a rendered image
    const formData = await request.formData();
    const file = formData.get('render') as File;
    if (!file) return NextResponse.json({ error: 'No render provided' }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    await saveMockupRender(projectId, wallId, mockupId, buffer);
    return NextResponse.json({ success: true });
  }

  // JSON body = invalidate cache
  const fs = await import('fs/promises');
  const { mockupDir } = await import('@/lib/storage');
  const renderPath = path.join(mockupDir(projectId, wallId, mockupId), 'render.png');
  await fs.rm(renderPath, { force: true }).catch(() => {});
  return NextResponse.json({ status: 'invalidated' });
}
