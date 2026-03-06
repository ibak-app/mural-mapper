import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { MessageSquare, Download, FileDown, Loader2, Heart, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getFullBitmap } from '@/lib/image-cache';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import jsPDF from 'jspdf';
import type { Wall, MuralPlacement, Corner } from '@/App';

interface PresentTabProps {
  walls: Wall[];
  onWallsChange: (walls: Wall[], changedIdx?: number) => void;
}

/* ------------------------------------------------------------------ */
/*  Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

function dist(a: Corner, b: Corner): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerp(a: Corner, b: Corner, t: number): Corner {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function bilerp(
  tl: Corner,
  tr: Corner,
  br: Corner,
  bl: Corner,
  u: number,
  v: number,
): Corner {
  const top = lerp(tl, tr, u);
  const bot = lerp(bl, br, u);
  return lerp(top, bot, v);
}

/* ------------------------------------------------------------------ */
/*  Clip mask helper                                                   */
/* ------------------------------------------------------------------ */

function applyClipMask(
  ctx: CanvasRenderingContext2D,
  clipLeft: number,
  clipRight: number,
  clipTop: number,
  clipBottom: number,
  quad: [Corner, Corner, Corner, Corner],
) {
  if (clipLeft <= 0 && clipRight <= 0 && clipTop <= 0 && clipBottom <= 0) return;
  const [tl, tr, br, bl] = quad;
  const u0 = Math.min(clipLeft, 0.45);
  const u1 = 1 - Math.min(clipRight, 0.45);
  const v0 = Math.min(clipTop, 0.45);
  const v1 = 1 - Math.min(clipBottom, 0.45);
  const c00 = bilerp(tl, tr, br, bl, u0, v0);
  const c10 = bilerp(tl, tr, br, bl, u1, v0);
  const c11 = bilerp(tl, tr, br, bl, u1, v1);
  const c01 = bilerp(tl, tr, br, bl, u0, v1);
  ctx.beginPath();
  ctx.moveTo(c00.x, c00.y);
  ctx.lineTo(c10.x, c10.y);
  ctx.lineTo(c11.x, c11.y);
  ctx.lineTo(c01.x, c01.y);
  ctx.closePath();
  ctx.clip();
}

/* ------------------------------------------------------------------ */
/*  Canvas drawing                                                     */
/* ------------------------------------------------------------------ */

const GRID = 8;

/**
 * Draw `muralBitmap` warped into the quad on the given context.
 * Uses triangle-subdivision with an 8x8 grid for bilinear interpolation.
 */
function drawWarpedMural(
  ctx: CanvasRenderingContext2D,
  muralBitmap: ImageBitmap,
  quad: [Corner, Corner, Corner, Corner],
  scale: number,
  offsetX: number,
  offsetY: number,
  rotation: number,
  toCanvas: (pt: Corner) => Corner,
  quadAspect: number,
) {
  const [tl, tr, br, bl] = quad;
  const mw = muralBitmap.width;
  const mh = muralBitmap.height;
  const muralAspect = mw / mh;

  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const cx = 0.5 + offsetX / 100;
  const cy = 0.5 + offsetY / 100;

  // Map quad UV to mural pixel coords, corrected for quad aspect ratio
  const mapUV = (u: number, v: number) => {
    const rx = u - cx;
    const ry = v - cy;
    const lx = rx * cosR + ry * sinR;
    const ly = -rx * sinR + ry * cosR;
    return {
      sx: (lx / scale + 0.5) * mw,
      sy: (ly * (muralAspect / quadAspect) / scale + 0.5) * mh,
    };
  };

  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const u0 = col / GRID;
      const v0 = row / GRID;
      const u1 = (col + 1) / GRID;
      const v1 = (row + 1) / GRID;

      const d00 = toCanvas(bilerp(tl, tr, br, bl, u0, v0));
      const d10 = toCanvas(bilerp(tl, tr, br, bl, u1, v0));
      const d01 = toCanvas(bilerp(tl, tr, br, bl, u0, v1));
      const d11 = toCanvas(bilerp(tl, tr, br, bl, u1, v1));

      const s00 = mapUV(u0, v0);
      const s10 = mapUV(u1, v0);
      const s01 = mapUV(u0, v1);
      const s11 = mapUV(u1, v1);

      drawAffineTriangle(ctx, muralBitmap,
        s00.sx, s00.sy, s10.sx, s10.sy, s01.sx, s01.sy,
        d00.x, d00.y, d10.x, d10.y, d01.x, d01.y,
      );
      drawAffineTriangle(ctx, muralBitmap,
        s10.sx, s10.sy, s11.sx, s11.sy, s01.sx, s01.sy,
        d10.x, d10.y, d11.x, d11.y, d01.x, d01.y,
      );
    }
  }
}

