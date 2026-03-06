import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { getFullBitmap } from '@/lib/image-cache';
import { cn } from '@/lib/utils';
import { Grid3X3, Crosshair, RotateCcw, RotateCw, RectangleHorizontal, ClipboardCopy, ClipboardPaste, Link, Unlink, Plus, Trash2 } from 'lucide-react';
import type { Wall, Corner, QuadSurface } from '@/App';

interface WallsTabProps {
  walls: Wall[];
  onWallsChange: (walls: Wall[], changedIdx?: number) => void;
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
  const isLinked = wall.quads.some(q => q.linkId);
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
        {wall.quads.length > 0 && (
          <div className="absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border border-emerald-600" />
        )}
        {/* Link indicator */}
        {isLinked && (
          <div className="absolute top-0.5 left-0.5" title="Linked wall">
            <Link className="w-2.5 h-2.5 text-amber-400 drop-shadow-sm" />
          </div>
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
  const [showLoupe, setShowLoupe] = useState(false);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  // Click-to-place mode: tracks which corner (0-3) to place next, null = done
  const [placingCornerIdx, setPlacingCornerIdx] = useState<number | null>(null);
  // Partial corners being placed (before all 4 are defined)
  const [partialCorners, setPartialCorners] = useState<Corner[]>([]);

  // Multi-quad support
  const [activeQuadIdx, setActiveQuadIdx] = useState(0);
  // Edge dragging
  const [draggingEdge, setDraggingEdge] = useState<number | null>(null);
  const edgeDragStartRef = useRef<{ quad: [Corner, Corner, Corner, Corner]; mouseImg: Corner } | null>(null);

  // Refs for animation frame
  const rafRef = useRef<number>(0);
  const panStartRef = useRef({ x: 0, y: 0 });
  const mouseStartRef = useRef({ x: 0, y: 0 });

  const [copiedQuad, setCopiedQuad] = useState<[Corner, Corner, Corner, Corner] | null>(null);
  const [showLinkPopover, setShowLinkPopover] = useState(false);
  const mousePosRef = useRef<Corner | null>(null);

  const wall = walls[selectedIdx] ?? null;
  const quad = wall?.quads[activeQuadIdx]?.corners ?? null;
  const activeQuad = wall?.quads[activeQuadIdx] ?? null;

  /* helper: create updated wall with new quad corners on given quad index */
  function wallWithQuadCorners(w: Wall, corners: [Corner, Corner, Corner, Corner] | undefined, quadIdx: number = activeQuadIdx): Wall {
    if (!corners) {
      // Reset: remove quad at quadIdx
      const quads = w.quads.filter((_, i) => i !== quadIdx);
      return { ...w, quads };
    }
    if (quadIdx >= w.quads.length) {
      // Create new quad (appending)
      return { ...w, quads: [...w.quads, { id: crypto.randomUUID(), corners, murals: [] }] };
    }
    // Update existing quad's corners
    const quads = [...w.quads];
    quads[quadIdx] = { ...quads[quadIdx], corners };
    return { ...w, quads };
  }

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
    setActiveQuadIdx(0);
    setDraggingEdge(null);
    edgeDragStartRef.current = null;
  }, [selectedIdx]);

  // Auto-show grid when quad exists for active wall
  useEffect(() => {
    if (quad) setShowGrid(true);
    else setShowGrid(false);
  }, [selectedIdx, activeQuadIdx, quad]);

  // Auto-enter placing mode when wall has no quad
  useEffect(() => {
    if (wall && wall.quads.length === 0 && bitmap && placingCornerIdx === null) {
      setPlacingCornerIdx(0);
      setPartialCorners([]);
    }
  }, [wall?.id, bitmap]);

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

