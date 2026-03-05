import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { getFullBitmap } from '@/lib/image-cache';
import { cn } from '@/lib/utils';
import { Grid3X3, Crosshair, RotateCcw, RectangleHorizontal } from 'lucide-react';
import type { Wall, Corner } from '@/App';

interface WallsTabProps {
  walls: Wall[];
  onWallsChange: (walls: Wall[]) => void;
  selectedIdx: number;
  onSelectIdx: (idx: number) => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const HANDLE_RADIUS = 6; // circle radius for corner handles
const HIT_RADIUS = 12; // generous hit area for handles
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 8;
const ZOOM_FACTOR = 1.001; // per-pixel wheel zoom
const GRID_SUBDIVISIONS = 6;

/* ------------------------------------------------------------------ */
/*  Sidebar thumb (memoized)                                           */
/* ------------------------------------------------------------------ */

const SidebarThumb = memo(function SidebarThumb({
  wall,
  index,
  selected,
  onSelect,
}: {
  wall: Wall;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'relative w-full rounded-md overflow-hidden border-2 transition-all',
        selected
          ? 'border-indigo-500 shadow-sm'
          : 'border-transparent hover:border-slate-300',
      )}
    >
      <div className="aspect-[4/3] bg-slate-200 relative">
        <img
          src={wall.thumbUrl}
          alt={`Wall ${index + 1}`}
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
        />
        {/* Number badge */}
        <div className="absolute bottom-0.5 left-0.5 bg-black/60 text-white text-[9px] font-bold px-1 rounded">
          {index + 1}
        </div>
        {/* Quad indicator */}
        {wall.quad && (
          <div className="absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-emerald-600" />
        )}
      </div>
    </button>
  );
});

/* ------------------------------------------------------------------ */
/*  Bilinear interpolation helper                                      */
/* ------------------------------------------------------------------ */

function bilinearInterp(
  quad: [Corner, Corner, Corner, Corner],
  u: number,
  v: number,
): Corner {
  const [tl, tr, br, bl] = quad;
  const x =
    (1 - u) * (1 - v) * tl.x +
    u * (1 - v) * tr.x +
    u * v * br.x +
    (1 - u) * v * bl.x;
  const y =
    (1 - u) * (1 - v) * tl.y +
    u * (1 - v) * tr.y +
    u * v * br.y +
    (1 - u) * v * bl.y;
  return { x, y };
}

/* ------------------------------------------------------------------ */
/*  Line intersection for vanishing point                              */
/* ------------------------------------------------------------------ */

