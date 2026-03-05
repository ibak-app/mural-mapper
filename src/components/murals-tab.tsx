import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { ImagePlus, Copy, Trash2, Loader2, RotateCcw, Lock, Unlock, Heart, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getFullBitmap, generateThumb } from '@/lib/image-cache';
import type { Wall, MuralPlacement, Corner } from '@/App';

interface MuralsTabProps {
  walls: Wall[];
  onWallsChange: (walls: Wall[]) => void;
  selectedIdx: number;
  onSelectIdx: (idx: number) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function dist(a: Corner, b: Corner): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerp(a: Corner, b: Corner, t: number): Corner {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function bilerp(tl: Corner, tr: Corner, br: Corner, bl: Corner, u: number, v: number): Corner {
  const top = lerp(tl, tr, u);
  const bot = lerp(bl, br, u);
  return lerp(top, bot, v);
}

/* ------------------------------------------------------------------ */
/*  Perspective warp: draw mural into a quad via triangle subdivision  */
/* ------------------------------------------------------------------ */

function drawWarped(
  ctx: CanvasRenderingContext2D,
  muralBitmap: ImageBitmap,
  quad: [Corner, Corner, Corner, Corner],
  scale: number,
  offsetX: number,
  offsetY: number,
  rotation: number,
  quadAspect: number,
  subdivisions = 8,
) {
  const [tl, tr, br, bl] = quad;
  const mw = muralBitmap.width;
  const mh = muralBitmap.height;
  const muralAspect = mw / mh;

  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);

  // Center in UV space (0-1 quad coordinates)
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

  for (let row = 0; row < subdivisions; row++) {
    for (let col = 0; col < subdivisions; col++) {
      const u0 = col / subdivisions;
      const v0 = row / subdivisions;
      const u1 = (col + 1) / subdivisions;
      const v1 = (row + 1) / subdivisions;

      // Dest corners (in canvas coords via quad bilerp)
      const d00 = bilerp(tl, tr, br, bl, u0, v0);
      const d10 = bilerp(tl, tr, br, bl, u1, v0);
      const d01 = bilerp(tl, tr, br, bl, u0, v1);
      const d11 = bilerp(tl, tr, br, bl, u1, v1);

      // Source corners in mural pixel space
      const s00 = mapUV(u0, v0);
      const s10 = mapUV(u1, v0);
      const s01 = mapUV(u0, v1);
      const s11 = mapUV(u1, v1);

      // Draw two triangles for this cell
      drawTriangle(
        ctx, muralBitmap,
        s00.sx, s00.sy, s10.sx, s10.sy, s01.sx, s01.sy,
        d00.x, d00.y, d10.x, d10.y, d01.x, d01.y,
      );
      drawTriangle(
        ctx, muralBitmap,
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
function drawTriangle(
  ctx: CanvasRenderingContext2D,
  img: ImageBitmap,
  sx0: number, sy0: number, sx1: number, sy1: number, sx2: number, sy2: number,
  dx0: number, dy0: number, dx1: number, dy1: number, dx2: number, dy2: number,
) {
  ctx.save();

  // Clip to dest triangle
  ctx.beginPath();
  ctx.moveTo(dx0, dy0);
  ctx.lineTo(dx1, dy1);
  ctx.lineTo(dx2, dy2);
  ctx.closePath();
  ctx.clip();

  // Compute affine transform: source -> dest
  const denom = (sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1));
  if (Math.abs(denom) < 1e-10) {
    ctx.restore();
    return;
  }

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
/*  Compute mural corner positions in quad-normalized (0-1) space      */
/* ------------------------------------------------------------------ */

/**
 * Returns the 4 corners of the mural rectangle in quad-UV space (0-1),
 * accounting for scale, offset, rotation, and aspect ratio.
 * Order: TL, TR, BR, BL
 */
function getMuralCornersUV(
  muralAspect: number,
  scale: number,
  offsetX: number,
  offsetY: number,
  rotation: number,
  quadAspect: number,
): [Corner, Corner, Corner, Corner] {
  // The mural rectangle in UV space, corrected for quad aspect ratio.
  const hw = 0.5 * scale; // half-width in UV
  const hh = hw * quadAspect / muralAspect; // half-height in UV, corrected

  // Center in UV space (0.5, 0.5) + offset
  const cx = 0.5 + offsetX / 100;
  const cy = 0.5 + offsetY / 100;

  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);

  // Local corners before rotation: TL(-hw,-hh), TR(hw,-hh), BR(hw,hh), BL(-hw,hh)
  const localCorners: [number, number][] = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];

  return localCorners.map(([lx, ly]) => ({
    x: cx + lx * cosR - ly * sinR,
    y: cy + lx * sinR + ly * cosR,
  })) as [Corner, Corner, Corner, Corner];
}

/* ------------------------------------------------------------------ */
/*  Sidebar Thumb (memoised)                                           */
/* ------------------------------------------------------------------ */

interface ThumbProps {
  wall: Wall;
  index: number;
  selected: boolean;
  hasQuad: boolean;
  hasMurals: boolean;
  onSelect: (i: number) => void;
}

const Thumb = React.memo<ThumbProps>(function Thumb({
  wall,
  index,
  selected,
  hasQuad,
  hasMurals,
  onSelect,
}) {
  return (
    <div
      className={cn(
        'relative w-[80px] h-[60px] rounded-md overflow-hidden border-2 shrink-0 transition-all',
        hasQuad ? 'cursor-pointer' : 'cursor-not-allowed opacity-40',
        selected ? 'border-blue-500 ring-2 ring-blue-300' : 'border-transparent',
      )}
      onClick={() => hasQuad && onSelect(index)}
    >
      {wall.thumbUrl ? (
        <img
          src={wall.thumbUrl}
          alt={`Wall ${index + 1}`}
          className="w-full h-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gray-100">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      )}

      {/* number badge */}
      <span className="absolute bottom-0.5 left-0.5 text-[10px] font-bold bg-black/60 text-white rounded px-1 leading-tight">
        {index + 1}
      </span>

      {/* indicator if has murals */}
      {hasMurals && (
        <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-purple-400 border border-white" />
      )}

      {/* dimmed overlay if no quad */}
      {!hasQuad && (
        <div className="absolute inset-0 bg-gray-500/20" />
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Mural Alternative Thumb (memoised)                                 */
/* ------------------------------------------------------------------ */

interface MuralThumbProps {
  mural: MuralPlacement;
  index: number;
  selected: boolean;
  onSelect: (i: number) => void;
}

const MuralThumb = React.memo<MuralThumbProps>(function MuralThumb({
  mural,
  index,
  selected,
  onSelect,
}) {
  return (
    <div
      className={cn(
        'relative w-full aspect-[4/3] rounded-md overflow-hidden cursor-pointer border-2 transition-all',
        selected ? 'border-blue-500 ring-2 ring-blue-300' : 'border-gray-200 hover:border-gray-400',
      )}
      onClick={() => onSelect(index)}
    >
      {mural.thumbUrl ? (
        <img
          src={mural.thumbUrl}
          alt={`Mural ${index + 1}`}
          className="w-full h-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gray-100">
          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
        </div>
      )}
      {mural.liked && (
        <span className="absolute top-1 right-1 text-red-500">
          <Heart className="w-3 h-3 fill-current" />
        </span>
      )}
      {mural.comment && (
        <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] px-1 truncate">
          {mural.comment}
        </span>
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Drag state types                                                   */
/* ------------------------------------------------------------------ */

type DragMode =
  | { kind: 'none' }
  | { kind: 'corner'; cornerIdx: number; startAngle: number; startScale: number; startRotation: number }
  | { kind: 'move'; startMouseU: number; startMouseV: number; startOffsetX: number; startOffsetY: number };

/* ------------------------------------------------------------------ */
/*  MuralsTab                                                          */
/* ------------------------------------------------------------------ */

export function MuralsTab({
  walls,
  onWallsChange,
  selectedIdx,
  onSelectIdx,
}: MuralsTabProps) {
  /* refs to avoid stale closures */
  const wallsRef = useRef(walls);
  wallsRef.current = walls;
  const selectedRef = useRef(selectedIdx);
  selectedRef.current = selectedIdx;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const thumbListRef = useRef<HTMLDivElement>(null);
  const muralInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [activeMuralIdx, setActiveMuralIdx] = useState(0);
  const [rotationLocked, setRotationLocked] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const mouseStartRef = useRef({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const rafRef = useRef<number | null>(null);

  // Drag state
  const dragRef = useRef<DragMode>({ kind: 'none' });
  // Cache layout info for drag calculations
  const layoutRef = useRef<{
    dx: number; dy: number; dw: number; dh: number;
    quadCanvas: [Corner, Corner, Corner, Corner];
    muralAspect: number;
    quadAspect: number;
  } | null>(null);

  const selectedWall = walls[selectedIdx];
  const hasQuad = !!selectedWall?.quad;
  const activeMural = hasQuad ? selectedWall?.murals[activeMuralIdx] : undefined;

  /* ---- inverse bilerp: canvas coords -> quad UV -------------------- */

  /**
   * Given a point in canvas coords and the quad corners in canvas coords,
   * find the approximate (u, v) in [0,1] using Newton iteration.
   */
  function canvasToQuadUV(
    px: number, py: number,
    quad: [Corner, Corner, Corner, Corner],
  ): { u: number; v: number } {
    const [tl, tr, br, bl] = quad;
    // Start with initial guess
    let u = 0.5, v = 0.5;
    for (let i = 0; i < 8; i++) {
      const p = bilerp(tl, tr, br, bl, u, v);
      const ex = px - p.x;
      const ey = py - p.y;
      if (Math.abs(ex) < 0.5 && Math.abs(ey) < 0.5) break;

      // Jacobian: dp/du, dp/dv
      const eps = 0.001;
      const pu = bilerp(tl, tr, br, bl, u + eps, v);
      const pv = bilerp(tl, tr, br, bl, u, v + eps);
      const dxdu = (pu.x - p.x) / eps;
      const dydu = (pu.y - p.y) / eps;
      const dxdv = (pv.x - p.x) / eps;
      const dydv = (pv.y - p.y) / eps;

      const det = dxdu * dydv - dxdv * dydu;
      if (Math.abs(det) < 1e-10) break;

      u += (dydv * ex - dxdv * ey) / det;
      v += (-dydu * ex + dxdu * ey) / det;
    }
    return { u, v };
  }

  /* ---- canvas draw ------------------------------------------------ */

  const redraw = useCallback(async () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cw, ch);

    // Apply zoom/pan
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    const w = wallsRef.current[selectedRef.current];
    if (!w) { ctx.restore(); return; }

    setLoading(true);
    try {
      const wallBitmap = await getFullBitmap(w.blob);
      if (selectedRef.current !== selectedIdx) { ctx.restore(); return; }

      // Source region (full image or crop)
      const sx = w.crop?.x ?? 0;
      const sy = w.crop?.y ?? 0;
      const sw = w.crop?.w ?? wallBitmap.width;
      const sh = w.crop?.h ?? wallBitmap.height;

      // Fit wall image into canvas (contain)
      const padding = 16;
      const availW = cw - padding * 2;
      const availH = ch - padding * 2;
      const fitScale = Math.min(availW / sw, availH / sh, 1);
      const dw = sw * fitScale;
      const dh = sh * fitScale;
      const dx = (cw - dw) / 2;
      const dy = (ch - dh) / 2;

      ctx.drawImage(wallBitmap, sx, sy, sw, sh, dx, dy, dw, dh);

      // Draw mural warped into quad
      const mural = w.murals[activeMuralIdx];
      if (w.quad && mural) {
        const muralBitmap = await getFullBitmap(mural.file);
        if (selectedRef.current !== selectedIdx) return;

        // Map normalized quad coords (0-1 relative to source image region) to canvas coords
        const quadCanvas: [Corner, Corner, Corner, Corner] = w.quad.map((corner) => ({
          x: dx + corner.x * dw,
          y: dy + corner.y * dh,
        })) as [Corner, Corner, Corner, Corner];

        const muralAspect = muralBitmap.width / muralBitmap.height;
        const rot = mural.rotation ?? 0;

        // Compute quad aspect ratio from canvas coordinates
        const quadWidth = (dist(quadCanvas[0], quadCanvas[1]) + dist(quadCanvas[3], quadCanvas[2])) / 2;
        const quadHeight = (dist(quadCanvas[0], quadCanvas[3]) + dist(quadCanvas[1], quadCanvas[2])) / 2;
        const quadAspect = quadHeight > 0 ? quadWidth / quadHeight : 1;

        // Cache layout for drag calculations
        layoutRef.current = { dx, dy, dw, dh, quadCanvas, muralAspect, quadAspect };

        ctx.save();
        drawWarped(
          ctx,
          muralBitmap,
          quadCanvas,
          mural.scale,
          mural.offsetX,
          mural.offsetY,
          rot,
          quadAspect,
        );
        ctx.restore();

        // Draw quad outline
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(quadCanvas[0].x, quadCanvas[0].y);
        ctx.lineTo(quadCanvas[1].x, quadCanvas[1].y);
        ctx.lineTo(quadCanvas[2].x, quadCanvas[2].y);
        ctx.lineTo(quadCanvas[3].x, quadCanvas[3].y);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();

        // Draw mural bounding rectangle corners as handles
        const cornersUV = getMuralCornersUV(
          muralAspect,
          mural.scale,
          mural.offsetX,
          mural.offsetY,
          rot,
          quadAspect,
        );

        // Convert UV corners to canvas coords via bilerp
        const [qtl, qtr, qbr, qbl] = quadCanvas;
        const cornersPx = cornersUV.map(c => bilerp(qtl, qtr, qbr, qbl, c.x, c.y));

        // Draw mural outline
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(cornersPx[0].x, cornersPx[0].y);
        ctx.lineTo(cornersPx[1].x, cornersPx[1].y);
        ctx.lineTo(cornersPx[2].x, cornersPx[2].y);
        ctx.lineTo(cornersPx[3].x, cornersPx[3].y);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();

        // Draw corner handles
        for (const cp of cornersPx) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(cp.x, cp.y, 6, 0, Math.PI * 2);
          ctx.fillStyle = 'white';
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.4)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.restore();
        }

        // Draw center handle (small crosshair)
        const centerUV = {
          x: 0.5 + mural.offsetX / 100,
          y: 0.5 + mural.offsetY / 100,
        };
        const centerPx = bilerp(qtl, qtr, qbr, qbl, centerUV.x, centerUV.y);
        ctx.save();
        ctx.beginPath();
        ctx.arc(centerPx.x, centerPx.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();

      } else if (w.quad) {
        // Draw quad outline only (no mural selected)
        const quadCanvas = w.quad.map((corner) => ({
          x: dx + corner.x * dw,
          y: dy + corner.y * dh,
        }));
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(quadCanvas[0].x, quadCanvas[0].y);
        ctx.lineTo(quadCanvas[1].x, quadCanvas[1].y);
        ctx.lineTo(quadCanvas[2].x, quadCanvas[2].y);
        ctx.lineTo(quadCanvas[3].x, quadCanvas[3].y);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();

        layoutRef.current = null;
      }
    } finally {
      ctx.restore(); // pop zoom/pan
      setLoading(false);
    }
  }, [walls, selectedIdx, activeMuralIdx, zoom, pan]);

  /* redraw on selection or mural change */
  useLayoutEffect(() => {
    redraw();
  }, [redraw]);

  /* ResizeObserver */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [redraw]);

  /* ---- wheel zoom ------------------------------------------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = Math.pow(1.001, -e.deltaY);
      const newZoom = Math.max(0.3, Math.min(8, zoom * factor));
      const ratio = newZoom / zoom;
      setPan({ x: mx - ratio * (mx - pan.x), y: my - ratio * (my - pan.y) });
      setZoom(newZoom);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoom, pan]);

  /* ---- mouse interaction for corner/move drag ---------------------- */

  const getCanvasXY = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    // Convert screen coords to pre-zoom canvas coords
    return {
      x: (e.clientX - rect.left - pan.x) / zoom,
      y: (e.clientY - rect.top - pan.y) / zoom,
    };
  }, [zoom, pan]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const layout = layoutRef.current;
    const w = wallsRef.current[selectedRef.current];
    const mural = w?.murals[activeMuralIdx];
    if (!layout || !mural || !w?.quad) return;

    const { x: mx, y: my } = getCanvasXY(e);
    const rot = mural.rotation ?? 0;
    const { quadCanvas, muralAspect, quadAspect } = layout;

    // Get mural corners in canvas space
    const cornersUV = getMuralCornersUV(muralAspect, mural.scale, mural.offsetX, mural.offsetY, rot, quadAspect);
    const [qtl, qtr, qbr, qbl] = quadCanvas;
    const cornersPx = cornersUV.map(c => bilerp(qtl, qtr, qbr, qbl, c.x, c.y));

    // Check if click is near a corner handle (within 12px)
    const HANDLE_RADIUS = 12;
    for (let i = 0; i < 4; i++) {
      const cp = cornersPx[i];
      const dist = Math.hypot(mx - cp.x, my - cp.y);
      if (dist <= HANDLE_RADIUS) {
        // Compute center in canvas space
        const centerUV = { x: 0.5 + mural.offsetX / 100, y: 0.5 + mural.offsetY / 100 };
        const centerPx = bilerp(qtl, qtr, qbr, qbl, centerUV.x, centerUV.y);
        const startAngle = Math.atan2(my - centerPx.y, mx - centerPx.x);

        dragRef.current = {
          kind: 'corner',
          cornerIdx: i,
          startAngle,
          startScale: mural.scale,
          startRotation: rot,
        };
        e.preventDefault();
        return;
      }
    }

    // Check if click is inside the mural bounding polygon (for move)
    if (isPointInPolygon(mx, my, cornersPx)) {
      const { u, v } = canvasToQuadUV(mx, my, quadCanvas);
      dragRef.current = {
        kind: 'move',
        startMouseU: u,
        startMouseV: v,
        startOffsetX: mural.offsetX,
        startOffsetY: mural.offsetY,
      };
      e.preventDefault();
      return;
    }

    // Otherwise start panning
    setIsPanning(true);
    panStartRef.current = { ...pan };
    mouseStartRef.current = { x: e.clientX, y: e.clientY };
  }, [activeMuralIdx, getCanvasXY, pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      const dx = e.clientX - mouseStartRef.current.x;
      const dy = e.clientY - mouseStartRef.current.y;
      setPan({ x: panStartRef.current.x + dx, y: panStartRef.current.y + dy });
      return;
    }

    const drag = dragRef.current;
    if (drag.kind === 'none') return;

    const layout = layoutRef.current;
    const w = wallsRef.current[selectedRef.current];
    const mural = w?.murals[activeMuralIdx];
    if (!layout || !mural || !w?.quad) return;

    const { x: mx, y: my } = getCanvasXY(e);
    const { quadCanvas, muralAspect, quadAspect } = layout;
    const [qtl, qtr, qbr, qbl] = quadCanvas;
    const wallIdx = selectedRef.current;

    if (drag.kind === 'corner') {
      // Compute center in canvas space
      const centerUV = { x: 0.5 + mural.offsetX / 100, y: 0.5 + mural.offsetY / 100 };
      const centerPx = bilerp(qtl, qtr, qbr, qbl, centerUV.x, centerUV.y);

      // Distance from center to mouse determines scale
      const distPx = Math.hypot(mx - centerPx.x, my - centerPx.y);

      // Distance from center to original corner at start
      const startCornersUV = getMuralCornersUV(muralAspect, drag.startScale, mural.offsetX, mural.offsetY, drag.startRotation, quadAspect);
      const startCornerPx = bilerp(qtl, qtr, qbr, qbl, startCornersUV[drag.cornerIdx].x, startCornersUV[drag.cornerIdx].y);
      const startDistPx = Math.hypot(startCornerPx.x - centerPx.x, startCornerPx.y - centerPx.y);

      if (startDistPx < 1) return;

      const newScale = Math.max(0.05, Math.min(5, drag.startScale * (distPx / startDistPx)));

      if (rotationLocked) {
        updateMural(wallIdx, activeMuralIdx, { scale: newScale });
      } else {
        // Angle from center to mouse determines rotation
        const currentAngle = Math.atan2(my - centerPx.y, mx - centerPx.x);
        const angleDelta = currentAngle - drag.startAngle;
        const newRotation = drag.startRotation + angleDelta;
        updateMural(wallIdx, activeMuralIdx, { scale: newScale, rotation: newRotation });
      }
    } else if (drag.kind === 'move') {
      const { u, v } = canvasToQuadUV(mx, my, quadCanvas);
      const du = u - drag.startMouseU;
      const dv = v - drag.startMouseV;

      const newOffsetX = Math.max(-100, Math.min(100, drag.startOffsetX + du * 100));
      const newOffsetY = Math.max(-100, Math.min(100, drag.startOffsetY + dv * 100));

      updateMural(wallIdx, activeMuralIdx, { offsetX: newOffsetX, offsetY: newOffsetY });
    }
  }, [activeMuralIdx, getCanvasXY]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = { kind: 'none' };
    setIsPanning(false);
  }, []);

  /* ---- arrow key navigation --------------------------------------- */

  useEffect(() => {
    let rafId: number | null = null;
    let pending: number | null = null;

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Left/Right: cycle mural alternatives
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        setActiveMuralIdx(prev => {
          const w = wallsRef.current[selectedRef.current];
          if (!w || w.murals.length === 0) return prev;
          return Math.max(0, Math.min(w.murals.length - 1, prev + dir));
        });
        return;
      }

      // Up/Down: cycle walls
      let dir = 0;
      if (e.key === 'ArrowUp') dir = -1;
      if (e.key === 'ArrowDown') dir = 1;
      if (dir === 0) return;

      e.preventDefault();

      if (pending === null) {
        pending = dir;
        rafId = requestAnimationFrame(() => {
          const cur = selectedRef.current;
          const ws = wallsRef.current;
          if (ws.length === 0) { pending = null; return; }

          // Navigate only among walls with quads
          let next = cur + pending!;
          next = Math.max(0, Math.min(ws.length - 1, next));
          // Skip walls without quad
          while (next >= 0 && next < ws.length && !ws[next].quad) {
            next += pending! > 0 ? 1 : -1;
          }
          if (next >= 0 && next < ws.length && ws[next].quad && next !== cur) {
            onSelectIdx(next);
          }
          pending = null;
        });
      } else {
        pending += dir;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [onSelectIdx]);

  /* auto-scroll selected thumb into view */
  useEffect(() => {
    const list = thumbListRef.current;
    if (!list) return;
    const el = list.children[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIdx]);

  /* reset active mural index and zoom when wall changes */
  useEffect(() => {
    setActiveMuralIdx(0);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [selectedIdx]);

  /* ---- mural mutation helpers ------------------------------------- */

  const updateWall = useCallback(
    (idx: number, patch: Partial<Wall>) => {
      const cur = [...wallsRef.current];
      cur[idx] = { ...cur[idx], ...patch };
      onWallsChange(cur);
    },
    [onWallsChange],
  );

  const updateMural = useCallback(
    (wallIdx: number, muralIdx: number, patch: Partial<MuralPlacement>) => {
      const cur = [...wallsRef.current];
      const w = cur[wallIdx];
      const murals = [...w.murals];
      murals[muralIdx] = { ...murals[muralIdx], ...patch };
      cur[wallIdx] = { ...w, murals };
      onWallsChange(cur);
    },
    [onWallsChange],
  );

  /* ---- load mural ------------------------------------------------- */

  const handleLoadMural = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const fileArr = Array.from(files);
      const idx = selectedRef.current;
      const cur = [...wallsRef.current];
      const w = cur[idx];
      const existingCount = w.murals.length;

      // Add all files as new murals with empty thumbs first
      const newMurals: MuralPlacement[] = fileArr.map(file => ({
        id: genId(),
        file,
        thumbUrl: '',
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        rotation: 0,
        comment: '',
      }));

      cur[idx] = { ...w, murals: [...w.murals, ...newMurals] };
      onWallsChange(cur);
      setActiveMuralIdx(existingCount); // select first new one

      // Generate thumbnails progressively
      for (let i = 0; i < fileArr.length; i++) {
        const thumbUrl = await generateThumb(fileArr[i]);
        const latest = [...wallsRef.current];
        const lw = latest[idx];
        if (lw) {
          const murals = [...lw.murals];
          const mi = existingCount + i;
          if (mi < murals.length) {
            murals[mi] = { ...murals[mi], thumbUrl };
            latest[idx] = { ...lw, murals };
            onWallsChange(latest);
          }
        }
      }

      e.target.value = '';
    },
    [onWallsChange],
  );

  /* ---- duplicate mural -------------------------------------------- */

  const handleDuplicate = useCallback(() => {
    const idx = selectedRef.current;
    const w = wallsRef.current[idx];
    const mural = w?.murals[activeMuralIdx];
    if (!mural) return;

    const dup: MuralPlacement = {
      ...mural,
      id: genId(),
      comment: mural.comment ? `${mural.comment} (copy)` : '',
    };

    const cur = [...wallsRef.current];
    const murals = [...cur[idx].murals, dup];
    cur[idx] = { ...cur[idx], murals };
    onWallsChange(cur);
    setActiveMuralIdx(murals.length - 1);
  }, [onWallsChange, activeMuralIdx]);

  /* ---- remove mural ----------------------------------------------- */

  const handleRemoveMural = useCallback(() => {
    const idx = selectedRef.current;
    const w = wallsRef.current[idx];
    if (!w || w.murals.length === 0) return;

    const cur = [...wallsRef.current];
    const murals = [...cur[idx].murals];
    murals.splice(activeMuralIdx, 1);
    cur[idx] = { ...cur[idx], murals };
    onWallsChange(cur);
    setActiveMuralIdx((prev) => Math.min(prev, Math.max(0, murals.length - 1)));
  }, [onWallsChange, activeMuralIdx]);

  /* ---- slider handlers (rAF-throttled) ---------------------------- */

  const handleSliderChange = useCallback(
    (field: 'scale' | 'offsetX' | 'offsetY' | 'rotation', value: number) => {
      const wallIdx = selectedRef.current;
      const muralIdx = activeMuralIdx;

      // Immediate state update
      updateMural(wallIdx, muralIdx, { [field]: value });

      // Schedule redraw with rAF
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
      });
    },
    [activeMuralIdx, updateMural],
  );

  /* ---- render ----------------------------------------------------- */

  const muralCount = selectedWall?.murals.length ?? 0;
  const wallsWithQuad = walls.filter((w) => !!w.quad).length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 min-h-0">
        {/* ---- Left Sidebar: Wall thumbs ---- */}
        <div className="w-[100px] border-r bg-gray-50 flex flex-col">
          <div
            ref={thumbListRef}
            className="flex-1 overflow-y-auto p-2 space-y-2 flex flex-col items-center"
          >
            {walls.map((w, i) => (
              <Thumb
                key={w.id}
                wall={w}
                index={i}
                selected={i === selectedIdx}
                hasQuad={!!w.quad}
                hasMurals={w.murals.length > 0}
                onSelect={onSelectIdx}
              />
            ))}
          </div>
        </div>

        {/* ---- Main canvas area ---- */}
        <div ref={containerRef} className="flex-1 relative bg-gray-900">
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ cursor: dragRef.current.kind !== 'none' ? 'grabbing' : undefined }}
          />

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <Loader2 className="w-8 h-8 animate-spin text-white/70" />
            </div>
          )}

