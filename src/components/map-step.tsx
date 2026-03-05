

import { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowRight, ArrowLeft, Wand2, RotateCcw, Loader2, X, Grid3X3, Maximize, RectangleHorizontal, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface Corner { x: number; y: number } // normalized 0-1

interface MapStepProps {
  wallImage: HTMLImageElement;
  artImage: HTMLImageElement;
  initialCorners?: [Corner, Corner, Corner, Corner];
  onComplete: (corners: [Corner, Corner, Corner, Corner]) => void;
  onBack: () => void;
}

type DetectStage = 'loading-opencv' | 'preprocessing' | 'detecting-edges' | 'finding-walls' | 'done';

interface WallCandidate {
  corners: [Corner, Corner, Corner, Corner];
  area: number;
}

const HANDLE_RADIUS = 8;
const HANDLE_HIT_RADIUS = 20;
const MAX_DETECT_DIM = 600;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 8;

const STAGE_LABELS: Record<DetectStage, string> = {
  'loading-opencv': 'Loading vision engine...',
  'preprocessing': 'Preparing image...',
  'detecting-edges': 'Detecting edges...',
  'finding-walls': 'Finding wall surfaces...',
  'done': 'Complete',
};

function defaultCorners(): [Corner, Corner, Corner, Corner] {
  return [
    { x: 0.25, y: 0.2 },
    { x: 0.75, y: 0.2 },
    { x: 0.75, y: 0.8 },
    { x: 0.25, y: 0.8 },
  ];
}

export function MapStep({ wallImage, artImage, initialCorners, onComplete, onBack }: MapStepProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [corners, setCorners] = useState<[Corner, Corner, Corner, Corner]>(initialCorners ?? defaultCorners);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });
  const [imgOffset, setImgOffset] = useState({ x: 0, y: 0, w: 0, h: 0 });

  // Zoom & pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ sx: 0, sy: 0, px: 0, py: 0 });

  // Perspective tools
  const [showGrid, setShowGrid] = useState(false);
  const [showGuides, setShowGuides] = useState(false);

  // Detection state
  const [detectStage, setDetectStage] = useState<DetectStage | null>(null);
  const [wallCandidates, setWallCandidates] = useState<WallCandidate[] | null>(null);
  const [selectedWallIdx, setSelectedWallIdx] = useState<number | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const detecting = detectStage !== null && detectStage !== 'done';

  // World-to-screen and screen-to-world transforms
  const toScreen = useCallback((wx: number, wy: number) => ({
    x: wx * zoom + pan.x,
    y: wy * zoom + pan.y,
  }), [zoom, pan]);

  const toWorld = useCallback((sx: number, sy: number) => ({
    x: (sx - pan.x) / zoom,
    y: (sy - pan.y) / zoom,
  }), [zoom, pan]);

  // Normalized corner → world coords
  const normToWorld = useCallback((c: Corner) => ({
    x: imgOffset.x + c.x * imgOffset.w,
    y: imgOffset.y + c.y * imgOffset.h,
  }), [imgOffset]);

  // World coords → normalized corner
  const worldToNorm = useCallback((wx: number, wy: number): Corner => ({
    x: Math.max(0, Math.min(1, (wx - imgOffset.x) / imgOffset.w)),
    y: Math.max(0, Math.min(1, (wy - imgOffset.y) / imgOffset.h)),
  }), [imgOffset]);

  // Compute base image bounds (letterboxed in canvas at zoom=1)
  const computeImageBounds = useCallback((cw: number, ch: number) => {
    const iw = wallImage.naturalWidth;
    const ih = wallImage.naturalHeight;
    const scale = Math.min(cw / iw, ch / ih);
    const w = iw * scale;
    const h = ih * scale;
    const x = (cw - w) / 2;
    const y = (ch - h) / 2;
    return { x, y, w, h };
  }, [wallImage]);

  // Resize canvas to fill container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const cw = Math.round(width);
      const ch = Math.round(height);
      setCanvasSize({ w: cw, h: ch });
      setImgOffset(computeImageBounds(cw, ch));
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [computeImageBounds]);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => { workerRef.current?.terminate(); };
  }, []);

  // Wheel handler for zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
      // Keep point under cursor fixed
      const newPanX = mx - (mx - pan.x) * (newZoom / zoom);
      const newPanY = my - (my - pan.y) * (newZoom / zoom);
      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoom, pan]);

  // Draw warped art preview (in world coords, inside ctx transform)
  const drawWarpedArt = useCallback((ctx: CanvasRenderingContext2D) => {
    const pts = corners.map(normToWorld);
    const aw = artImage.naturalWidth;
    const ah = artImage.naturalHeight;

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = aw;
    srcCanvas.height = ah;
    const sctx = srcCanvas.getContext('2d')!;
    sctx.drawImage(artImage, 0, 0);

    const SUBS = 10;
    const stepX = aw / SUBS;
    const stepY = ah / SUBS;

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const quadInterp = (u: number, v: number) => ({
      x: lerp(lerp(pts[0].x, pts[1].x, u), lerp(pts[3].x, pts[2].x, u), v),
      y: lerp(lerp(pts[0].y, pts[1].y, u), lerp(pts[3].y, pts[2].y, u), v),
    });

    ctx.save();
    ctx.globalAlpha = 0.85;
    for (let gy = 0; gy < SUBS; gy++) {
      for (let gx = 0; gx < SUBS; gx++) {
        const u0 = gx / SUBS, u1 = (gx + 1) / SUBS;
        const v0 = gy / SUBS, v1 = (gy + 1) / SUBS;
        const d00 = quadInterp(u0, v0);
        const d10 = quadInterp(u1, v0);
        const d11 = quadInterp(u1, v1);
        const d01 = quadInterp(u0, v1);
        const sx0 = gx * stepX, sy0 = gy * stepY;
        const sx1 = (gx + 1) * stepX, sy1 = (gy + 1) * stepY;
        drawTriangle(ctx, srcCanvas, sx0, sy0, sx1, sy0, sx1, sy1, d00.x, d00.y, d10.x, d10.y, d11.x, d11.y);
        drawTriangle(ctx, srcCanvas, sx0, sy0, sx1, sy1, sx0, sy1, d00.x, d00.y, d11.x, d11.y, d01.x, d01.y);
      }
    }
    ctx.restore();
  }, [corners, normToWorld, artImage]);

  // Draw perspective grid inside the quad (world coords)
  const drawGrid = useCallback((ctx: CanvasRenderingContext2D) => {
    const pts = corners.map(normToWorld);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const quadInterp = (u: number, v: number) => ({
      x: lerp(lerp(pts[0].x, pts[1].x, u), lerp(pts[3].x, pts[2].x, u), v),
      y: lerp(lerp(pts[0].y, pts[1].y, u), lerp(pts[3].y, pts[2].y, u), v),
    });

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 200, 50, 0.4)';
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([4 / zoom, 4 / zoom]);

    const DIVS = 6;
    // Vertical lines
    for (let i = 1; i < DIVS; i++) {
      const u = i / DIVS;
      ctx.beginPath();
      const top = quadInterp(u, 0);
      const bot = quadInterp(u, 1);
      ctx.moveTo(top.x, top.y);
      for (let j = 1; j <= 20; j++) {
        const p = quadInterp(u, j / 20);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    // Horizontal lines
    for (let i = 1; i < DIVS; i++) {
      const v = i / DIVS;
      ctx.beginPath();
      const left = quadInterp(0, v);
      ctx.moveTo(left.x, left.y);
      for (let j = 1; j <= 20; j++) {
        const p = quadInterp(j / 20, v);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }, [corners, normToWorld, zoom]);

  // Draw vanishing point guide lines (world coords)
  const drawGuides = useCallback((ctx: CanvasRenderingContext2D) => {
    const pts = corners.map(normToWorld);
    ctx.save();
    ctx.strokeStyle = 'rgba(50, 200, 255, 0.35)';
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([6 / zoom, 4 / zoom]);

    // Extend each edge of the quad far beyond the canvas
    const EXT = 5000;
    const edges: [number, number][] = [[0, 1], [2, 3], [0, 3], [1, 2]]; // top, bottom, left, right
    for (const [a, b] of edges) {
      const dx = pts[b].x - pts[a].x;
      const dy = pts[b].y - pts[a].y;
      ctx.beginPath();
      ctx.moveTo(pts[a].x - dx * EXT, pts[a].y - dy * EXT);
      ctx.lineTo(pts[b].x + dx * EXT, pts[b].y + dy * EXT);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }, [corners, normToWorld, zoom]);

  // Render the canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const { w, h } = canvasSize;
    canvas.width = w;
    canvas.height = h;

    // Clear
    ctx.fillStyle = '#0f0f1a';
    ctx.fillRect(0, 0, w, h);

    // Apply view transform
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw wall image
    ctx.drawImage(wallImage, imgOffset.x, imgOffset.y, imgOffset.w, imgOffset.h);

    // Draw candidate outlines when picking
    if (wallCandidates && selectedWallIdx === null) {
      wallCandidates.forEach((candidate, idx) => {
        const pts = candidate.corners.map(normToWorld);
        ctx.strokeStyle = `hsla(${(idx * 60 + 240) % 360}, 80%, 65%, 0.8)`;
        ctx.lineWidth = 3 / zoom;
        ctx.setLineDash([]);
        ctx.beginPath();
        pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = `hsla(${(idx * 60 + 240) % 360}, 70%, 60%, 0.12)`;
        ctx.fill();

        const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
        const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
        ctx.fillStyle = `hsla(${(idx * 60 + 240) % 360}, 80%, 65%, 1)`;
        ctx.font = `bold ${20 / zoom}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${idx + 1}`, cx, cy);
      });
    } else {
      // Draw warped art preview
      drawWarpedArt(ctx);

      // Draw guide lines (behind the quad outline)
      if (showGuides) drawGuides(ctx);

      // Draw quad outline
      const pts = corners.map(normToWorld);
      ctx.strokeStyle = 'rgba(79, 70, 229, 0.8)';
      ctx.lineWidth = 2 / zoom;
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.beginPath();
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw perspective grid
      if (showGrid) drawGrid(ctx);
    }

    ctx.restore();
    // END view transform — everything below is in screen coords

    // Draw corner handles at constant screen size (outside transform)
    if (!(wallCandidates && selectedWallIdx === null)) {
      const labels = ['TL', 'TR', 'BR', 'BL'];
      corners.forEach((c, i) => {
        const wp = normToWorld(c);
        const sp = toScreen(wp.x, wp.y);

        // Outer ring
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, HANDLE_RADIUS + 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fill();

        // Inner circle
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = i === draggingIdx ? '#4f46e5' : '#6366f1';
        ctx.fill();

        // Crosshair lines inside the handle
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sp.x - 4, sp.y);
        ctx.lineTo(sp.x + 4, sp.y);
        ctx.moveTo(sp.x, sp.y - 4);
        ctx.lineTo(sp.x, sp.y + 4);
        ctx.stroke();

        // Label
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(labels[i], sp.x, sp.y - HANDLE_RADIUS - 6);
      });
    }
  }, [canvasSize, corners, imgOffset, wallImage, zoom, pan, toScreen, normToWorld, drawWarpedArt, drawGrid, drawGuides, showGrid, showGuides, draggingIdx, wallCandidates, selectedWallIdx]);

  // Mouse helpers
  const getMousePos = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const pos = getMousePos(e);

    // Wall candidate picking
    if (wallCandidates && selectedWallIdx === null) {
      const wp = toWorld(pos.x, pos.y);
      const norm = worldToNorm(wp.x, wp.y);
      for (let i = 0; i < wallCandidates.length; i++) {
        if (pointInQuad(norm, wallCandidates[i].corners)) {
          setCorners(wallCandidates[i].corners);
          setSelectedWallIdx(i);
          setWallCandidates(null);
          return;
        }
      }
      return;
    }

    // Hit test handles (in screen space for constant-size detection)
    for (let i = 0; i < 4; i++) {
      const wp = normToWorld(corners[i]);
      const sp = toScreen(wp.x, wp.y);
      const dx = pos.x - sp.x;
      const dy = pos.y - sp.y;
      if (dx * dx + dy * dy < HANDLE_HIT_RADIUS * HANDLE_HIT_RADIUS) {
        setDraggingIdx(i);
        return;
      }
    }

    // If no handle hit, start panning
    setIsPanning(true);
    panStartRef.current = { sx: pos.x, sy: pos.y, px: pan.x, py: pan.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const pos = getMousePos(e);

    if (draggingIdx !== null) {
      // Convert screen pos to world, then to normalized
      const wp = toWorld(pos.x, pos.y);
      const norm = worldToNorm(wp.x, wp.y);
      setCorners((prev) => {
        const next = [...prev] as [Corner, Corner, Corner, Corner];
        next[draggingIdx] = norm;
        return next;
      });
      return;
    }

    if (isPanning) {
      const dx = pos.x - panStartRef.current.sx;
      const dy = pos.y - panStartRef.current.sy;
      setPan({ x: panStartRef.current.px + dx, y: panStartRef.current.py + dy });
    }
  };

  const handleMouseUp = () => {
    setDraggingIdx(null);
    setIsPanning(false);
  };

  // Fit to screen
  const handleFitView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Straighten: make quad a centered rectangle matching art aspect ratio
  const handleStraighten = () => {
    const artAspect = artImage.naturalWidth / artImage.naturalHeight;
    const maxW = 0.7;
    const maxH = 0.7;
    let w = maxW;
    let h = w / artAspect;
    if (h > maxH) { h = maxH; w = h * artAspect; }
    const cx = 0.5, cy = 0.5;
    setCorners([
      { x: cx - w / 2, y: cy - h / 2 },
      { x: cx + w / 2, y: cy - h / 2 },
      { x: cx + w / 2, y: cy + h / 2 },
      { x: cx - w / 2, y: cy + h / 2 },
    ]);
  };

  // Zoom buttons
  const zoomIn = () => {
    const newZoom = Math.min(MAX_ZOOM, zoom * 1.3);
    const cx = canvasSize.w / 2;
    const cy = canvasSize.h / 2;
    setPan({ x: cx - (cx - pan.x) * (newZoom / zoom), y: cy - (cy - pan.y) * (newZoom / zoom) });
    setZoom(newZoom);
  };
  const zoomOut = () => {
    const newZoom = Math.max(MIN_ZOOM, zoom / 1.3);
    const cx = canvasSize.w / 2;
    const cy = canvasSize.h / 2;
    setPan({ x: cx - (cx - pan.x) * (newZoom / zoom), y: cy - (cy - pan.y) * (newZoom / zoom) });
    setZoom(newZoom);
  };

  // Auto-detect wall — Web Worker
  const handleAutoDetect = () => {
    workerRef.current?.terminate();
    setDetectStage('loading-opencv');
    setWallCandidates(null);
    setSelectedWallIdx(null);

    const iw = wallImage.naturalWidth;
    const ih = wallImage.naturalHeight;
    const scale = Math.min(1, MAX_DETECT_DIM / Math.max(iw, ih));
    const sw = Math.round(iw * scale);
    const sh = Math.round(ih * scale);

    const tc = document.createElement('canvas');
    tc.width = sw;
    tc.height = sh;
    const tctx = tc.getContext('2d')!;
    tctx.drawImage(wallImage, 0, 0, sw, sh);
    const imageData = tctx.getImageData(0, 0, sw, sh);

    const worker = new Worker(new URL('../lib/cv/detect-worker.ts', import.meta.url));
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'stage') {
        setDetectStage(msg.stage);
      } else if (msg.type === 'result') {
        const candidates: WallCandidate[] = msg.candidates;
        setDetectStage('done');
        if (candidates.length === 0) {
          setTimeout(() => setDetectStage(null), 1500);
        } else if (candidates.length === 1) {
          setCorners(candidates[0].corners);
          setSelectedWallIdx(0);
          setTimeout(() => setDetectStage(null), 500);
        } else {
          setWallCandidates(candidates);
          setTimeout(() => setDetectStage(null), 500);
        }
        worker.terminate();
        workerRef.current = null;
      } else if (msg.type === 'error') {
        console.warn('Auto-detect failed:', msg.error);
        setDetectStage(null);
        worker.terminate();
        workerRef.current = null;
      }
    };

    worker.onerror = (err) => {
      console.warn('Worker error:', err);
      setDetectStage(null);
      worker.terminate();
      workerRef.current = null;
    };

    worker.postMessage({ imageData, width: sw, height: sh }, [imageData.data.buffer]);
  };

  const handleCancelDetect = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setDetectStage(null);
  };

  const handleDismissCandidates = () => {
    setWallCandidates(null);
    setSelectedWallIdx(null);
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0f0f1a] animate-fade-in" style={{ top: 54 }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 h-12 bg-[#161625] border-b border-white/5 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-white/40 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium text-white/80">Map artwork to wall</span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Perspective tools */}
          <button
            onClick={() => setShowGrid(v => !v)}
            title="Perspective grid"
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center transition-all',
              showGrid ? 'bg-amber-500/20 text-amber-400' : 'text-white/40 hover:text-white/70 hover:bg-white/5',
            )}
          >
            <Grid3X3 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowGuides(v => !v)}
            title="Vanishing point guides"
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center transition-all',
              showGuides ? 'bg-cyan-500/20 text-cyan-400' : 'text-white/40 hover:text-white/70 hover:bg-white/5',
            )}
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="2" y1="8" x2="14" y2="8" strokeDasharray="2 2" />
              <line x1="8" y1="2" x2="3" y2="14" strokeDasharray="2 2" />
              <line x1="8" y1="2" x2="13" y2="14" strokeDasharray="2 2" />
            </svg>
          </button>
          <button
            onClick={handleStraighten}
            title="Straighten (flat rectangle)"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/5 transition-all"
          >
            <RectangleHorizontal className="w-4 h-4" />
          </button>

          <div className="w-px h-5 bg-white/10 mx-1" />

          {/* Auto-detect */}
          {detecting ? (
            <Button variant="ghost" size="sm" icon={<X className="w-3.5 h-3.5" />}
              onClick={handleCancelDetect} className="text-red-400 hover:text-red-300 hover:bg-red-500/10">
              Cancel
            </Button>
          ) : (
            <Button variant="ghost" size="sm" icon={<Wand2 className="w-3.5 h-3.5" />}
              onClick={handleAutoDetect} className="text-white/60 hover:text-white hover:bg-white/10">
              Detect
            </Button>
          )}
          <Button variant="ghost" size="sm" icon={<RotateCcw className="w-3.5 h-3.5" />}
            onClick={() => { setCorners(defaultCorners()); handleDismissCandidates(); }}
            className="text-white/60 hover:text-white hover:bg-white/10">
            Reset
          </Button>
          <Button size="sm" icon={<ArrowRight className="w-3.5 h-3.5" />}
            onClick={() => onComplete(corners)}
            disabled={!!(wallCandidates && selectedWallIdx === null)}>
            Refine
          </Button>
        </div>
      </div>

      {/* Canvas area */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <canvas
          ref={canvasRef}
          className={cn(
            'absolute inset-0 w-full h-full',
            isPanning ? 'cursor-grabbing' :
            wallCandidates && selectedWallIdx === null ? 'cursor-pointer' :
            'cursor-crosshair',
          )}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />

        {/* Zoom controls — bottom right */}
        <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-[#1e1e30]/90 border border-white/10 rounded-xl px-1.5 py-1 shadow-lg">
          <button onClick={zoomOut} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-all">
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleFitView} className="px-2 h-7 rounded-lg text-[11px] font-medium text-white/60 hover:text-white hover:bg-white/10 transition-all tabular-nums min-w-[48px] text-center">
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={zoomIn} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-all">
            <Plus className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-4 bg-white/10 mx-0.5" />
          <button onClick={handleFitView} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-all" title="Fit to screen">
            <Maximize className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Detection progress overlay */}
        {detecting && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-[#1e1e30]/95 border border-white/10 rounded-2xl px-8 py-6 flex flex-col items-center gap-4 shadow-2xl pointer-events-auto">
              <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
              <div className="text-center">
                <p className="text-white/90 text-sm font-medium">
                  {detectStage ? STAGE_LABELS[detectStage] : ''}
                </p>
                <p className="text-white/40 text-xs mt-1">Press Cancel to stop</p>
              </div>
              <div className="flex gap-2">
                {(['loading-opencv', 'preprocessing', 'detecting-edges', 'finding-walls'] as DetectStage[]).map((stage, i) => {
                  const stages: DetectStage[] = ['loading-opencv', 'preprocessing', 'detecting-edges', 'finding-walls'];
                  const currentIdx = detectStage ? stages.indexOf(detectStage) : -1;
                  return (
                    <div key={stage} className={cn(
                      'w-2 h-2 rounded-full transition-all',
                      i < currentIdx ? 'bg-indigo-400' :
                      i === currentIdx ? 'bg-indigo-400 animate-pulse scale-125' :
                      'bg-white/20',
                    )} />
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Wall candidate picker banner */}
        {wallCandidates && selectedWallIdx === null && !detecting && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-[#1e1e30] border border-white/10 rounded-xl px-5 py-3 flex items-center gap-4 shadow-2xl">
            <span className="text-white/80 text-sm font-medium">
              {wallCandidates.length} walls found — click one to select
            </span>
            <button onClick={handleDismissCandidates} className="text-white/40 hover:text-white/80 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* No walls found */}
        {detectStage === 'done' && wallCandidates === null && selectedWallIdx === null && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-amber-500/20 border border-amber-500/30 rounded-xl px-5 py-3 text-amber-300 text-sm font-medium shadow-2xl">
            No walls detected — try adjusting manually
          </div>
        )}

        {/* Instructions overlay */}
        {!detecting && !(wallCandidates && selectedWallIdx === null) && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur text-white/70 text-xs px-4 py-2 rounded-full pointer-events-none">
            Drag corners to align — scroll to zoom — drag empty space to pan
          </div>
        )}
      </div>
    </div>
  );
}

// Check if point is inside a quad (ray casting)
function pointInQuad(p: Corner, quad: [Corner, Corner, Corner, Corner]): boolean {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const xi = quad[i].x, yi = quad[i].y;
    const xj = quad[j].x, yj = quad[j].y;
    if (((yi > p.y) !== (yj > p.y)) && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// Helper: draw textured triangle (affine warp)
function drawTriangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement | HTMLImageElement,
  s0x: number, s0y: number, s1x: number, s1y: number, s2x: number, s2y: number,
  d0x: number, d0y: number, d1x: number, d1y: number, d2x: number, d2y: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0x, d0y);
  ctx.lineTo(d1x, d1y);
  ctx.lineTo(d2x, d2y);
  ctx.closePath();
  ctx.clip();

  const denom = s0x * (s1y - s2y) + s1x * (s2y - s0y) + s2x * (s0y - s1y);
  if (Math.abs(denom) < 1e-10) { ctx.restore(); return; }

  const a = (d0x * (s1y - s2y) + d1x * (s2y - s0y) + d2x * (s0y - s1y)) / denom;
  const b = (d0x * (s2x - s1x) + d1x * (s0x - s2x) + d2x * (s1x - s0x)) / denom;
  const c = (d0x * (s1x * s2y - s2x * s1y) + d1x * (s2x * s0y - s0x * s2y) + d2x * (s0x * s1y - s1x * s0y)) / denom;
  const d = (d0y * (s1y - s2y) + d1y * (s2y - s0y) + d2y * (s0y - s1y)) / denom;
  const e = (d0y * (s2x - s1x) + d1y * (s0x - s2x) + d2y * (s1x - s0x)) / denom;
  const f = (d0y * (s1x * s2y - s2x * s1y) + d1y * (s2x * s0y - s0x * s2y) + d2y * (s0x * s1y - s1x * s0y)) / denom;

  ctx.setTransform(a, d, b, e, c, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}
