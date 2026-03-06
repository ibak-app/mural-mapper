import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { ImagePlus, Copy, Trash2, Loader2, RotateCcw, Lock, Unlock, Heart, ZoomIn, ZoomOut, Link, Maximize, Square, Crosshair, ClipboardCopy, ClipboardPaste, X, FolderOpen, Grid3X3, Shuffle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getFullBitmap, generateThumb } from '@/lib/image-cache';
import type { Wall, MuralPlacement, Corner, MuralPoolEntry } from '@/App';

interface MuralsTabProps {
  walls: Wall[];
  onWallsChange: (walls: Wall[], changedIdx?: number) => void;
  selectedIdx: number;
  onSelectIdx: (idx: number) => void;
  muralPool: MuralPoolEntry[];
  onMuralPoolChange: (pool: MuralPoolEntry[]) => void;
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
/*  Clip mask helper                                                   */
/* ------------------------------------------------------------------ */

/**
 * Apply a clip path within the quad before drawing the mural.
 * Uses 4 independent clip values (0-0.45) for each edge.
 * quad: the 4 corners in canvas coords [TL, TR, BR, BL].
 */
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
/*  Placement settings for copy/paste                                  */
/* ------------------------------------------------------------------ */

interface PlacementSettings {
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  opacity: number;
  blendMode: GlobalCompositeOperation;
  clipLeft: number;
  clipRight: number;
  clipTop: number;
  clipBottom: number;
}

// Module-level clipboard so it persists across re-renders
let copiedSettings: PlacementSettings | null = null;

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

