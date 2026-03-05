import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { MessageSquare, Download, FileDown, Loader2, Heart } from 'lucide-react';
import { getFullBitmap } from '@/lib/image-cache';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import jsPDF from 'jspdf';
import type { Wall, MuralPlacement, Corner } from '@/App';

interface PresentTabProps {
  walls: Wall[];
  onWallsChange: (walls: Wall[]) => void;
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

  const [wallIdx, setWallIdx] = useState(0);
  const [muralIdx, setMuralIdx] = useState(0);
  const [showComment, setShowComment] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');

  const wallIdxRef = useRef(wallIdx);
  wallIdxRef.current = wallIdx;
  const muralIdxRef = useRef(muralIdx);
  muralIdxRef.current = muralIdx;

  /* ---- filter to presentable walls -------------------------------- */

  const presentable = useMemo(
    () =>
      walls
        .map((w, origIdx) => ({ wall: w, origIdx }))
        .filter((e) => e.wall.quad && e.wall.murals.length > 0),
    [walls],
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
    const maxMural = entry.wall.murals.length - 1;
    setMuralIdx((prev) => Math.min(prev, maxMural));
  }, [wallIdx, presentable]);

  /* sync comment text when selection changes */
  const currentEntry = presentable[wallIdx];
  const currentMural = currentEntry?.wall.murals[muralIdx];

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
    const mural = wall.murals[muralIdxRef.current];

    // Draw wall image fitted
    const wallBitmap = await getFullBitmap(wall.blob);

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

    // Warp mural into quad
    if (mural && wall.quad) {
      const muralBitmap = await getFullBitmap(mural.file);

      // Transform quad from normalized 0-1 space to canvas-space
      const toCanvas = (pt: Corner): Corner => ({
        x: dx + pt.x * dw,
        y: dy + pt.y * dh,
      });

      // Compute quad aspect ratio from canvas coordinates
      const quadCanvasPts = wall.quad.map(toCanvas);
      const qw = (dist(quadCanvasPts[0], quadCanvasPts[1]) + dist(quadCanvasPts[3], quadCanvasPts[2])) / 2;
      const qh = (dist(quadCanvasPts[0], quadCanvasPts[3]) + dist(quadCanvasPts[1], quadCanvasPts[2])) / 2;
      const quadAspect = qh > 0 ? qw / qh : 1;

      drawWarpedMural(
        ctx,
        muralBitmap,
        wall.quad,
        mural.scale,
        mural.offsetX,
        mural.offsetY,
        mural.rotation ?? 0,
        toCanvas,
        quadAspect,
      );
    }
  }, []);

  /* redraw on selection change */
  useLayoutEffect(() => {
    redraw();
  }, [wallIdx, muralIdx, walls, redraw]);

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

      // Shortcuts
      if (e.key === 'l' || e.key === 'L') { toggleLikeRef.current(); return; }
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); exportPNGRef.current(); return; }
      if (e.key === 'e' || e.key === 'E') { e.preventDefault(); exportPDFRef.current(); return; }

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
              const max = entry.wall.murals.length - 1;
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
    const murals = [...w.murals];
    murals[muralIdx] = { ...murals[muralIdx], liked: !murals[muralIdx].liked };
    w.murals = murals;
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
      const murals = [...w.murals];
      murals[muralIdx] = { ...murals[muralIdx], comment: text };
      w.murals = murals;
      next[wIdx] = w;
      onWallsChange(next);
    },
    [walls, onWallsChange, currentEntry, muralIdx],
  );

  /* ---- render a single wall+mural to an offscreen canvas ----------- */

  const renderComposite = useCallback(async (
    wall: Wall,
    mural: Wall['murals'][number],
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

    if (mural && wall.quad) {
      const muralBitmap = await getFullBitmap(mural.file);
      const toCanvas = (pt: Corner): Corner => ({
        x: pt.x * sw,
        y: pt.y * sh,
      });
      const quadCanvasPts = wall.quad.map(toCanvas);
      const qw = (dist(quadCanvasPts[0], quadCanvasPts[1]) + dist(quadCanvasPts[3], quadCanvasPts[2])) / 2;
      const qh = (dist(quadCanvasPts[0], quadCanvasPts[3]) + dist(quadCanvasPts[1], quadCanvasPts[2])) / 2;
      const quadAspect = qh > 0 ? qw / qh : 1;

      drawWarpedMural(
        ctx, muralBitmap, wall.quad,
        mural.scale, mural.offsetX, mural.offsetY,
        mural.rotation ?? 0, toCanvas, quadAspect,
      );
    }
    return canvas;
  }, []);

  /* ---- export single PNG ------------------------------------------ */

  const handleExportPNG = useCallback(async () => {
    const entry = presentable[wallIdx];
    const mural = entry?.wall.murals[muralIdx];
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

      const canvas = await renderComposite(entry.wall, mural);
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

  const handleExportPDF = useCallback(async () => {
    if (presentable.length === 0) return;

    // Count total pages for progress
    let totalPages = 0;
    for (const entry of presentable) {
      for (const mural of entry.wall.murals) {
        totalPages++; // composite page
        if (mural.liked) totalPages++; // original mural page
      }
    }

    setExporting(true);
    setExportProgress(`Rendering page 1/${totalPages}...`);

    try {
      // Use landscape as default; addImagePage handles orientation per page
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      let pageIdx = 0;

      for (let wi = 0; wi < presentable.length; wi++) {
        const entry = presentable[wi];
        for (let mi = 0; mi < entry.wall.murals.length; mi++) {
          const mural = entry.wall.murals[mi];
          setExportProgress(`Rendering page ${pageIdx + 1}/${totalPages}...`);

          // Render composite (wall + warped mural)
          const canvas = await renderComposite(entry.wall, mural);
          const imgData = canvas.toDataURL('image/jpeg', 0.92);
          const label = `Wall ${wi + 1} — Alternative ${mi + 1}${mural.comment ? ` — ${mural.comment}` : ''}`;

          addImagePage(pdf, imgData, canvas.width, canvas.height, pageIdx, label, mural.liked);
          pageIdx++;

          // If liked, add original mural source image as next page
          if (mural.liked) {
            setExportProgress(`Rendering page ${pageIdx + 1}/${totalPages}...`);
            const muralBitmap = await getFullBitmap(mural.file);
            const muralCanvas = document.createElement('canvas');
            muralCanvas.width = muralBitmap.width;
            muralCanvas.height = muralBitmap.height;
            const mCtx = muralCanvas.getContext('2d')!;
            mCtx.drawImage(muralBitmap, 0, 0);
            const muralImgData = muralCanvas.toDataURL('image/jpeg', 0.92);

            addImagePage(pdf, muralImgData, muralBitmap.width, muralBitmap.height, pageIdx, `Original Mural — ${mural.comment || `Alt ${mi + 1}`}`, true);
            pageIdx++;
          }
        }
      }

      setExportProgress('Saving PDF...');

      // Try Tauri save dialog first
      let filePath: string | null = null;
      try {
        filePath = await save({
          defaultPath: 'mural-composites.pdf',
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
        // Fallback: browser download
        pdf.save('mural-composites.pdf');
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
  }, [presentable, renderComposite]);

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
  const totalMurals = wall.murals.length;

  return (
    <div className="flex flex-col h-full bg-black">
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
          <span className="text-[10px] text-white/30">L like · S png · E pdf</span>
        </div>

        {/* Center: mural alternative dots */}
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-2">
            {wall.murals.map((m, i) => (
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
            title={`${currentMural?.liked ? 'Unlike' : 'Like'} (L)`}
          >
            <Heart className={`w-4 h-4 ${currentMural?.liked ? 'fill-current' : ''}`} />
          </button>
          <button
            onClick={handleExportPNG}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
            title="Save current as PNG (S)"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline text-xs">PNG</span>
          </button>
          <button
            onClick={handleExportPDF}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
            title="Export all as PDF (E)"
          >
            <FileDown className="w-4 h-4" />
            <span className="hidden sm:inline text-xs">PDF</span>
          </button>
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
  );
}