/**
 * Draw a textured triangle using affine transform.
 * Maps source triangle (s0,s1,s2) to dest triangle (d0,d1,d2).
 */
function drawAffineTriangle(
  ctx: CanvasRenderingContext2D,
  img: ImageBitmap,
  sx0: number, sy0: number, sx1: number, sy1: number, sx2: number, sy2: number,
  dx0: number, dy0: number, dx1: number, dy1: number, dx2: number, dy2: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dx0, dy0);
  ctx.lineTo(dx1, dy1);
  ctx.lineTo(dx2, dy2);
  ctx.closePath();
  ctx.clip();

  const denom = (sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1));
  if (Math.abs(denom) < 1e-10) { ctx.restore(); return; }

  const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) / denom;
  const b = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) / denom;
  const c = (dx0 * (sx1 * sy2 - sx2 * sy1) + dx1 * (sx2 * sy0 - sx0 * sy2) + dx2 * (sx0 * sy1 - sx1 * sy0)) / denom;
  const d = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) / denom;
  const e = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) / denom;
  const f = (dy0 * (sx1 * sy2 - sx2 * sy1) + dy1 * (sx2 * sy0 - sx0 * sy2) + dy2 * (sx0 * sy1 - sx1 * sy0)) / denom;

  ctx.transform(a, d, b, e, c, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/*  PresentTab                                                         */
/* ------------------------------------------------------------------ */

export function PresentTab({ walls, onWallsChange }: PresentTabProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wallListRef = useRef<HTMLDivElement>(null);

  const [wallIdx, setWallIdx] = useState(0);
  const [muralIdx, setMuralIdx] = useState(0);
  const [showComment, setShowComment] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [showWallsSidebar, setShowWallsSidebar] = useState(true);
  const [showMuralsSidebar, setShowMuralsSidebar] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  const [includeAllWalls, setIncludeAllWalls] = useState(false);
  const [showPdfMenu, setShowPdfMenu] = useState(false);

  type PdfExportMode = 'all' | 'liked' | 'murals-only' | 'current-wall';

  const wallIdxRef = useRef(wallIdx);
  wallIdxRef.current = wallIdx;
  const muralIdxRef = useRef(muralIdx);
  muralIdxRef.current = muralIdx;

  /* ---- filter to presentable walls -------------------------------- */

  const presentable = useMemo(
    () => {
      const all = walls.map((w, origIdx) => ({ wall: w, origIdx }));
      if (includeAllWalls) return all;
      return all.filter((e) => e.wall.quads.some(q => q.corners && q.murals.length > 0));
    },
    [walls, includeAllWalls],
  );

  const presentableRef = useRef(presentable);
  presentableRef.current = presentable;

  /* clamp indices when presentable changes */
  useEffect(() => {
    if (presentable.length === 0) return;
    setWallIdx((prev) => Math.min(prev, presentable.length - 1));
  }, [presentable.length]);

  useEffect(() => {
    if (presentable.length === 0) return;
    const entry = presentable[wallIdx];
    if (!entry) return;
    // Get murals from first quad with murals
    const firstQuadWithMurals = entry.wall.quads.find(q => q.murals.length > 0);
    const maxMural = (firstQuadWithMurals?.murals.length ?? 1) - 1;
    setMuralIdx((prev) => Math.min(prev, Math.max(0, maxMural)));
  }, [wallIdx, presentable]);

  /* sync comment text when selection changes */
  const currentEntry = presentable[wallIdx];
  const currentQuad = currentEntry?.wall.quads.find(q => q.murals.length > 0);
  const currentMural = currentQuad?.murals[muralIdx];

  useEffect(() => {
    setCommentText(currentMural?.comment ?? '');
    setShowComment(false);
  }, [currentMural?.id]);

  /* ---- canvas draw ------------------------------------------------ */

  const redraw = useCallback(async () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    const entry = presentableRef.current[wallIdxRef.current];
    if (!entry) return;

    const wall = entry.wall;
    const currentMuralIdx = muralIdxRef.current;

    // Draw wall image fitted
    let wallBitmap: ImageBitmap;
    try {
      wallBitmap = await getFullBitmap(wall.blob);
    } catch {
      // Draw error placeholder
      ctx.fillStyle = '#333';
      ctx.fillRect(0, 0, cw, ch);
      ctx.fillStyle = '#888';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Failed to load wall image', cw / 2, ch / 2);
      return;
    }

    const crop = wall.crop;
    const sx = crop?.x ?? 0;
    const sy = crop?.y ?? 0;
    const sw = crop?.w ?? wallBitmap.width;
    const sh = crop?.h ?? wallBitmap.height;

    const padding = 0; // full-screen presentation
    const availW = cw - padding * 2;
    const availH = ch - padding * 2;
    const fitScale = Math.min(availW / sw, availH / sh);
    const dw = sw * fitScale;
    const dh = sh * fitScale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;

    ctx.drawImage(wallBitmap, sx, sy, sw, sh, dx, dy, dw, dh);

    // Transform quad from normalized 0-1 space to canvas-space
    const toCanvas = (pt: Corner): Corner => ({
      x: dx + pt.x * dw,
      y: dy + pt.y * dh,
    });

    // Draw ALL quads with their murals
    for (const quadObj of wall.quads) {
      const mural = quadObj.murals[Math.min(currentMuralIdx, quadObj.murals.length - 1)];
      if (!mural || !quadObj.corners) continue;

      try {
        const muralBitmap = await getFullBitmap(mural.file);

        const quadCanvasPts = quadObj.corners.map(toCanvas);
        const qw = (dist(quadCanvasPts[0], quadCanvasPts[1]) + dist(quadCanvasPts[3], quadCanvasPts[2])) / 2;
        const qh = (dist(quadCanvasPts[0], quadCanvasPts[3]) + dist(quadCanvasPts[1], quadCanvasPts[2])) / 2;
        const quadAspect = qh > 0 ? qw / qh : 1;

        const clipL = mural.clipLeft ?? 0;
        const clipR = mural.clipRight ?? 0;
        const clipT = mural.clipTop ?? 0;
        const clipB = mural.clipBottom ?? 0;
        if (clipL > 0 || clipR > 0 || clipT > 0 || clipB > 0) {
          const quadCanvasCorners = quadObj.corners.map(toCanvas) as [Corner, Corner, Corner, Corner];
          ctx.save();
          applyClipMask(ctx, clipL, clipR, clipT, clipB, quadCanvasCorners);
        }

        drawWarpedMural(
          ctx,
          muralBitmap,
          quadObj.corners,
          mural.scale,
          mural.offsetX,
          mural.offsetY,
          mural.rotation ?? 0,
          toCanvas,
          quadAspect,
        );

        if (clipL > 0 || clipR > 0 || clipT > 0 || clipB > 0) {
          ctx.restore();
        }
      } catch (err) {
        console.warn('Failed to render quad mural:', err);
      }
    }
  }, []);

  /* redraw on selection change */
  useLayoutEffect(() => {
    redraw();
  }, [wallIdx, muralIdx, walls, redraw]);

  /* auto-scroll sidebar to selected wall */
  useEffect(() => {
    const list = wallListRef.current;
    if (!list) return;
    const el = list.children[wallIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [wallIdx]);

  /* ResizeObserver */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [redraw]);

  /* ---- keyboard navigation ---------------------------------------- */

  useEffect(() => {
    let rafId: number | null = null;
    let pendingWall: number | null = null;
    let pendingMural: number | null = null;

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      let wallDir = 0;
      let muralDir = 0;

      if (e.key === 'ArrowUp') wallDir = -1;
      if (e.key === 'ArrowDown') wallDir = 1;
      if (e.key === 'ArrowLeft') muralDir = -1;
      if (e.key === 'ArrowRight') muralDir = 1;

      if (wallDir === 0 && muralDir === 0) return;
      e.preventDefault();

      if (pendingWall === null && pendingMural === null) {
        pendingWall = wallDir;
        pendingMural = muralDir;
        rafId = requestAnimationFrame(() => {
          const pres = presentableRef.current;
          if (pres.length === 0) {
            pendingWall = null;
            pendingMural = null;
            return;
          }

          if (pendingWall !== null && pendingWall !== 0) {
            const cur = wallIdxRef.current;
            const next = Math.max(0, Math.min(pres.length - 1, cur + pendingWall));
            if (next !== cur) {
              setWallIdx(next);
              setMuralIdx(0);
            }
          }

          if (pendingMural !== null && pendingMural !== 0) {
            const wIdx = wallIdxRef.current;
            const entry = pres[wIdx];
            if (entry) {
              const cur = muralIdxRef.current;
              const fq = entry.wall.quads.find(q => q.murals.length > 0);
              const max = (fq?.murals.length ?? 1) - 1;
              const next = Math.max(0, Math.min(max, cur + pendingMural));
              if (next !== cur) setMuralIdx(next);
            }
          }

          pendingWall = null;
          pendingMural = null;
        });
      } else {
        if (wallDir !== 0) pendingWall = (pendingWall ?? 0) + wallDir;
        if (muralDir !== 0) pendingMural = (pendingMural ?? 0) + muralDir;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  /* ---- like toggle ------------------------------------------------ */

  const toggleLike = useCallback(() => {
    if (!currentEntry || !currentMural) return;
    const next = [...walls];
    const wIdx = currentEntry.origIdx;
    const w = { ...next[wIdx] };
    const qIdx = w.quads.findIndex(q => q.murals.length > 0);
    if (qIdx < 0) return;
    const quads = [...w.quads];
    const quad = { ...quads[qIdx] };
    const murals = [...quad.murals];
    murals[muralIdx] = { ...murals[muralIdx], liked: !murals[muralIdx].liked };
    quad.murals = murals;
    quads[qIdx] = quad;
    w.quads = quads;
    next[wIdx] = w;
    onWallsChange(next);
  }, [walls, onWallsChange, currentEntry, currentMural, muralIdx]);

  /* ---- comment save ----------------------------------------------- */

  const saveComment = useCallback(
    (text: string) => {
      if (!currentEntry) return;
      const next = [...walls];
      const wIdx = currentEntry.origIdx;
      const w = { ...next[wIdx] };
      const qIdx = w.quads.findIndex(q => q.murals.length > 0);
      if (qIdx < 0) return;
      const quads = [...w.quads];
      const quad = { ...quads[qIdx] };
      const murals = [...quad.murals];
      murals[muralIdx] = { ...murals[muralIdx], comment: text };
      quad.murals = murals;
      quads[qIdx] = quad;
      w.quads = quads;
      next[wIdx] = w;
      onWallsChange(next);
    },
    [walls, onWallsChange, currentEntry, muralIdx],
  );

  /* ---- render a single wall+mural to an offscreen canvas ----------- */

  const renderComposite = useCallback(async (
    wall: Wall,
    mural: MuralPlacement,
    quadCorners?: [Corner, Corner, Corner, Corner],
  ): Promise<HTMLCanvasElement> => {
    const wallBitmap = await getFullBitmap(wall.blob);
    const crop = wall.crop;
    const sx = crop?.x ?? 0;
    const sy = crop?.y ?? 0;
    const sw = crop?.w ?? wallBitmap.width;
    const sh = crop?.h ?? wallBitmap.height;

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(wallBitmap, sx, sy, sw, sh, 0, 0, sw, sh);

    const corners = quadCorners ?? wall.quads.find(q => q.murals.length > 0)?.corners;
    if (mural && corners) {
      const muralBitmap = await getFullBitmap(mural.file);
      const toCanvas = (pt: Corner): Corner => ({
        x: pt.x * sw,
        y: pt.y * sh,
      });
      const quadCanvasPts = corners.map(toCanvas);
      const qw = (dist(quadCanvasPts[0], quadCanvasPts[1]) + dist(quadCanvasPts[3], quadCanvasPts[2])) / 2;
      const qh = (dist(quadCanvasPts[0], quadCanvasPts[3]) + dist(quadCanvasPts[1], quadCanvasPts[2])) / 2;
      const quadAspect = qh > 0 ? qw / qh : 1;

      const clipL = mural.clipLeft ?? 0;
      const clipR = mural.clipRight ?? 0;
      const clipT = mural.clipTop ?? 0;
      const clipB = mural.clipBottom ?? 0;
      if (clipL > 0 || clipR > 0 || clipT > 0 || clipB > 0) {
        const quadCanvasCorners = corners.map(toCanvas) as [Corner, Corner, Corner, Corner];
        ctx.save();
        applyClipMask(ctx, clipL, clipR, clipT, clipB, quadCanvasCorners);
      }

      drawWarpedMural(
        ctx, muralBitmap, corners,
        mural.scale, mural.offsetX, mural.offsetY,
        mural.rotation ?? 0, toCanvas, quadAspect,
      );

      if (clipL > 0 || clipR > 0 || clipT > 0 || clipB > 0) {
        ctx.restore();
      }
    }
    return canvas;
  }, []);

  /* ---- export single PNG ------------------------------------------ */

  const handleExportPNG = useCallback(async () => {
    const entry = presentable[wallIdx];
    const fq = entry?.wall.quads.find(q => q.murals.length > 0);
    const mural = fq?.murals[muralIdx];
    if (!entry || !mural) return;

    setExporting(true);
    setExportProgress('Rendering...');
    try {
      // Ask user where to save via Tauri dialog
      let filePath: string | null = null;
      try {
        filePath = await save({
          defaultPath: `wall-${wallIdx + 1}-mural-${muralIdx + 1}.png`,
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
        });
      } catch (dialogErr) {
        console.warn('Tauri save dialog failed, falling back to browser download:', dialogErr);
      }

      const canvas = await renderComposite(entry.wall, mural, fq?.corners);
      const blob = await new Promise<Blob>((res) =>
        canvas.toBlob((b) => res(b!), 'image/png'),
      );

      if (filePath) {
        // Tauri path: write directly to filesystem
        const bytes = new Uint8Array(await blob.arrayBuffer());
        await writeFile(filePath, bytes);
        setExportProgress('Saved!');
      } else {
        // Fallback: browser download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wall-${wallIdx + 1}-mural-${muralIdx + 1}.png`;
        a.click();
        URL.revokeObjectURL(url);
        setExportProgress('Downloaded!');
      }
      setTimeout(() => setExportProgress(''), 2000);
    } catch (err) {
      console.error('PNG export failed:', err);
      setExportProgress('Export failed');
      setTimeout(() => setExportProgress(''), 3000);
    } finally {
      setExporting(false);
    }
  }, [presentable, wallIdx, muralIdx, renderComposite]);

  /* ---- export all as PDF ------------------------------------------ */

  /** Render an image (bitmap/canvas) as a full page in the PDF */
  const addImagePage = (
    pdf: InstanceType<typeof jsPDF>,
    imgData: string,
    cw: number,
    ch: number,
    pageIdx: number,
    label?: string,
    isLiked?: boolean,
  ) => {
    const orientation = cw >= ch ? 'landscape' : 'portrait';
    const pageW = orientation === 'landscape' ? 297 : 210;
    const pageH = orientation === 'landscape' ? 210 : 297;
    const margin = 8; // mm margin for label
    const availH = pageH - (label ? margin + 6 : 0);
    const scale = Math.min(pageW / cw, availH / ch);
    const imgW = cw * scale;
    const imgH = ch * scale;
    const offX = (pageW - imgW) / 2;
    const offY = (availH - imgH) / 2;

    if (pageIdx === 0) {
      // First page: delete the default page and add one with correct orientation
      pdf.deletePage(1);
      pdf.addPage([pageW, pageH], orientation);
    } else {
      pdf.addPage([pageW, pageH], orientation);
    }
    pdf.addImage(imgData, 'JPEG', offX, offY, imgW, imgH);

    // Label at bottom
    if (label) {
      pdf.setFontSize(9);
      pdf.setTextColor(120, 120, 120);
      pdf.text(label, pageW / 2, pageH - 4, { align: 'center' });
    }

    // Heart marker for liked
    if (isLiked) {
      pdf.setFontSize(14);
      pdf.setTextColor(220, 50, 50);
      pdf.text('\u2665', pageW - 10, 10);
    }
  };

  const handleExportPDF = useCallback(async (mode: PdfExportMode = 'all') => {
    if (presentable.length === 0) return;
    setShowPdfMenu(false);

    // Build list of (wall entry, mural) pairs based on mode
    const items: { entry: typeof presentable[0]; wi: number; mural: typeof presentable[0]['wall']['quads'][0]['murals'][0]; mi: number; corners: typeof presentable[0]['wall']['quads'][0]['corners'] }[] = [];

    const wallsToExport = mode === 'current-wall' ? [{ entry: presentable[wallIdx], wi: wallIdx }] : presentable.map((entry, wi) => ({ entry, wi }));

    for (const { entry, wi } of wallsToExport) {
      const fq = entry.wall.quads.find(q => q.murals.length > 0);
      if (!fq) continue;
      for (let mi = 0; mi < fq.murals.length; mi++) {
        const mural = fq.murals[mi];
        if (mode === 'liked' && !mural.liked) continue;
        items.push({ entry, wi, mural, mi, corners: fq.corners });
      }
    }

    if (items.length === 0) {
      setExportProgress(mode === 'liked' ? 'No liked murals found' : 'Nothing to export');
      setTimeout(() => setExportProgress(''), 2000);
      return;
    }

    // Count total pages
    let totalPages = 0;
    for (const item of items) {
      if (mode !== 'murals-only') totalPages++; // composite page
      if (item.mural.liked || mode === 'murals-only') totalPages++; // original mural page
    }

    setExporting(true);
    setExportProgress(`Rendering page 1/${totalPages}...`);

    try {
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      let pageIdx = 0;

      for (const { entry, wi, mural, mi, corners } of items) {
        // Composite page (wall + warped mural) — skip in murals-only mode
        if (mode !== 'murals-only') {
          setExportProgress(`Rendering page ${pageIdx + 1}/${totalPages}...`);
          const canvas = await renderComposite(entry.wall, mural, corners);
          const imgData = canvas.toDataURL('image/jpeg', 0.92);
          const label = `Wall ${wi + 1} — Alternative ${mi + 1}${mural.comment ? ` — ${mural.comment}` : ''}`;
          addImagePage(pdf, imgData, canvas.width, canvas.height, pageIdx, label, mural.liked);
          pageIdx++;
        }

        // Original mural source page — for liked items, or always in murals-only mode
        if (mural.liked || mode === 'murals-only') {
          setExportProgress(`Rendering page ${pageIdx + 1}/${totalPages}...`);
          const muralBitmap = await getFullBitmap(mural.file);
          const muralCanvas = document.createElement('canvas');
          muralCanvas.width = muralBitmap.width;
          muralCanvas.height = muralBitmap.height;
          const mCtx = muralCanvas.getContext('2d')!;
          mCtx.drawImage(muralBitmap, 0, 0);
          const muralImgData = muralCanvas.toDataURL('image/jpeg', 0.92);
          addImagePage(pdf, muralImgData, muralBitmap.width, muralBitmap.height, pageIdx, `Original Mural — ${mural.comment || `Alt ${mi + 1}`}`, mural.liked);
          pageIdx++;
        }
      }

      setExportProgress('Saving PDF...');

      const suffix = mode === 'all' ? '' : `-${mode}`;
      let filePath: string | null = null;
      try {
        filePath = await save({
          defaultPath: `mural-composites${suffix}.pdf`,
          filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
        });
      } catch (dialogErr) {
        console.warn('Tauri save dialog failed, falling back to browser download:', dialogErr);
      }

      if (filePath) {
        const pdfBytes = pdf.output('arraybuffer');
        await writeFile(filePath, new Uint8Array(pdfBytes));
        setExportProgress('Saved!');
      } else {
        pdf.save(`mural-composites${suffix}.pdf`);
        setExportProgress('Downloaded!');
      }
      setTimeout(() => setExportProgress(''), 2000);
    } catch (err) {
      console.error('PDF export failed:', err);
      setExportProgress('Export failed');
      setTimeout(() => setExportProgress(''), 3000);
    } finally {
      setExporting(false);
    }
  }, [presentable, renderComposite, wallIdx]);

  /* ---- stable refs for keyboard shortcuts --------------------------- */
  const toggleLikeRef = useRef(toggleLike);
  toggleLikeRef.current = toggleLike;
  const exportPNGRef = useRef(handleExportPNG);
  exportPNGRef.current = handleExportPNG;
  const exportPDFRef = useRef(handleExportPDF);
  exportPDFRef.current = handleExportPDF;

  /* ---- empty state ------------------------------------------------ */

  if (presentable.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-gray-400 gap-3 bg-gray-900">
        <MessageSquare className="w-12 h-12 opacity-50" />
        <p className="text-sm">No walls with murals yet</p>
        <p className="text-xs text-gray-500">
          Add wall images, define quads, and place murals first
        </p>
      </div>
    );
  }

  /* ---- render ----------------------------------------------------- */

  const wall = currentEntry.wall;
  const presentQuad = wall.quads.find(q => q.murals.length > 0);
  const totalMurals = presentQuad?.murals.length ?? 0;

  return (
    <div className="relative flex h-full bg-black">
      {/* Left sidebar toggle button (always visible) */}
      <button
        onClick={() => setShowWallsSidebar(v => !v)}
        className="absolute top-2 left-2 z-30 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm text-white/70 hover:text-white flex items-center justify-center transition-colors"
        title={showWallsSidebar ? 'Hide walls' : 'Show walls'}
      >
        {showWallsSidebar ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {/* Right sidebar toggle button (always visible) */}
      <button
        onClick={() => setShowMuralsSidebar(v => !v)}
        className="absolute top-2 right-2 z-30 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm text-white/70 hover:text-white flex items-center justify-center transition-colors"
        title={showMuralsSidebar ? 'Hide alternatives' : 'Show alternatives'}
      >
        {showMuralsSidebar ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
      </button>

      {/* Left sidebar — Walls */}
      {showWallsSidebar && (
        <div className="w-[120px] shrink-0 bg-black/80 backdrop-blur-sm border-r border-white/10 flex flex-col overflow-hidden">
          <div className="p-2 flex-1 overflow-y-auto hide-scrollbar">
            <p className="text-[10px] font-semibold text-white/40 uppercase tracking-wide mb-1.5">Walls</p>
            <div ref={wallListRef} className="space-y-1">
              {presentable.map((entry, i) => (
                <button
                  key={entry.wall.id}
                  onClick={() => { setWallIdx(i); setMuralIdx(0); }}
                  className={cn(
                    'w-full rounded overflow-hidden border-2 transition-all',
                    i === wallIdx ? 'border-white/60' : 'border-transparent hover:border-white/30 opacity-60 hover:opacity-100',
                  )}
                >
                  <div className="aspect-[4/3] relative">
                    <img
                      src={entry.wall.thumbUrl}
                      className="w-full h-full object-cover"
                      alt={`Wall ${i + 1}`}
                      draggable={false}
                    />
                    <span className="absolute bottom-0.5 left-0.5 text-[9px] font-bold bg-black/60 text-white px-1 rounded">
                      {i + 1}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main canvas area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ---- Full-screen canvas ---- */}
        <div ref={containerRef} className="flex-1 relative min-h-0">
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        </div>

        {/* ---- Bottom overlay ---- */}
        <div className="shrink-0 h-14 bg-black/50 backdrop-blur-sm flex items-center justify-between px-5 text-white text-sm">
          {/* Left: wall counter + shortcut hints */}
          <div className="flex flex-col">
            <span className="font-medium tabular-nums">
              Wall {wallIdx + 1} / {presentable.length}
            </span>
            <button
              onClick={() => setIncludeAllWalls(v => !v)}
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded transition-colors',
                includeAllWalls
                  ? 'bg-white/20 text-white/80'
                  : 'text-white/40 hover:text-white/60 hover:bg-white/10',
              )}
              title={includeAllWalls ? 'Show only walls with murals' : 'Show all walls'}
            >
              {includeAllWalls ? 'With Murals' : 'All Walls'}
            </button>
          </div>

          {/* Center: mural alternative dots */}
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-2">
              {(presentQuad?.murals ?? []).map((m, i) => (
                <button
                  key={m.id}
                  onClick={() => setMuralIdx(i)}
                  className={`
                    w-2.5 h-2.5 rounded-full transition-all
                    ${
                      i === muralIdx
                        ? 'bg-white scale-125'
                        : 'bg-white/40 hover:bg-white/70'
                    }
                  `}
                  title={`Alternative ${i + 1}`}
                />
              ))}
              {totalMurals > 1 && (
                <span className="text-xs text-white/50 ml-1">
                  {muralIdx + 1}/{totalMurals}
                </span>
              )}
            </div>

            {/* Comment text (if any and not editing) */}
            {currentMural?.comment && !showComment && (
              <p className="text-xs text-white/70 max-w-md truncate">
                {currentMural.comment}
              </p>
            )}
          </div>

          {/* Right: like + export + comment buttons */}
          <div className="flex items-center gap-2">
            {(exporting || exportProgress) && (
              <span className="flex items-center gap-1.5 text-xs text-white/60">
                {exporting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {exportProgress}
              </span>
            )}
            <button
              onClick={toggleLike}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                currentMural?.liked
                  ? 'bg-red-500/30 text-red-300'
                  : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
              title={currentMural?.liked ? 'Unlike' : 'Like'}
            >
              <Heart className={`w-4 h-4 ${currentMural?.liked ? 'fill-current' : ''}`} />
            </button>
            <button
              onClick={handleExportPNG}
              disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
              title="Save current as PNG"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline text-xs">PNG</span>
            </button>
            <div className="relative">
              <button
                onClick={() => setShowPdfMenu(v => !v)}
                disabled={exporting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
                title="Export as PDF"
              >
                <FileDown className="w-4 h-4" />
                <span className="hidden sm:inline text-xs">PDF</span>
              </button>
              {showPdfMenu && (
                <div className="absolute bottom-full mb-2 right-0 bg-gray-900 border border-white/20 rounded-lg shadow-xl py-1 min-w-[180px] z-50">
                  <button onClick={() => handleExportPDF('all')} className="w-full text-left px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 transition-colors">
                    All walls &amp; alternatives
                  </button>
                  <button onClick={() => handleExportPDF('liked')} className="w-full text-left px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 transition-colors">
                    Liked only
                  </button>
                  <button onClick={() => handleExportPDF('murals-only')} className="w-full text-left px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 transition-colors">
                    Original murals only
                  </button>
                  <button onClick={() => handleExportPDF('current-wall')} className="w-full text-left px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 transition-colors">
                    Current wall only
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={() => setShowComment((v) => !v)}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors
                ${
                  showComment
                    ? 'bg-white/20 text-white'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }
                ${currentMural?.comment ? 'ring-1 ring-white/30' : ''}
              `}
            >
              <MessageSquare className="w-4 h-4" />
              <span className="hidden sm:inline">Comment</span>
            </button>
          </div>
        </div>

        {/* ---- Comment input overlay ---- */}
        {showComment && (
          <div className="shrink-0 bg-black/60 backdrop-blur-sm px-5 py-3">
            <input
              type="text"
              autoFocus
              className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-sm text-white placeholder-white/40 outline-none focus:border-white/40 focus:ring-1 focus:ring-white/20"
              placeholder="Add a comment for this mural..."
              value={commentText}
              onChange={(e) => {
                setCommentText(e.target.value);
                saveComment(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  setShowComment(false);
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Right sidebar — Alternatives */}
      {showMuralsSidebar && (
        <div className="w-[120px] shrink-0 bg-black/80 backdrop-blur-sm border-l border-white/10 flex flex-col overflow-hidden">
          <div className="p-2 flex-1 overflow-y-auto hide-scrollbar">
            <p className="text-[10px] font-semibold text-white/40 uppercase tracking-wide mb-1.5">Alternatives</p>
            <div className="space-y-1">
              {(presentQuad?.murals ?? []).map((m, i) => (
                <button
                  key={m.id}
                  onClick={() => setMuralIdx(i)}
                  className={cn(
                    'w-full rounded overflow-hidden border-2 transition-all',
                    i === muralIdx ? 'border-indigo-400' : 'border-transparent hover:border-white/30 opacity-60 hover:opacity-100',
                  )}
                >
                  <div className="aspect-square relative">
                    <img
                      src={m.thumbUrl}
                      className="w-full h-full object-cover"
                      alt={`Alt ${i + 1}`}
                      draggable={false}
                    />
                    <span className="absolute bottom-0.5 left-0.5 text-[9px] font-bold bg-black/60 text-white px-1 rounded">
                      {i + 1}
                    </span>
                    {m.liked && (
                      <Heart className="absolute top-0.5 right-0.5 w-3 h-3 text-red-400 fill-current" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