function lineIntersection(
  p1: Corner,
  p2: Corner,
  p3: Corner,
  p4: Corner,
): Corner | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null; // parallel
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function WallsTab({
  walls,
  onWallsChange,
  selectedIdx,
  onSelectIdx,
}: WallsTabProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Canvas state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [draggingCorner, setDraggingCorner] = useState<number | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [showGuides, setShowGuides] = useState(false);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  // Click-to-place mode: tracks which corner (0-3) to place next, null = done
  const [placingCornerIdx, setPlacingCornerIdx] = useState<number | null>(null);
  // Partial corners being placed (before all 4 are defined)
  const [partialCorners, setPartialCorners] = useState<Corner[]>([]);

  // Refs for animation frame
  const rafRef = useRef<number>(0);
  const panStartRef = useRef({ x: 0, y: 0 });
  const mouseStartRef = useRef({ x: 0, y: 0 });

  const wall = walls[selectedIdx] ?? null;
  const quad = wall?.quad ?? null;

  /* ---------------------------------------------------------------- */
  /*  Load bitmap when selected wall changes                           */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!wall) {
      setBitmap(null);
      return;
    }
    let cancelled = false;
    getFullBitmap(wall.blob).then((bmp) => {
      if (!cancelled) setBitmap(bmp);
    });
    return () => {
      cancelled = true;
    };
  }, [wall?.id, wall?.blob]);

  // Reset zoom/pan and placing mode when wall changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setPlacingCornerIdx(null);
    setPartialCorners([]);
  }, [selectedIdx]);

  /* ---------------------------------------------------------------- */
  /*  Compute image-to-canvas transform                                */
  /* ---------------------------------------------------------------- */

  const getImageTransform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap) return null;

    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.width / dpr;
    const ch = canvas.height / dpr;

    const padding = 16;
    const crop = wall?.crop;
    const sw = crop?.w ?? bitmap.width;
    const sh = crop?.h ?? bitmap.height;
    const availW = cw - padding * 2;
    const availH = ch - padding * 2;
    const fitScale = Math.min(availW / sw, availH / sh, 1);
    const dw = sw * fitScale;
    const dh = sh * fitScale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;

    return { dx, dy, dw, dh, sw, sh, fitScale, cw, ch };
  }, [bitmap, wall?.crop]);

  /* ---------------------------------------------------------------- */
  /*  Screen <-> image coordinate conversion                           */
  /* ---------------------------------------------------------------- */

  const screenToImage = useCallback(
    (sx: number, sy: number): Corner | null => {
      const t = getImageTransform();
      if (!t) return null;
      // screen -> canvas (accounting for pan/zoom)
      const cx = (sx - pan.x) / zoom;
      const cy = (sy - pan.y) / zoom;
      // canvas -> image normalized (relative to image draw area)
      const ix = (cx - t.dx) / t.dw;
      const iy = (cy - t.dy) / t.dh;
      return { x: ix, y: iy };
    },
    [getImageTransform, pan, zoom],
  );

  const imageToScreen = useCallback(
    (ix: number, iy: number): Corner | null => {
      const t = getImageTransform();
      if (!t) return null;
      const cx = t.dx + ix * t.dw;
      const cy = t.dy + iy * t.dh;
      return { x: cx * zoom + pan.x, y: cy * zoom + pan.y };
    },
    [getImageTransform, pan, zoom],
  );

  /* ---------------------------------------------------------------- */
  /*  Canvas drawing                                                   */
  /* ---------------------------------------------------------------- */

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const container = canvas.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    // Background
    ctx.fillStyle = '#1e1e2e';
    ctx.fillRect(0, 0, cw, ch);

    if (!bitmap) return;

    const t = getImageTransform();
    if (!t) return;

    // Apply pan/zoom transform
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw image
    const crop = wall?.crop;
    const sx = crop?.x ?? 0;
    const sy = crop?.y ?? 0;
    ctx.drawImage(
      bitmap,
      sx,
      sy,
      t.sw,
      t.sh,
      t.dx,
      t.dy,
      t.dw,
      t.dh,
    );

    ctx.restore();

    // Draw quad overlay in screen coordinates
    if (quad) {
      const corners = quad.map((c) => imageToScreen(c.x, c.y)!);
      if (corners.every(Boolean)) {
        // Quad fill
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(99, 102, 241, 0.04)';
        ctx.fill();

        // Quad outline
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Grid overlay
        if (showGrid) {
          ctx.strokeStyle = 'rgba(99, 102, 241, 0.25)';
          ctx.lineWidth = 1;
          for (let i = 1; i < GRID_SUBDIVISIONS; i++) {
            const u = i / GRID_SUBDIVISIONS;
            // Horizontal lines
            ctx.beginPath();
            for (let j = 0; j <= GRID_SUBDIVISIONS; j++) {
              const v = j / GRID_SUBDIVISIONS;
              const p = bilinearInterp(quad, v, u);
              const sp = imageToScreen(p.x, p.y);
              if (sp) {
                if (j === 0) ctx.moveTo(sp.x, sp.y);
                else ctx.lineTo(sp.x, sp.y);
              }
            }
            ctx.stroke();
            // Vertical lines
            ctx.beginPath();
            for (let j = 0; j <= GRID_SUBDIVISIONS; j++) {
              const v = j / GRID_SUBDIVISIONS;
              const p = bilinearInterp(quad, u, v);
              const sp = imageToScreen(p.x, p.y);
              if (sp) {
                if (j === 0) ctx.moveTo(sp.x, sp.y);
                else ctx.lineTo(sp.x, sp.y);
              }
            }
            ctx.stroke();
          }
        }

        // Vanishing point guides
        if (showGuides) {
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
          ctx.lineWidth = 1;

          // Extend top & bottom edges
          const vp1 = lineIntersection(corners[0], corners[1], corners[3], corners[2]);
          if (vp1) {
            ctx.beginPath();
            ctx.moveTo(corners[0].x, corners[0].y);
            ctx.lineTo(vp1.x, vp1.y);
            ctx.moveTo(corners[3].x, corners[3].y);
            ctx.lineTo(vp1.x, vp1.y);
            ctx.stroke();
          }

          // Extend left & right edges
          const vp2 = lineIntersection(corners[0], corners[3], corners[1], corners[2]);
          if (vp2) {
            ctx.beginPath();
            ctx.moveTo(corners[0].x, corners[0].y);
            ctx.lineTo(vp2.x, vp2.y);
            ctx.moveTo(corners[1].x, corners[1].y);
            ctx.lineTo(vp2.x, vp2.y);
            ctx.stroke();
          }

          ctx.setLineDash([]);
        }

        // Corner handles (small circles)
        corners.forEach((c) => {
          ctx.beginPath();
          ctx.arc(c.x, c.y, HANDLE_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(99, 102, 241, 0.9)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });

        ctx.restore();
      }
    }

    // Draw partial corners during click-to-place mode
    if (placingCornerIdx !== null && partialCorners.length > 0) {
      const screenCorners = partialCorners.map(c => imageToScreen(c.x, c.y)).filter(Boolean) as Corner[];
      if (screenCorners.length > 0) {
        ctx.save();
        // Draw lines between placed corners
        ctx.beginPath();
        ctx.moveTo(screenCorners[0].x, screenCorners[0].y);
        for (let i = 1; i < screenCorners.length; i++) {
          ctx.lineTo(screenCorners[i].x, screenCorners[i].y);
        }
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.6)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw corner handles
        screenCorners.forEach((c, i) => {
          ctx.beginPath();
          ctx.arc(c.x, c.y, HANDLE_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(99, 102, 241, 0.9)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          // Label
          ctx.fillStyle = 'rgba(99, 102, 241, 1)';
          ctx.font = 'bold 10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`${i + 1}`, c.x, c.y - 10);
        });
        ctx.restore();
      }
    }
  }, [bitmap, pan, zoom, quad, showGrid, showGuides, getImageTransform, imageToScreen, wall?.crop, placingCornerIdx, partialCorners]);

  /* ---------------------------------------------------------------- */
  /*  Redraw triggers                                                  */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    draw();
  }, [draw]);

  // ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  /* ---------------------------------------------------------------- */
  /*  Mouse interaction                                                */
  /* ---------------------------------------------------------------- */

  const getCanvasCoords = useCallback(
    (e: ReactMouseEvent | MouseEvent): Corner => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    [],
  );

  const findHitCorner = useCallback(
    (screenPos: Corner): number | null => {
      if (!quad) return null;
      for (let i = 0; i < 4; i++) {
        const sp = imageToScreen(quad[i].x, quad[i].y);
        if (!sp) continue;
        const dx = screenPos.x - sp.x;
        const dy = screenPos.y - sp.y;
        if (dx * dx + dy * dy <= HIT_RADIUS * HIT_RADIUS) return i;
      }
      return null;
    },
    [quad, imageToScreen],
  );

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      if (e.button !== 0) return;
      const pos = getCanvasCoords(e);

      // Click-to-place mode: place next corner
      if (placingCornerIdx !== null && bitmap) {
        const imgPos = screenToImage(pos.x, pos.y);
        if (!imgPos) return;
        const cx = Math.max(0, Math.min(1, imgPos.x));
        const cy = Math.max(0, Math.min(1, imgPos.y));
        const newCorners = [...partialCorners, { x: cx, y: cy }];

        if (newCorners.length >= 4) {
          // All 4 corners placed — create the quad
          const newQuad = newCorners.slice(0, 4) as [Corner, Corner, Corner, Corner];
          const newWalls = walls.map((w, i) =>
            i === selectedIdx ? { ...w, quad: newQuad } : w,
          );
          onWallsChange(newWalls);
          setPlacingCornerIdx(null);
          setPartialCorners([]);
        } else {
          setPartialCorners(newCorners);
          setPlacingCornerIdx(newCorners.length);
        }
        return;
      }

      // Check for corner hit
      const hitIdx = findHitCorner(pos);
      if (hitIdx !== null) {
        setDraggingCorner(hitIdx);
        return;
      }

      // Otherwise start panning
      setIsPanning(true);
      panStartRef.current = { ...pan };
      mouseStartRef.current = { x: e.clientX, y: e.clientY };
    },
    [getCanvasCoords, findHitCorner, pan, placingCornerIdx, partialCorners, bitmap, screenToImage, walls, selectedIdx, onWallsChange],
  );

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent) => {
      if (draggingCorner !== null && quad && wall) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          const pos = getCanvasCoords(e);
          const imgPos = screenToImage(pos.x, pos.y);
          if (!imgPos) return;
          // Clamp to 0-1
          const cx = Math.max(0, Math.min(1, imgPos.x));
          const cy = Math.max(0, Math.min(1, imgPos.y));
          const newQuad = [...quad] as [Corner, Corner, Corner, Corner];
          newQuad[draggingCorner] = { x: cx, y: cy };
          const newWalls = walls.map((w, i) =>
            i === selectedIdx ? { ...w, quad: newQuad } : w,
          );
          onWallsChange(newWalls);
        });
        return;
      }

      if (isPanning) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          const dx = e.clientX - mouseStartRef.current.x;
          const dy = e.clientY - mouseStartRef.current.y;
          setPan({
            x: panStartRef.current.x + dx,
            y: panStartRef.current.y + dy,
          });
        });
        return;
      }

      // Cursor style
      const canvas = canvasRef.current;
      if (!canvas) return;
      const pos = getCanvasCoords(e);
      if (placingCornerIdx !== null) {
        canvas.style.cursor = 'crosshair';
        return;
      }
      const hitIdx = findHitCorner(pos);
      canvas.style.cursor = hitIdx !== null ? 'crosshair' : 'default';
    },
    [
      draggingCorner,
      isPanning,
      quad,
      wall,
      walls,
      selectedIdx,
      onWallsChange,
      getCanvasCoords,
      screenToImage,
      findHitCorner,
      placingCornerIdx,
    ],
  );

  const handleMouseUp = useCallback(() => {
    setDraggingCorner(null);
    setIsPanning(false);
  }, []);

  // Native non-passive wheel listener for zoom (React registers wheel as passive)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const factor = Math.pow(ZOOM_FACTOR, -e.deltaY);
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
      const ratio = newZoom / zoom;
      setPan({
        x: pos.x - ratio * (pos.x - pan.x),
        y: pos.y - ratio * (pos.y - pan.y),
      });
      setZoom(newZoom);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoom, pan]);

  /* ---------------------------------------------------------------- */
  /*  Keyboard nav                                                     */
  /* ---------------------------------------------------------------- */

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (walls.length === 0) return;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        onSelectIdx(Math.max(0, selectedIdx - 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        onSelectIdx(Math.min(walls.length - 1, selectedIdx + 1));
      }
    },
    [walls.length, selectedIdx, onSelectIdx],
  );

  /* ---------------------------------------------------------------- */
  /*  Actions                                                          */
  /* ---------------------------------------------------------------- */

  const handleAutoDetect = useCallback(() => {
    // Default: 20% inset rectangle
    const newQuad: [Corner, Corner, Corner, Corner] = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ];
    const newWalls = walls.map((w, i) =>
      i === selectedIdx ? { ...w, quad: newQuad } : w,
    );
    onWallsChange(newWalls);
  }, [walls, selectedIdx, onWallsChange]);

  const handleStraighten = useCallback(() => {
    // Snap to centered rectangle preserving approximate aspect ratio
    if (!quad) return;
    const cx = quad.reduce((s, c) => s + c.x, 0) / 4;
    const cy = quad.reduce((s, c) => s + c.y, 0) / 4;
    const maxDx = Math.max(...quad.map((c) => Math.abs(c.x - cx)));
    const maxDy = Math.max(...quad.map((c) => Math.abs(c.y - cy)));
    const hw = Math.max(0.05, maxDx);
    const hh = Math.max(0.05, maxDy);
    const newQuad: [Corner, Corner, Corner, Corner] = [
      { x: cx - hw, y: cy - hh },
      { x: cx + hw, y: cy - hh },
      { x: cx + hw, y: cy + hh },
      { x: cx - hw, y: cy + hh },
    ];
    const newWalls = walls.map((w, i) =>
      i === selectedIdx ? { ...w, quad: newQuad } : w,
    );
    onWallsChange(newWalls);
  }, [quad, walls, selectedIdx, onWallsChange]);

  const handleReset = useCallback(() => {
    const newWalls = walls.map((w, i) =>
      i === selectedIdx ? { ...w, quad: undefined } : w,
    );
    onWallsChange(newWalls);
  }, [walls, selectedIdx, onWallsChange]);

  /* ---------------------------------------------------------------- */
  /*  Sidebar thumbs memoized list                                     */
  /* ---------------------------------------------------------------- */

  const sidebarThumbs = useMemo(
    () =>
      walls.map((w, i) => (
        <SidebarThumb
          key={w.id}
          wall={w}
          index={i}
          selected={i === selectedIdx}
          onSelect={() => onSelectIdx(i)}
        />
      )),
    [walls, selectedIdx, onSelectIdx],
  );

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  if (walls.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        No walls added yet. Add wall images in the Gallery tab.
      </div>
    );
  }

  return (
    <div
      className="flex h-full"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{ outline: 'none' }}
    >
      {/* Left sidebar: wall thumbnails */}
      <div
        ref={sidebarRef}
        className="w-[100px] shrink-0 border-r border-slate-200 bg-slate-50 overflow-y-auto p-1.5 space-y-1.5"
      >
        {sidebarThumbs}
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Canvas container */}
        <div ref={containerRef} className="flex-1 relative overflow-hidden">
          <canvas
            ref={canvasRef}
            className="absolute inset-0"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />

          {/* Prompt when no quad */}
          {!quad && bitmap && placingCornerIdx === null && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="pointer-events-auto bg-white/90 backdrop-blur-sm rounded-xl px-6 py-4 shadow-lg text-center space-y-3">
                <Crosshair className="w-8 h-8 text-indigo-400 mx-auto" />
                <p className="text-sm text-slate-600 font-medium">
                  Define the wall plane
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setPlacingCornerIdx(0); setPartialCorners([]); }}
                    className="px-4 py-2 rounded-lg bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-colors"
                  >
                    Click corners
                  </button>
                  <button
                    onClick={handleAutoDetect}
                    className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-100 transition-colors"
                  >
                    Auto rectangle
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Placing corners indicator */}
          {placingCornerIdx !== null && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none">
              <div className="bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg">
                Click to place corner {Math.min(partialCorners.length + 1, 4)} of 4
              </div>
            </div>
          )}
        </div>

        {/* Bottom bar */}
        <div className="h-12 shrink-0 border-t border-slate-200 bg-white flex items-center justify-between px-4">
          {/* Left: wall info */}
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium text-slate-700">
              Wall {selectedIdx + 1} / {walls.length}
            </span>
            {quad ? (
              <span className="text-emerald-600 text-xs font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                Quad defined
              </span>
            ) : (
              <span className="text-slate-400 text-xs">No quad</span>
            )}
          </div>

          {/* Right: controls */}
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-1.5 mr-3 border-r border-slate-200 pr-3">
              <button onClick={() => { setZoom(z => Math.max(MIN_ZOOM, z / 1.3)); }} className="p-1 rounded hover:bg-slate-100 text-slate-500">
                <span className="text-xs font-bold">&minus;</span>
              </button>
              <span className="text-xs text-slate-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
              <button onClick={() => { setZoom(z => Math.min(MAX_ZOOM, z * 1.3)); }} className="p-1 rounded hover:bg-slate-100 text-slate-500">
                <span className="text-xs font-bold">+</span>
              </button>
              <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="p-1 rounded hover:bg-slate-100 text-slate-500 text-[10px]">
                Fit
              </button>
            </div>
            <button
              onClick={() => setShowGrid((v) => !v)}
              disabled={!quad}
              className={cn(
                'p-2 rounded-md transition-colors',
                showGrid && quad
                  ? 'bg-indigo-100 text-indigo-600'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100',
                !quad && 'opacity-40 cursor-not-allowed',
              )}
              title="Toggle grid"
            >
              <Grid3X3 className="w-4 h-4" />
            </button>

            <button
              onClick={() => setShowGuides((v) => !v)}
              disabled={!quad}
              className={cn(
                'p-2 rounded-md transition-colors',
                showGuides && quad
                  ? 'bg-amber-100 text-amber-600'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100',
                !quad && 'opacity-40 cursor-not-allowed',
              )}
              title="Toggle vanishing guides"
            >
              <Crosshair className="w-4 h-4" />
            </button>

            <button
              onClick={handleStraighten}
              disabled={!quad}
              className={cn(
                'p-2 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors',
                !quad && 'opacity-40 cursor-not-allowed',
              )}
              title="Straighten to rectangle"
            >
              <RectangleHorizontal className="w-4 h-4" />
            </button>

            <button
              onClick={handleReset}
              disabled={!quad}
              className={cn(
                'p-2 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors',
                !quad && 'opacity-40 cursor-not-allowed',
              )}
              title="Reset quad"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