    // Draw ALL quads overlay in screen coordinates
    if (wall) {
      wall.quads.forEach((q, qi) => {
        const isActive = qi === activeQuadIdx;
        const qCorners = q.corners;
        const corners = qCorners.map((c) => imageToScreen(c.x, c.y)!);
        if (!corners.every(Boolean)) return;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();

        if (isActive) {
          ctx.fillStyle = 'rgba(99, 102, 241, 0.04)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)';
          ctx.lineWidth = 2;
        } else {
          ctx.fillStyle = 'rgba(148, 163, 184, 0.03)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
          ctx.lineWidth = 1;
        }
        ctx.stroke();

        // Grid only for active quad
        if (isActive && showGrid) {
          ctx.strokeStyle = 'rgba(99, 102, 241, 0.25)';
          ctx.lineWidth = 1;
          for (let i = 1; i < GRID_SUBDIVISIONS; i++) {
            const u = i / GRID_SUBDIVISIONS;
            // Horizontal lines
            ctx.beginPath();
            for (let j = 0; j <= GRID_SUBDIVISIONS; j++) {
              const v = j / GRID_SUBDIVISIONS;
              const p = bilinearInterp(qCorners, v, u);
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
              const p = bilinearInterp(qCorners, u, v);
              const sp = imageToScreen(p.x, p.y);
              if (sp) {
                if (j === 0) ctx.moveTo(sp.x, sp.y);
                else ctx.lineTo(sp.x, sp.y);
              }
            }
            ctx.stroke();
          }
        }

        // Vanishing point guides only for active quad
        if (isActive && showGuides) {
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

        // Corner handles
        if (isActive) {
          corners.forEach((c) => {
            ctx.beginPath();
            ctx.arc(c.x, c.y, HANDLE_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.9)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          });
        } else {
          // Small dots for inactive quad corners
          corners.forEach((c) => {
            ctx.beginPath();
            ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
            ctx.fill();
          });
        }
        ctx.restore();
      });
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

    // Magnification loupe during corner placing — draws directly from source bitmap
    const mousePos = mousePosRef.current;
    if (placingCornerIdx !== null && mousePos && bitmap && showLoupe) {
      const loupeRadius = 60;
      const loupeZoom = 4;

      // Position loupe offset from cursor (stay within canvas bounds)
      let lx = mousePos.x + loupeRadius + 20;
      let ly = mousePos.y - loupeRadius - 20;
      if (lx + loupeRadius > cw) lx = mousePos.x - loupeRadius - 20;
      if (ly - loupeRadius < 0) ly = mousePos.y + loupeRadius + 20;

      // Convert cursor CSS position to image pixel coordinates
      // The image is drawn at CSS coords: pan.x + zoom * t.dx, with size zoom * t.dw
      // So image fraction = ((mouseCSS - pan) / zoom - t.dx) / t.dw
      const imgFracX = ((mousePos.x - pan.x) / zoom - t.dx) / t.dw;
      const imgFracY = ((mousePos.y - pan.y) / zoom - t.dy) / t.dh;

      const crop = wall?.crop;
      const srcX0 = crop?.x ?? 0;
      const srcY0 = crop?.y ?? 0;
      const imgPixelX = srcX0 + imgFracX * t.sw;
      const imgPixelY = srcY0 + imgFracY * t.sh;

      // How many source pixels map to the loupe radius
      const pixelsInLoupe = loupeRadius / (t.fitScale * zoom * loupeZoom);

      ctx.save();
      ctx.beginPath();
      ctx.arc(lx, ly, loupeRadius, 0, Math.PI * 2);
      ctx.clip();

      // Background for areas outside the image
      ctx.fillStyle = '#1e1e2e';
      ctx.fillRect(lx - loupeRadius, ly - loupeRadius, loupeRadius * 2, loupeRadius * 2);

      // Draw the source bitmap magnified, centered on cursor's image position
      ctx.drawImage(
        bitmap,
        imgPixelX - pixelsInLoupe,
        imgPixelY - pixelsInLoupe,
        pixelsInLoupe * 2,
        pixelsInLoupe * 2,
        lx - loupeRadius,
        ly - loupeRadius,
        loupeRadius * 2,
        loupeRadius * 2,
      );

      // Crosshair
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(lx - loupeRadius, ly);
      ctx.lineTo(lx + loupeRadius, ly);
      ctx.moveTo(lx, ly - loupeRadius);
      ctx.lineTo(lx, ly + loupeRadius);
      ctx.stroke();

      // Center dot
      ctx.beginPath();
      ctx.arc(lx, ly, 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(99, 102, 241, 1)';
      ctx.fill();

      ctx.restore();

      // Border
      ctx.beginPath();
      ctx.arc(lx, ly, loupeRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }, [bitmap, pan, zoom, quad, showGrid, showGuides, showLoupe, getImageTransform, imageToScreen, wall?.crop, wall, activeQuadIdx, placingCornerIdx, partialCorners]);

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

  const findHitEdge = useCallback(
    (screenPos: Corner): number | null => {
      if (!quad) return null;
      const edges = [[0, 1], [1, 2], [2, 3], [3, 0]]; // top, right, bottom, left
      for (let i = 0; i < edges.length; i++) {
        const [a, b] = edges[i];
        const sa = imageToScreen(quad[a].x, quad[a].y);
        const sb = imageToScreen(quad[b].x, quad[b].y);
        if (!sa || !sb) continue;
        // Distance from point to line segment
        const dx = sb.x - sa.x;
        const dy = sb.y - sa.y;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) continue;
        const t = Math.max(0, Math.min(1, ((screenPos.x - sa.x) * dx + (screenPos.y - sa.y) * dy) / len2));
        const proj = { x: sa.x + t * dx, y: sa.y + t * dy };
        const d = Math.hypot(screenPos.x - proj.x, screenPos.y - proj.y);
        if (d < HIT_RADIUS && t > 0.15 && t < 0.85) return i; // only hit middle portion
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
        const cx = imgPos.x;
        const cy = imgPos.y;
        const newCorners = [...partialCorners, { x: cx, y: cy }];

        if (newCorners.length >= 4) {
          // All 4 corners placed — create the quad
          const newQuad = newCorners.slice(0, 4) as [Corner, Corner, Corner, Corner];
          const newWalls = walls.map((w, i) =>
            i === selectedIdx ? wallWithQuadCorners(w, newQuad) : w,
          );
          onWallsChange(newWalls);
          setPlacingCornerIdx(null);
          setPartialCorners([]);
          setShowGrid(true);
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

      // Check for edge hit (drag entire side)
      const edgeIdx = findHitEdge(pos);
      if (edgeIdx !== null) {
        setDraggingEdge(edgeIdx);
        const imgPos = screenToImage(pos.x, pos.y);
        edgeDragStartRef.current = { quad: [...quad!] as [Corner, Corner, Corner, Corner], mouseImg: imgPos! };
        return;
      }

      // Otherwise start panning
      setIsPanning(true);
      panStartRef.current = { ...pan };
      mouseStartRef.current = { x: e.clientX, y: e.clientY };
    },
    [getCanvasCoords, findHitCorner, findHitEdge, pan, placingCornerIdx, partialCorners, bitmap, screenToImage, walls, selectedIdx, onWallsChange, quad],
  );

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent) => {
      if (draggingCorner !== null && quad && wall) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          const pos = getCanvasCoords(e);
          const imgPos = screenToImage(pos.x, pos.y);
          if (!imgPos) return;
          const newQuad = [...quad] as [Corner, Corner, Corner, Corner];
          newQuad[draggingCorner] = { x: imgPos.x, y: imgPos.y };
          const newWalls = walls.map((w, i) =>
            i === selectedIdx ? wallWithQuadCorners(w, newQuad) : w,
          );
          onWallsChange(newWalls);
        });
        return;
      }

      // Edge dragging
      if (draggingEdge !== null && quad && wall && edgeDragStartRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          const pos = getCanvasCoords(e);
          const imgPos = screenToImage(pos.x, pos.y);
          if (!imgPos) return;
          const start = edgeDragStartRef.current!;
          const deltaX = imgPos.x - start.mouseImg.x;
          const deltaY = imgPos.y - start.mouseImg.y;
          const edges = [[0, 1], [1, 2], [2, 3], [3, 0]];
          const [a, b] = edges[draggingEdge];
          const newQuad = [...start.quad] as [Corner, Corner, Corner, Corner];
          // Move both corners of the edge
          newQuad[a] = { x: start.quad[a].x + deltaX, y: start.quad[a].y + deltaY };
          newQuad[b] = { x: start.quad[b].x + deltaX, y: start.quad[b].y + deltaY };
          const newWalls = walls.map((w, i) =>
            i === selectedIdx ? wallWithQuadCorners(w, newQuad) : w,
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
        mousePosRef.current = pos;
        draw(); // redraw with loupe
        canvas.style.cursor = showLoupe ? 'none' : 'crosshair';
        return;
      }
      const hitIdx = findHitCorner(pos);
      if (hitIdx !== null) {
        canvas.style.cursor = 'crosshair';
        return;
      }
      const edgeHit = findHitEdge(pos);
      canvas.style.cursor = edgeHit !== null ? 'grab' : 'default';
    },
    [
      draggingCorner,
      draggingEdge,
      isPanning,
      quad,
      wall,
      walls,
      selectedIdx,
      onWallsChange,
      getCanvasCoords,
      screenToImage,
      findHitCorner,
      findHitEdge,
      placingCornerIdx,
      showLoupe,
    ],
  );