          {walls.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 gap-3">
              <ImagePlus className="w-12 h-12" />
              <p className="text-sm">No walls available</p>
            </div>
          )}

          {walls.length > 0 && !hasQuad && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 gap-2">
              <p className="text-sm">This wall has no quad defined.</p>
              <p className="text-xs">Define a quad in the previous step to place murals.</p>
            </div>
          )}

          {hasQuad && muralCount === 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 text-white/80 text-xs px-3 py-1.5 rounded-full">
              Load a mural image to get started
            </div>
          )}
        </div>

        {/* ---- Right Sidebar: Mural alternatives ---- */}
        <div className="w-[200px] border-l bg-white flex flex-col">
          {/* Header + load button */}
          <div className="p-3 border-b">
            <button
              onClick={() => muralInputRef.current?.click()}
              disabled={!hasQuad}
              className={cn(
                'w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-md transition-colors',
                hasQuad
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed',
              )}
            >
              <ImagePlus className="w-4 h-4" />
              Load Mural
            </button>
            <input
              ref={muralInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={handleLoadMural}
            />
          </div>

          {/* Mural alternatives list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {selectedWall?.murals.map((m, i) => (
              <MuralThumb
                key={m.id}
                mural={m}
                index={i}
                selected={i === activeMuralIdx}
                onSelect={setActiveMuralIdx}
              />
            ))}

            {muralCount === 0 && hasQuad && (
              <div className="text-center text-gray-400 text-xs py-6">
                No murals yet
              </div>
            )}
          </div>

          {/* Action buttons for selected mural */}
          {activeMural && (
            <div className="border-t p-3 space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => updateMural(selectedIdx, activeMuralIdx, { liked: !activeMural.liked })}
                  className={cn(
                    'flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-md transition-colors border',
                    activeMural.liked
                      ? 'bg-red-50 text-red-500 border-red-200'
                      : 'hover:bg-gray-100 text-gray-700 border-gray-200',
                  )}
                  title={activeMural.liked ? 'Unlike' : 'Like'}
                >
                  <Heart className={cn('w-3.5 h-3.5', activeMural.liked && 'fill-current')} />
                </button>
                <button
                  onClick={handleDuplicate}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-md hover:bg-gray-100 transition-colors text-gray-700 border border-gray-200"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Duplicate
                </button>
                <button
                  onClick={handleRemoveMural}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-md hover:bg-red-50 hover:text-red-600 transition-colors text-gray-700 border border-gray-200"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---- Bottom bar with comment ---- */}
      <div className="h-12 bg-white border-t flex items-center px-4 shrink-0 gap-3">
        <div className="flex items-center gap-3 text-sm text-gray-600 shrink-0">
          {walls.length > 0 && (
            <>
              <span className="font-medium">
                Wall {selectedIdx + 1} / {walls.length}
              </span>
              <span className="text-gray-400 text-xs">
                {muralCount} mural{muralCount !== 1 ? 's' : ''}
              </span>
            </>
          )}
        </div>

        {activeMural && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => updateMural(selectedIdx, activeMuralIdx, { rotation: 0 })}
              disabled={!activeMural.rotation}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-gray-100 transition-colors text-gray-500 disabled:opacity-30"
              title="Reset rotation"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setRotationLocked(v => !v)}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                rotationLocked ? 'bg-amber-100 text-amber-700' : 'hover:bg-gray-100 text-gray-500'
              }`}
              title={rotationLocked ? 'Unlock rotation' : 'Lock rotation'}
            >
              {rotationLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}

        {activeMural && (
          <input
            type="text"
            value={activeMural.comment}
            onChange={(e) =>
              updateMural(selectedIdx, activeMuralIdx, { comment: e.target.value })
            }
            placeholder="Add a comment for this mural..."
            className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-gray-50"
          />
        )}

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => { setZoom(z => Math.min(8, z * 1.3)); }}
            className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setZoom(z => Math.max(0.3, z / 1.3)); }}
            className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
            className="px-1.5 py-0.5 rounded hover:bg-gray-100 text-gray-400 text-[10px] font-medium transition-colors"
            title="Fit to view"
          >
            Fit
          </button>
          <span className="text-[10px] text-gray-400 ml-1 tabular-nums">{Math.round(zoom * 100)}%</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Point-in-polygon test (ray casting)                                */
/* ------------------------------------------------------------------ */

function isPointInPolygon(px: number, py: number, polygon: Corner[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}