      {/* link indicator */}
      {wall.quads.some(q => q.linkId) && (
        <span className="absolute top-1 left-1" title="Linked wall — murals sync">
          <Link className="w-2.5 h-2.5 text-amber-400 drop-shadow-sm" />
        </span>
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
  onRemove: (i: number) => void;
  onPointerDown?: (i: number, e: React.PointerEvent) => void;
}

const MuralThumb = React.memo<MuralThumbProps>(function MuralThumb({
  mural,
  index,
  selected,
  onSelect,
  onRemove,
  onPointerDown,
}) {
  return (
    <div
      className={cn(
        'group relative w-full aspect-[4/3] rounded-md overflow-hidden cursor-pointer border-2 transition-all select-none',
        selected ? 'border-blue-500 ring-2 ring-blue-300' : 'border-gray-200 hover:border-gray-400',
      )}
      onClick={(e) => { e.stopPropagation(); onSelect(index); }}
      onPointerDown={onPointerDown ? (e) => onPointerDown(index, e) : undefined}
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
      {/* Remove button */}
      <button
        className="absolute top-0.5 right-0.5 w-5 h-5 flex items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10"
        onClick={(e) => { e.stopPropagation(); onRemove(index); }}
        title="Remove mural"
      >
        <X className="w-3 h-3" />
      </button>
      {mural.liked && (
        <span className="absolute top-1 right-7 text-red-500">
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
  muralPool,
  onMuralPoolChange,
}: MuralsTabProps) {
  const [loading, setLoading] = useState(false);
  const [activeMuralIdx, setActiveMuralIdx] = useState(0);
  const [activeQuadIdx, setActiveQuadIdx] = useState(0);
  const [rotationLocked, setRotationLocked] = useState(true);

  /* refs to avoid stale closures */
  const wallsRef = useRef(walls);
  wallsRef.current = walls;
  const selectedRef = useRef(selectedIdx);
  selectedRef.current = selectedIdx;
  const activeQuadIdxRef = useRef(activeQuadIdx);
  activeQuadIdxRef.current = activeQuadIdx;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const thumbListRef = useRef<HTMLDivElement>(null);
  const muralInputRef = useRef<HTMLInputElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const mouseStartRef = useRef({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [showMuralPicker, setShowMuralPicker] = useState(false);
  const [selectedPoolIds, setSelectedPoolIds] = useState<Set<string>>(new Set());
  const [pickerTab, setPickerTab] = useState<'files' | 'library'>('library');
  const rafRef = useRef<number | null>(null);

  // Mural thumb drag-to-reorder state
  const [muralDragOverIdx, setMuralDragOverIdx] = useState<number | null>(null);
  const muralDragFromIdx = useRef<number | null>(null);
  const muralDragOverIdxRef = useRef<number | null>(null);

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
  const hasQuad = selectedWall?.quads.length > 0 && !!selectedWall.quads[activeQuadIdx]?.corners;
  const activeQuad = hasQuad ? selectedWall.quads[activeQuadIdx] : undefined;
  const activeMural = activeQuad?.murals[activeMuralIdx];

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

      // Draw ALL quads with their murals
      for (let qi = 0; qi < w.quads.length; qi++) {
        const quadObj = w.quads[qi];
        const isActive = qi === activeQuadIdxRef.current;
        const mural = isActive ? quadObj?.murals[activeMuralIdx] : quadObj?.murals[0];
        if (!quadObj?.corners) continue;

        // Map normalized quad coords to canvas coords
        const quadCanvas: [Corner, Corner, Corner, Corner] = quadObj.corners.map((corner) => ({
          x: dx + corner.x * dw,
          y: dy + corner.y * dh,
        })) as [Corner, Corner, Corner, Corner];

        const quadWidth = (dist(quadCanvas[0], quadCanvas[1]) + dist(quadCanvas[3], quadCanvas[2])) / 2;
        const quadHeight = (dist(quadCanvas[0], quadCanvas[3]) + dist(quadCanvas[1], quadCanvas[2])) / 2;
        const quadAspect = quadHeight > 0 ? quadWidth / quadHeight : 1;

        // Cache layout for active quad's drag calculations
        if (isActive && mural) {
          const muralBitmapForLayout = await getFullBitmap(mural.file);
          const muralAspect = muralBitmapForLayout.width / muralBitmapForLayout.height;
          layoutRef.current = { dx, dy, dw, dh, quadCanvas, muralAspect, quadAspect };
        }

        if (mural) {
          const muralBitmap = await getFullBitmap(mural.file);
          if (selectedRef.current !== selectedIdx) return;
          const rot = mural.rotation ?? 0;

          ctx.save();
          const clipL = mural.clipLeft ?? 0;
          const clipR = mural.clipRight ?? 0;
          const clipT = mural.clipTop ?? 0;
          const clipB = mural.clipBottom ?? 0;
          if (clipL > 0 || clipR > 0 || clipT > 0 || clipB > 0) {
            applyClipMask(ctx, clipL, clipR, clipT, clipB, quadCanvas);
          }
          ctx.globalAlpha = (mural.opacity ?? 1) * (isActive ? 1 : 0.7);
          ctx.globalCompositeOperation = mural.blendMode ?? 'source-over';
          drawWarped(ctx, muralBitmap, quadCanvas, mural.scale, mural.offsetX, mural.offsetY, rot, quadAspect);
          ctx.restore();
        }

        // Draw quad outline
        ctx.save();
        ctx.strokeStyle = isActive ? 'rgba(99, 102, 241, 0.8)' : 'rgba(255,255,255,0.3)';
        ctx.lineWidth = isActive ? 2 : 1;
        ctx.setLineDash(isActive ? [4, 4] : [2, 3]);
        ctx.beginPath();
        ctx.moveTo(quadCanvas[0].x, quadCanvas[0].y);
        ctx.lineTo(quadCanvas[1].x, quadCanvas[1].y);
        ctx.lineTo(quadCanvas[2].x, quadCanvas[2].y);
        ctx.lineTo(quadCanvas[3].x, quadCanvas[3].y);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();

        // Active quad with mural: draw clip region outline + handles
        if (isActive && mural) {
          const clipL = mural.clipLeft ?? 0;
          const clipR = mural.clipRight ?? 0;
          const clipT = mural.clipTop ?? 0;
          const clipB = mural.clipBottom ?? 0;
          if (clipL > 0 || clipR > 0 || clipT > 0 || clipB > 0) {
            const [qtl2, qtr2, qbr2, qbl2] = quadCanvas;
            const cu0 = Math.min(clipL, 0.45);
            const cu1 = 1 - Math.min(clipR, 0.45);
            const cv0 = Math.min(clipT, 0.45);
            const cv1 = 1 - Math.min(clipB, 0.45);
            const cc = [
              bilerp(qtl2, qtr2, qbr2, qbl2, cu0, cv0),
              bilerp(qtl2, qtr2, qbr2, qbl2, cu1, cv0),
              bilerp(qtl2, qtr2, qbr2, qbl2, cu1, cv1),
              bilerp(qtl2, qtr2, qbr2, qbl2, cu0, cv1),
            ];
            ctx.save();
            ctx.strokeStyle = 'rgba(245,158,11,0.6)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(cc[0].x, cc[0].y);
            cc.slice(1).forEach(c => ctx.lineTo(c.x, c.y));
            ctx.closePath();
            ctx.stroke();
            ctx.restore();
          }

          // Compute muralAspect for handle drawing
          const muralBitmapH = await getFullBitmap(mural.file);
          const muralAspectH = muralBitmapH.width / muralBitmapH.height;
          const rot = mural.rotation ?? 0;

          // Draw mural bounding rectangle corners as handles
          const cornersUV = getMuralCornersUV(
            muralAspectH,
            mural.scale,
            mural.offsetX,
            mural.offsetY,
            rot,
            quadAspect,
          );

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

          // Draw center handle
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
        }

        // Clear layout if active quad has no mural
        if (isActive && !mural) {
          layoutRef.current = null;
        }
      } // end quad loop
    } finally {
      ctx.restore(); // pop zoom/pan
      setLoading(false);
    }
  }, [walls, selectedIdx, activeMuralIdx, activeQuadIdx, zoom, pan]);

  /* redraw on selection or mural change */
  useLayoutEffect(() => {
    redraw();
  }, [redraw]);

  /* Close mural picker on Escape */
  useEffect(() => {
    if (!showMuralPicker) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowMuralPicker(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showMuralPicker]);

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
    const qObj = w?.quads[activeQuadIdxRef.current];
    const mural = qObj?.murals[activeMuralIdx];
    if (!layout || !mural || !qObj?.corners) return;

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
    const qObj = w?.quads[activeQuadIdxRef.current];
    const mural = qObj?.murals[activeMuralIdx];
    if (!layout || !mural || !qObj?.corners) return;

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

      // Skip arrow keys if a button in the sidebar has focus (e.g. after clicking a mural thumb)
      const active = document.activeElement as HTMLElement | null;
      if (active && active.closest('[data-sidebar]')) return;

      // Left/Right: cycle quads
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        const w = wallsRef.current[selectedRef.current];
        if (!w || w.quads.length <= 1) return;
        setActiveQuadIdx(prev => {
          const next = prev + dir;
          if (next < 0 || next >= w.quads.length) return prev;
          return next;
        });
        setActiveMuralIdx(0);
        return;
      }

      // Up/Down: cycle mural alternatives
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        setActiveMuralIdx(prev => {
          const w = wallsRef.current[selectedRef.current];
          const qMurals = w?.quads[activeQuadIdxRef.current]?.murals;
          if (!qMurals || qMurals.length === 0) return prev;
          return Math.max(0, Math.min(qMurals.length - 1, prev + dir));
        });
        return;
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

  /* reset active mural index, quad index, and zoom when wall changes */
  useEffect(() => {
    setActiveMuralIdx(0);
    setActiveQuadIdx(0);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [selectedIdx]);

  /* reset drag state when active mural changes to prevent stale drags */
  useEffect(() => {
    dragRef.current = { kind: 'none' };
  }, [activeMuralIdx]);

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
      const qi = activeQuadIdxRef.current;
      if (!w.quads[qi]) return;
      const quads = [...w.quads];
      const quad = { ...quads[qi] };
      const murals = [...quad.murals];
      murals[muralIdx] = { ...murals[muralIdx], ...patch };
      quad.murals = murals;
      quads[qi] = quad;
      cur[wallIdx] = { ...w, quads };
      onWallsChange(cur, wallIdx);
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
      const qi = activeQuadIdxRef.current;
      const cur = [...wallsRef.current];
      const w = cur[idx];
      if (!w.quads[qi]) return;
      const existingCount = w.quads[qi].murals.length;

      // Add all files as new murals with empty thumbs first
      const newMurals: MuralPlacement[] = fileArr.map(file => ({
        id: genId(),
        muralPoolId: genId(),
        file,
        thumbUrl: '',
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        rotation: 0,
        comment: '',
      }));

      const quads = [...w.quads];
      quads[qi] = { ...quads[qi], murals: [...quads[qi].murals, ...newMurals] };
      cur[idx] = { ...w, quads };
      onWallsChange(cur, idx);
      setActiveMuralIdx(existingCount); // select first new one

      // Generate thumbnails progressively and add to mural pool
      const newPoolEntries: MuralPoolEntry[] = [];
      for (let i = 0; i < fileArr.length; i++) {
        const thumbUrl = await generateThumb(fileArr[i]);
        const latest = [...wallsRef.current];
        const lw = latest[idx];
        if (lw && lw.quads[qi]) {
          const lQuads = [...lw.quads];
          const lQuad = { ...lQuads[qi] };
          const murals = [...lQuad.murals];
          const mi = existingCount + i;
          if (mi < murals.length) {
            murals[mi] = { ...murals[mi], thumbUrl };
            lQuad.murals = murals;
            lQuads[qi] = lQuad;
            latest[idx] = { ...lw, quads: lQuads };
            onWallsChange(latest, idx);

            // Also add to mural pool
            const poolId = murals[mi].muralPoolId;
            if (poolId && !muralPool.some(p => p.id === poolId)) {
              newPoolEntries.push({
                id: poolId,
                file: fileArr[i],
                blob: fileArr[i],
                thumbUrl,
              });
            }
          }
        }
      }
      if (newPoolEntries.length > 0) {
        onMuralPoolChange([...muralPool, ...newPoolEntries]);
      }

      e.target.value = '';
    },
    [onWallsChange, muralPool, onMuralPoolChange],
  );

  /* ---- duplicate mural -------------------------------------------- */

  const handleDuplicate = useCallback(() => {
    const idx = selectedRef.current;
    const qi = activeQuadIdxRef.current;
    const w = wallsRef.current[idx];
    const qObj = w?.quads[qi];
    const mural = qObj?.murals[activeMuralIdx];
    if (!mural || !qObj) return;

    const dup: MuralPlacement = {
      ...mural,
      id: genId(),
      comment: mural.comment ? `${mural.comment} (copy)` : '',
    };

    const cur = [...wallsRef.current];
    const quads = [...cur[idx].quads];
    const murals = [...quads[qi].murals, dup];
    quads[qi] = { ...quads[qi], murals };
    cur[idx] = { ...cur[idx], quads };
    onWallsChange(cur, idx);
    setActiveMuralIdx(murals.length - 1);
  }, [onWallsChange, activeMuralIdx]);

  /* ---- remove mural ----------------------------------------------- */

  const handleRemoveMural = useCallback(() => {
    const idx = selectedRef.current;
    const qi = activeQuadIdxRef.current;
    const w = wallsRef.current[idx];
    if (!w || !w.quads[qi] || w.quads[qi].murals.length === 0) return;

    const cur = [...wallsRef.current];
    const quads = [...cur[idx].quads];
    const murals = [...quads[qi].murals];
    murals.splice(activeMuralIdx, 1);
    quads[qi] = { ...quads[qi], murals };
    cur[idx] = { ...cur[idx], quads };
    onWallsChange(cur, idx);
    setActiveMuralIdx((prev) => Math.min(prev, Math.max(0, murals.length - 1)));
  }, [onWallsChange, activeMuralIdx]);

  /* ---- mural thumb drag-to-reorder -------------------------------- */

  const handleMuralThumbPointerDown = useCallback((i: number, e: React.PointerEvent) => {
    muralDragFromIdx.current = i;
    const startY = e.clientY;
    let dragging = false;
    muralDragOverIdxRef.current = null;

    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientY - startY) > 5) dragging = true;
      if (!dragging) return;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!el) return;
      const thumbEl = el.closest('[data-mural-alt-idx]') as HTMLElement | null;
      if (thumbEl) {
        const idx = parseInt(thumbEl.dataset.muralAltIdx!, 10);
        if (!isNaN(idx)) {
          muralDragOverIdxRef.current = idx;
          setMuralDragOverIdx(idx);
        }
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const from = muralDragFromIdx.current;
      const to = muralDragOverIdxRef.current;
      if (dragging && from !== null && to !== null && from !== to) {
        const newWalls = [...walls];
        const w = { ...newWalls[selectedIdx] };
        const quads = [...w.quads];
        const q = { ...quads[activeQuadIdx] };
        const murals = [...q.murals];
        const [moved] = murals.splice(from, 1);
        murals.splice(to, 0, moved);
        q.murals = murals;
        quads[activeQuadIdx] = q;
        w.quads = quads;
        newWalls[selectedIdx] = w;
        onWallsChange(newWalls, selectedIdx);
        setActiveMuralIdx(to);
      }
      muralDragFromIdx.current = null;
      muralDragOverIdxRef.current = null;
      setMuralDragOverIdx(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [walls, selectedIdx, activeQuadIdx, onWallsChange]);

  /* ---- auto-fit / auto-fill --------------------------------------- */

  const handleAutoFit = useCallback(() => {
    const layout = layoutRef.current;
    const w = wallsRef.current[selectedRef.current];
    const mural = w?.quads[activeQuadIdxRef.current]?.murals[activeMuralIdx];
    if (!layout || !mural) return;
    const { muralAspect, quadAspect } = layout;
    const fitScale = Math.min(1, muralAspect / quadAspect);
    updateMural(selectedRef.current, activeMuralIdx, {
      scale: fitScale, offsetX: 0, offsetY: 0, rotation: 0,
    });
  }, [activeMuralIdx, updateMural]);

  const handleAutoFill = useCallback(() => {
    const layout = layoutRef.current;
    const w = wallsRef.current[selectedRef.current];
    const mural = w?.quads[activeQuadIdxRef.current]?.murals[activeMuralIdx];
    if (!layout || !mural) return;
    const { muralAspect, quadAspect } = layout;
    const fillScale = Math.max(1, muralAspect / quadAspect);
    updateMural(selectedRef.current, activeMuralIdx, {
      scale: fillScale, offsetX: 0, offsetY: 0, rotation: 0,
    });
  }, [activeMuralIdx, updateMural]);

  /* ---- snap center ------------------------------------------------ */

  const handleSnapCenter = useCallback(() => {
    updateMural(selectedRef.current, activeMuralIdx, { offsetX: 0, offsetY: 0 });
  }, [activeMuralIdx, updateMural]);

  /* ---- copy / paste placement settings ----------------------------- */

  const handleCopySettings = useCallback(() => {
    const w = wallsRef.current[selectedRef.current];
    const mural = w?.quads[activeQuadIdxRef.current]?.murals[activeMuralIdx];
    if (!mural) return;
    copiedSettings = {
      scale: mural.scale,
      offsetX: mural.offsetX,
      offsetY: mural.offsetY,
      rotation: mural.rotation ?? 0,
      opacity: mural.opacity ?? 1,
      blendMode: (mural.blendMode ?? 'source-over') as GlobalCompositeOperation,
      clipLeft: mural.clipLeft ?? 0,
      clipRight: mural.clipRight ?? 0,
      clipTop: mural.clipTop ?? 0,
      clipBottom: mural.clipBottom ?? 0,
    };
  }, [activeMuralIdx]);

  const handlePasteSettings = useCallback(() => {
    if (!copiedSettings) return;
    updateMural(selectedRef.current, activeMuralIdx, { ...copiedSettings });
  }, [activeMuralIdx, updateMural]);

  /* ---- double-click to set center --------------------------------- */

  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const layout = layoutRef.current;
    const w = wallsRef.current[selectedRef.current];
    const mural = w?.quads[activeQuadIdxRef.current]?.murals[activeMuralIdx];
    if (!layout || !mural || !w?.quads[activeQuadIdxRef.current]?.corners) return;

    const { x: mx, y: my } = getCanvasXY(e);
    const { quadCanvas } = layout;
    const { u, v } = canvasToQuadUV(mx, my, quadCanvas);

    // Convert UV (0-1) to offset (-100 to 100)
    const newOffsetX = (u - 0.5) * 100;
    const newOffsetY = (v - 0.5) * 100;
    updateMural(selectedRef.current, activeMuralIdx, {
      offsetX: Math.max(-100, Math.min(100, newOffsetX)),
      offsetY: Math.max(-100, Math.min(100, newOffsetY)),
    });
  }, [activeMuralIdx, getCanvasXY, updateMural]);

  /* ---- keyboard shortcuts for copy/paste settings ------------------ */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        handleCopySettings();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'V') {
        e.preventDefault();
        handlePasteSettings();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleCopySettings, handlePasteSettings]);

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

  const muralCount = activeQuad?.murals.length ?? 0;
  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 min-h-0">
        {/* ---- Left Sidebar: Wall thumbs ---- */}
        <div className="w-[100px] border-r bg-gray-50 flex flex-col">
          <div
            ref={thumbListRef}
            className="flex-1 overflow-y-auto hide-scrollbar p-2 space-y-2 flex flex-col items-center"
          >
            {walls.map((w, i) => (
              <Thumb
                key={w.id}
                wall={w}
                index={i}
                selected={i === selectedIdx}
                hasQuad={w.quads.length > 0 && w.quads.some(q => !!q?.corners)}
                hasMurals={w.quads.some(q => q.murals.length > 0)}
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
            onDoubleClick={handleDoubleClick}
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
        <div data-sidebar className="w-[200px] border-l bg-white flex flex-col">
          {/* Header + load button */}
          <div className="p-3 border-b">
            <button
              onClick={() => {
                setSelectedPoolIds(new Set());
                setPickerTab(muralPool.length > 0 ? 'library' : 'files');
                setShowMuralPicker(true);
              }}
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
              onChange={(e) => {
                handleLoadMural(e);
                setShowMuralPicker(false);
              }}
            />
            <button
              onClick={() => {
                if (!selectedWall || !selectedWall.quads[activeQuadIdx] || muralPool.length === 0) return;
                const quad = selectedWall.quads[activeQuadIdx];
                if (quad.murals.length > 0) return; // only auto-fill empty quads
                // Pick up to 5 random entries from muralPool
                const shuffled = [...muralPool].sort(() => Math.random() - 0.5);
                const picks = shuffled.slice(0, Math.min(5, shuffled.length));
                const newMurals: MuralPlacement[] = picks.map(entry => ({
                  id: genId(),
                  muralPoolId: entry.id,
                  file: entry.file,
                  thumbUrl: entry.thumbUrl,
                  scale: 1,
                  offsetX: 0,
                  offsetY: 0,
                  rotation: 0,
                  rotationLocked: true,
                  opacity: 1,
                  blendMode: 'source-over' as GlobalCompositeOperation,
                  comment: '',
                }));
                const newWalls = [...walls];
                const w = { ...newWalls[selectedIdx] };
                const quads = [...w.quads];
                const q = { ...quads[activeQuadIdx] };
                q.murals = [...q.murals, ...newMurals];
                quads[activeQuadIdx] = q;
                w.quads = quads;
                newWalls[selectedIdx] = w;
                onWallsChange(newWalls, selectedIdx);
                setActiveMuralIdx(0);
              }}
              disabled={!hasQuad || muralPool.length === 0 || (activeQuad?.murals.length ?? 0) > 0}
              className={cn(
                'w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors mt-1.5',
                hasQuad && muralPool.length > 0 && (activeQuad?.murals.length ?? 0) === 0
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed',
              )}
            >
              <Shuffle className="w-3.5 h-3.5" />
              Quick Fill
            </button>
          </div>

          {/* Mural Picker Modal */}
          {showMuralPicker && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 overflow-hidden"
              onClick={() => setShowMuralPicker(false)}
            >
              <div
                className="bg-white rounded-xl shadow-2xl w-[700px] max-w-[90vw] max-h-[85vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
              >
                {/* Modal header */}
                <div className="flex items-center justify-between px-4 py-3 border-b">
                  <h3 className="text-sm font-semibold text-slate-700">Load Mural</h3>
                  <button
                    onClick={() => setShowMuralPicker(false)}
                    className="p-1 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Tab buttons */}
                <div className="flex border-b">
                  <button
                    onClick={() => setPickerTab('files')}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors border-b-2',
                      pickerTab === 'files'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-slate-400 hover:text-slate-600',
                    )}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    Browse Files
                  </button>
                  <button
                    onClick={() => setPickerTab('library')}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors border-b-2',
                      pickerTab === 'library'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-slate-400 hover:text-slate-600',
                    )}
                  >
                    <Grid3X3 className="w-3.5 h-3.5" />
                    Library
                    {muralPool.length > 0 && (
                      <span className="ml-1 text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{muralPool.length}</span>
                    )}
                  </button>
                </div>

                {/* Tab content */}
                <div className="flex-1 overflow-y-auto min-h-0 p-4">
                  {pickerTab === 'files' && (
                    <div className="flex flex-col items-center justify-center py-10 gap-3">
                      <FolderOpen className="w-10 h-10 text-slate-300" />
                      <p className="text-sm text-slate-500">Select image files from your computer</p>
                      <button
                        onClick={() => muralInputRef.current?.click()}
                        className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
                      >
                        Choose Files
                      </button>
                    </div>
                  )}

                  {pickerTab === 'library' && (
                    <>
                      {muralPool.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 gap-2">
                          <Grid3X3 className="w-10 h-10 text-slate-300" />
                          <p className="text-sm text-slate-500">No murals in the library yet</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-4 gap-2">
                          {muralPool.map(entry => {
                            const isSelected = selectedPoolIds.has(entry.id);
                            const isAssigned = selectedWall?.quads[activeQuadIdx]?.murals.some(m => m.muralPoolId === entry.id);
                            return (
                              <button
                                key={entry.id}
                                onClick={() => {
                                  if (isAssigned) return;
                                  setSelectedPoolIds(prev => {
                                    const next = new Set(prev);
                                    if (next.has(entry.id)) next.delete(entry.id);
                                    else next.add(entry.id);
                                    return next;
                                  });
                                }}
                                className={cn(
                                  'relative w-full aspect-square rounded-lg overflow-hidden border-2 transition-all',
                                  isAssigned
                                    ? 'border-slate-200 opacity-40 cursor-not-allowed'
                                    : isSelected
                                      ? 'border-blue-500 ring-2 ring-blue-300'
                                      : 'border-slate-200 hover:border-blue-300',
                                )}
                                title={isAssigned ? 'Already added to this quad' : isSelected ? 'Click to deselect' : 'Click to select'}
                              >
                                <img src={entry.thumbUrl} className="w-full h-full object-cover" alt="" draggable={false} />
                                {isAssigned && (
                                  <div className="absolute inset-0 flex items-center justify-center bg-white/60">
                                    <span className="text-[9px] font-medium text-slate-500">Added</span>
                                  </div>
                                )}
                                {isSelected && !isAssigned && (
                                  <div className="absolute top-1 right-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Footer with action buttons */}
                {pickerTab === 'library' && (
                  <div className="flex items-center justify-between px-4 py-3 border-t bg-slate-50 rounded-b-xl">
                    <button
                      onClick={() => setShowMuralPicker(false)}
                      className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        if (!selectedWall || !selectedWall.quads[activeQuadIdx] || selectedPoolIds.size === 0) return;
                        const newMurals: MuralPlacement[] = [];
                        for (const poolId of selectedPoolIds) {
                          const entry = muralPool.find(e => e.id === poolId);
                          if (!entry) continue;
                          newMurals.push({
                            id: genId(),
                            muralPoolId: entry.id,
                            file: entry.file,
                            thumbUrl: entry.thumbUrl,
                            scale: 1,
                            offsetX: 0,
                            offsetY: 0,
                            rotation: 0,
                            rotationLocked: true,
                            opacity: 1,
                            blendMode: 'source-over',
                            comment: '',
                          });
                        }
                        const newWalls = [...walls];
                        const w = { ...newWalls[selectedIdx] };
                        const quads = [...w.quads];
                        const q = { ...quads[activeQuadIdx] };
                        q.murals = [...q.murals, ...newMurals];
                        quads[activeQuadIdx] = q;
                        w.quads = quads;
                        newWalls[selectedIdx] = w;
                        onWallsChange(newWalls, selectedIdx);
                        setShowMuralPicker(false);
                        setSelectedPoolIds(new Set());
                      }}
                      disabled={selectedPoolIds.size === 0}
                      className={cn(
                        'px-4 py-1.5 text-xs font-medium rounded-md transition-colors',
                        selectedPoolIds.size > 0
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-slate-200 text-slate-400 cursor-not-allowed',
                      )}
                    >
                      Add Selected ({selectedPoolIds.size})
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Mural alternatives list */}
          <div className="flex-1 overflow-y-auto hide-scrollbar p-2 space-y-2">
            {activeQuad?.murals.map((m, i) => (
              <div
                key={m.id}
                data-mural-alt-idx={i}
                className={cn(
                  muralDragOverIdx === i && muralDragFromIdx.current !== i && 'border-t-2 border-blue-500',
                )}
              >
                <MuralThumb
                  mural={m}
                  index={i}
                  selected={i === activeMuralIdx}
                  onSelect={setActiveMuralIdx}
                  onRemove={(idx) => {
                    const newWalls = [...walls];
                    const w = { ...newWalls[selectedIdx] };
                    const quads = [...w.quads];
                    const q = { ...quads[activeQuadIdx] };
                    q.murals = q.murals.filter((_, mi) => mi !== idx);
                    quads[activeQuadIdx] = q;
                    w.quads = quads;
                    newWalls[selectedIdx] = w;
                    onWallsChange(newWalls, selectedIdx);
                    if (activeMuralIdx >= q.murals.length) setActiveMuralIdx(Math.max(0, q.murals.length - 1));
                  }}
                  onPointerDown={handleMuralThumbPointerDown}
                />
              </div>
            ))}

            {muralCount === 0 && hasQuad && (
              <div className="text-center text-gray-400 text-xs py-6">
                No murals yet
              </div>
            )}
          </div>

          {/* Action buttons + controls for selected mural */}
          {activeMural && (
            <div className="border-t p-3 space-y-2">
              {/* Quick actions row */}
              <div className="flex gap-1">
                <button
                  onClick={handleAutoFit}
                  className="flex-1 flex items-center justify-center gap-1 px-1 py-1.5 text-[10px] rounded-md hover:bg-gray-100 transition-colors text-gray-600 border border-gray-200"
                  title="Fit mural inside quad (contain)"
                >
                  <Maximize className="w-3 h-3" />
                  Fit
                </button>
                <button
                  onClick={handleAutoFill}
                  className="flex-1 flex items-center justify-center gap-1 px-1 py-1.5 text-[10px] rounded-md hover:bg-gray-100 transition-colors text-gray-600 border border-gray-200"
                  title="Fill quad with mural (cover)"
                >
                  <Square className="w-3 h-3" />
                  Fill
                </button>
                <button
                  onClick={handleSnapCenter}
                  className="flex-1 flex items-center justify-center gap-1 px-1 py-1.5 text-[10px] rounded-md hover:bg-gray-100 transition-colors text-gray-600 border border-gray-200"
                  title="Snap to center (double-click wall to set)"
                >
                  <Crosshair className="w-3 h-3" />
                  Center
                </button>
              </div>

              {/* Clip mask */}
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-gray-500 uppercase">Clip Edges</label>
                {([
                  ['clipLeft', 'L'],
                  ['clipRight', 'R'],
                  ['clipTop', 'T'],
                  ['clipBottom', 'B'],
                ] as const).map(([field, label]) => (
                  <div key={field} className="flex items-center gap-2">
                    <span className="text-[9px] text-gray-500 w-3">{label}</span>
                    <input
                      type="range"
                      min="0"
                      max="0.45"
                      step="0.01"
                      value={(activeMural as any)[field] ?? 0}
                      onChange={e => updateMural(selectedIdx, activeMuralIdx, { [field]: parseFloat(e.target.value) })}
                      className="flex-1 h-1.5 accent-amber-500"
                    />
                    <span className="text-[10px] text-gray-400 tabular-nums w-8 text-right">
                      {Math.round(((activeMural as any)[field] ?? 0) * 100)}%
                    </span>
                  </div>
                ))}
              </div>

              {/* Opacity */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-medium text-gray-500 uppercase">Opacity</label>
                  <span className="text-[10px] text-gray-400 tabular-nums">{Math.round((activeMural.opacity ?? 1) * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={activeMural.opacity ?? 1}
                  onChange={e => updateMural(selectedIdx, activeMuralIdx, { opacity: parseFloat(e.target.value) })}
                  className="w-full h-1.5 accent-indigo-500"
                />
              </div>

              {/* Blend mode */}
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-gray-500 uppercase">Blend</label>
                <select
                  value={activeMural.blendMode ?? 'source-over'}
                  onChange={e => updateMural(selectedIdx, activeMuralIdx, { blendMode: e.target.value as GlobalCompositeOperation })}
                  className="w-full text-xs px-2 py-1 rounded border border-gray-200 bg-white text-gray-700"
                >
                  <option value="source-over">Normal</option>
                  <option value="multiply">Multiply</option>
                  <option value="screen">Screen</option>
                  <option value="overlay">Overlay</option>
                  <option value="darken">Darken</option>
                  <option value="lighten">Lighten</option>
                  <option value="color-dodge">Color Dodge</option>
                  <option value="color-burn">Color Burn</option>
                  <option value="soft-light">Soft Light</option>
                  <option value="hard-light">Hard Light</option>
                </select>
              </div>

              {/* Buttons row */}
              <div className="flex gap-1.5">
                <button
                  onClick={() => updateMural(selectedIdx, activeMuralIdx, { liked: !activeMural.liked })}
                  className={cn(
                    'flex items-center justify-center px-2 py-1.5 text-xs rounded-md transition-colors border',
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
                </button>
                <button
                  onClick={handleRemoveMural}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-md hover:bg-red-50 hover:text-red-600 transition-colors text-gray-700 border border-gray-200"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Copy/Paste settings */}
              <div className="flex gap-1.5">
                <button
                  onClick={handleCopySettings}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-md hover:bg-gray-100 transition-colors text-gray-600 border border-gray-200"
                  title="Copy placement settings (Ctrl+Shift+C)"
                >
                  <ClipboardCopy className="w-3.5 h-3.5" />
                  Copy
                </button>
                <button
                  onClick={handlePasteSettings}
                  disabled={!copiedSettings}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-md transition-colors border',
                    copiedSettings
                      ? 'hover:bg-gray-100 text-gray-600 border-gray-200'
                      : 'text-gray-300 border-gray-100 cursor-not-allowed',
                  )}
                  title="Paste placement settings (Ctrl+Shift+V)"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  Paste
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
              {selectedWall && selectedWall.quads.length > 1 && (
                <div className="flex gap-1">
                  {selectedWall.quads.map((q, qi) => (
                    <button
                      key={q.id}
                      onClick={() => { setActiveQuadIdx(qi); setActiveMuralIdx(0); }}
                      className={cn(
                        'px-2 py-0.5 rounded text-xs font-medium transition-colors',
                        qi === activeQuadIdx
                          ? 'bg-indigo-500 text-white'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      )}
                      title={`Switch to quad ${qi + 1} (←/→)`}
                    >
                      Q{qi + 1}
                    </button>
                  ))}
                </div>
              )}
              <span className="text-gray-400 text-xs">
                {muralCount} mural{muralCount !== 1 ? 's' : ''}
              </span>
              {selectedWall?.quads.some(q => q.linkId) && (
                <span className="flex items-center gap-1 text-amber-500 text-xs font-medium" title="Murals sync across linked quads">
                  <Link className="w-3 h-3" />
                  Linked
                </span>
              )}
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