  const handleMouseUp = useCallback(() => {
    setDraggingCorner(null);
    setDraggingEdge(null);
    edgeDragStartRef.current = null;
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

      let factor: number;
      if (e.ctrlKey) {
        // Pinch gesture — deltaY is typically small (-2 to 2)
        factor = Math.pow(1.01, -e.deltaY);
      } else {
        // Regular scroll wheel or two-finger scroll
        factor = Math.pow(ZOOM_FACTOR, -e.deltaY);
      }

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
  /*  Actions                                                          */
  /* ---------------------------------------------------------------- */

  const PRESET_QUADS: { label: string; quad: [Corner, Corner, Corner, Corner] }[] = useMemo(() => [
    { label: 'Full', quad: [{ x: 0.05, y: 0.05 }, { x: 0.95, y: 0.05 }, { x: 0.95, y: 0.95 }, { x: 0.05, y: 0.95 }] },
    { label: 'Center', quad: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }] },
    { label: 'Left', quad: [{ x: 0.08, y: 0.1 }, { x: 0.75, y: 0.05 }, { x: 0.75, y: 0.95 }, { x: 0.08, y: 0.9 }] },
    { label: 'Right', quad: [{ x: 0.25, y: 0.05 }, { x: 0.92, y: 0.1 }, { x: 0.92, y: 0.9 }, { x: 0.25, y: 0.95 }] },
  ], []);

  const handlePresetQuad = useCallback((preset: [Corner, Corner, Corner, Corner]) => {
    const newWalls = walls.map((w, i) =>
      i === selectedIdx ? wallWithQuadCorners(w, preset) : w,
    );
    onWallsChange(newWalls);
    setShowGrid(true);
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
      i === selectedIdx ? wallWithQuadCorners(w, newQuad) : w,
    );
    onWallsChange(newWalls);
  }, [quad, walls, selectedIdx, onWallsChange]);

  // Rotate quad orientation: cycles corner order [TL,TR,BR,BL] → [BL,TL,TR,BR]
  // This changes which corner is "top-left" for mural mapping without moving the corners
  const handleRotateOrientation = useCallback(() => {
    if (!quad) return;
    const rotated: [Corner, Corner, Corner, Corner] = [quad[3], quad[0], quad[1], quad[2]];
    const newWalls = walls.map((w, i) =>
      i === selectedIdx ? wallWithQuadCorners(w, rotated) : w,
    );
    onWallsChange(newWalls);
  }, [quad, walls, selectedIdx, onWallsChange]);

  const handleReset = useCallback(() => {
    const newWalls = walls.map((w, i) =>
      i === selectedIdx ? wallWithQuadCorners(w, undefined) : w,
    );
    onWallsChange(newWalls);
    // If we deleted the last quad, reset activeQuadIdx
    const remainingQuads = (wall?.quads.length ?? 1) - 1;
    if (activeQuadIdx >= remainingQuads) {
      setActiveQuadIdx(Math.max(0, remainingQuads - 1));
    }
  }, [walls, selectedIdx, onWallsChange, wall, activeQuadIdx]);

  const handleDeleteQuad = useCallback(() => {
    if (!wall || wall.quads.length <= 1) return;
    const newWalls = walls.map((w, i) =>
      i === selectedIdx ? wallWithQuadCorners(w, undefined) : w,
    );
    onWallsChange(newWalls);
    setActiveQuadIdx(Math.max(0, activeQuadIdx - 1));
  }, [walls, selectedIdx, onWallsChange, wall, activeQuadIdx]);

  const handleAddQuad = useCallback(() => {
    setPlacingCornerIdx(0);
    setPartialCorners([]);
    setActiveQuadIdx(wall?.quads.length ?? 0); // will be the new quad's index
  }, [wall]);

  const handleCopyQuad = useCallback(() => {
    if (quad) setCopiedQuad([...quad] as [Corner, Corner, Corner, Corner]);
  }, [quad]);

  const handlePasteQuad = useCallback(() => {
    if (!copiedQuad) return;
    const newWalls = walls.map((w, i) =>
      i === selectedIdx ? wallWithQuadCorners(w, [...copiedQuad] as [Corner, Corner, Corner, Corner]) : w,
    );
    onWallsChange(newWalls);
  }, [copiedQuad, walls, selectedIdx, onWallsChange]);

  /* ---------------------------------------------------------------- */
  /*  Keyboard nav                                                     */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (walls.length === 0) return;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        onSelectIdx(Math.max(0, selectedIdx - 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        onSelectIdx(Math.min(walls.length - 1, selectedIdx + 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (wall && wall.quads.length > 1) {
          setActiveQuadIdx(prev => Math.max(0, prev - 1));
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (wall && wall.quads.length > 1) {
          setActiveQuadIdx(prev => Math.min(wall.quads.length - 1, prev + 1));
        }
      } else if (e.key === 'g' || e.key === 'G') {
        if (quad) setShowGrid(v => !v);
      } else if (e.key === 'h' || e.key === 'H') {
        if (quad) setShowGuides(v => !v);
      } else if (e.key === 'm' || e.key === 'M') {
        setShowLoupe(v => !v);
      } else if (e.key === 'q' || e.key === 'Q') {
        if (quad) handleRotateOrientation();
      } else if (e.key === 's' || e.key === 'S') {
        if (quad) handleStraighten();
      } else if (e.key === 'r' || e.key === 'R') {
        if (quad) handleReset();
      } else if (e.key === 'n' || e.key === 'N') {
        handleAddQuad();
      } else if (e.key === 'c' || e.key === 'C') {
        if (quad) handleCopyQuad();
      } else if (e.key === 'v' || e.key === 'V') {
        if (copiedQuad) handlePasteQuad();
      } else if (e.key === 'Delete') {
        if (wall && wall.quads.length > 1) handleDeleteQuad();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [walls.length, selectedIdx, onSelectIdx, quad, copiedQuad, wall, handleStraighten, handleReset, handleAddQuad, handleCopyQuad, handlePasteQuad, handleDeleteQuad, handleRotateOrientation]);

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
    <div className="flex h-full">
      {/* Left sidebar: wall thumbnails */}
      <div
        ref={sidebarRef}
        className="w-[100px] shrink-0 border-r border-slate-200 bg-slate-50 overflow-y-auto hide-scrollbar p-1.5 space-y-1.5"
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

          {/* Placing corners indicator with preset shortcuts */}
          {placingCornerIdx !== null && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none">
              <div className="pointer-events-auto bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg flex items-center gap-3">
                <span>Click to place corner {Math.min(partialCorners.length + 1, 4)} of 4</span>
                <span className="text-white/50">|</span>
                <span className="text-xs text-white/70">Presets:</span>
                {PRESET_QUADS.map(p => (
                  <button
                    key={p.label}
                    onClick={() => { handlePresetQuad(p.quad); setPlacingCornerIdx(null); setPartialCorners([]); }}
                    className="px-2 py-0.5 rounded bg-white/20 text-xs hover:bg-white/30 transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
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

          {/* Center: quad selector */}
          {wall && wall.quads.length > 0 && (
            <div className="flex items-center gap-1 mx-3 px-3 border-x border-slate-200">
              {wall.quads.map((_q, qi) => (
                <button
                  key={_q.id}
                  onClick={() => setActiveQuadIdx(qi)}
                  className={cn(
                    'w-6 h-6 rounded-full text-[10px] font-bold transition-all',
                    qi === activeQuadIdx
                      ? 'bg-indigo-500 text-white shadow-sm'
                      : 'bg-slate-200 text-slate-500 hover:bg-slate-300'
                  )}
                  title={`Quad ${qi + 1}${_q.label ? ` - ${_q.label}` : ''}`}
                >
                  {qi + 1}
                </button>
              ))}
              <button
                onClick={handleAddQuad}
                className="w-6 h-6 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 text-sm font-bold transition-all"
                title="Add new quad (N)"
              >
                +
              </button>
            </div>
          )}

          {/* Link button */}
          {activeQuad && (
            <div className="relative">
              {activeQuad.linkId ? (
                <button
                  onClick={() => {
                    // Unlink this quad
                    const cur = [...walls];
                    const w = { ...cur[selectedIdx] };
                    const quads = [...w.quads];
                    quads[activeQuadIdx] = { ...quads[activeQuadIdx], linkId: undefined };
                    w.quads = quads;
                    cur[selectedIdx] = w;
                    // If only one quad remains with this linkId, unlink it too
                    const linkId = activeQuad.linkId;
                    let count = 0;
                    let lastWi = -1, lastQi = -1;
                    for (let wi = 0; wi < cur.length; wi++) {
                      for (let qi = 0; qi < cur[wi].quads.length; qi++) {
                        if (cur[wi].quads[qi].linkId === linkId) { count++; lastWi = wi; lastQi = qi; }
                      }
                    }
                    if (count === 1 && lastWi >= 0) {
                      const lw = { ...cur[lastWi] };
                      const lq = [...lw.quads];
                      lq[lastQi] = { ...lq[lastQi], linkId: undefined };
                      lw.quads = lq;
                      cur[lastWi] = lw;
                    }
                    onWallsChange(cur);
                  }}
                  className="p-2 rounded-md text-amber-500 hover:bg-amber-50 transition-colors"
                  title="Unlink this quad"
                >
                  <Unlink className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={() => setShowLinkPopover(v => !v)}
                  className={cn(
                    'p-2 rounded-md transition-colors',
                    showLinkPopover ? 'bg-blue-100 text-blue-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100',
                  )}
                  title="Link this quad to another"
                >
                  <Link className="w-4 h-4" />
                </button>
              )}

              {/* Link popover */}
              {showLinkPopover && (
                <div className="absolute bottom-full mb-2 right-0 bg-white rounded-lg shadow-xl border border-slate-200 p-3 min-w-[240px] z-50">
                  <p className="text-xs font-semibold text-slate-500 mb-2">Link to quad on another wall:</p>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {walls.map((w, wi) => {
                      if (wi === selectedIdx && w.quads.length <= 1) return null;
                      return w.quads.map((q, qi) => {
                        if (wi === selectedIdx && qi === activeQuadIdx) return null;
                        const isAlreadyLinked = q.linkId !== undefined && q.linkId === activeQuad?.linkId;
                        return (
                          <button
                            key={`${w.id}-${q.id}`}
                            onClick={() => {
                              const cur = [...walls];
                              const newLinkId = activeQuad?.linkId ?? q.linkId ?? crypto.randomUUID().slice(0, 8);
                              // Set linkId on source quad
                              const srcW = { ...cur[selectedIdx] };
                              const srcQuads = [...srcW.quads];
                              srcQuads[activeQuadIdx] = { ...srcQuads[activeQuadIdx], linkId: newLinkId };
                              srcW.quads = srcQuads;
                              cur[selectedIdx] = srcW;
                              // Set linkId on target quad
                              const tgtW = { ...cur[wi] };
                              const tgtQuads = [...tgtW.quads];
                              tgtQuads[qi] = { ...tgtQuads[qi], linkId: newLinkId };
                              tgtW.quads = tgtQuads;
                              cur[wi] = tgtW;
                              onWallsChange(cur);
                              setShowLinkPopover(false);
                            }}
                            className={cn(
                              'w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors',
                              isAlreadyLinked ? 'bg-blue-50 text-blue-600' : 'hover:bg-slate-100 text-slate-700',
                            )}
                          >
                            <img src={w.thumbUrl} className="w-8 h-6 rounded object-cover" alt="" />
                            <span>Wall {wi + 1} — Quad {qi + 1}{q.label ? ` (${q.label})` : ''}</span>
                            {isAlreadyLinked && <span className="ml-auto text-blue-400">linked</span>}
                          </button>
                        );
                      });
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

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
              title="Toggle grid (G)"
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
              title="Toggle vanishing guides (H)"
            >
              <Crosshair className="w-4 h-4" />
            </button>

            <button
              onClick={() => setShowLoupe((v) => !v)}
              className={cn(
                'p-2 rounded-md transition-colors',
                showLoupe
                  ? 'bg-indigo-100 text-indigo-600'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100',
              )}
              title="Toggle magnification loupe (M)"
            >
              <Crosshair className="w-4 h-4" />
            </button>

            <button
              onClick={handleCopyQuad}
              disabled={!quad}
              className={cn(
                'p-2 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors',
                !quad && 'opacity-40 cursor-not-allowed',
              )}
              title="Copy quad (C)"
            >
              <ClipboardCopy className="w-4 h-4" />
            </button>

            <button
              onClick={handlePasteQuad}
              disabled={!copiedQuad}
              className={cn(
                'p-2 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors',
                !copiedQuad && 'opacity-40 cursor-not-allowed',
              )}
              title="Paste quad (V)"
            >
              <ClipboardPaste className="w-4 h-4" />
            </button>

            <button
              onClick={handleStraighten}
              disabled={!quad}
              className={cn(
                'p-2 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors',
                !quad && 'opacity-40 cursor-not-allowed',
              )}
              title="Straighten to rectangle (S)"
            >
              <RectangleHorizontal className="w-4 h-4" />
            </button>

            <button
              onClick={handleRotateOrientation}
              disabled={!quad}
              className={cn(
                'p-2 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors',
                !quad && 'opacity-40 cursor-not-allowed',
              )}
              title="Rotate quad orientation (Q)"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            <button
              onClick={handleReset}
              disabled={!quad}
              className={cn(
                'p-2 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors',
                !quad && 'opacity-40 cursor-not-allowed',
              )}
              title="Reset quad (R)"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {wall && wall.quads.length > 1 && (
              <button
                onClick={handleDeleteQuad}
                className="p-2 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                title="Delete this quad (Del)"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
