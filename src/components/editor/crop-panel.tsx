

import { useState, useRef, useEffect, useCallback } from 'react';
import { RotateCw } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import type { WallTransform } from '@/lib/types';

interface CropPanelProps {
  imageUrl: string;
  transform: WallTransform;
  onTransformChange: (transform: WallTransform) => void;
  onDone: () => void;
}

export function CropPanel({ imageUrl, transform, onTransformChange, onDone }: CropPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const dragStartRef = useRef<{ mx: number; my: number; t: WallTransform } | null>(null);
  const [local, setLocal] = useState(transform);

  // Load image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imgRef.current = img; setLoaded(true); };
    img.src = imageUrl;
  }, [imageUrl]);

  const getDisplaySize = useCallback(() => {
    const container = containerRef.current;
    if (!container || !imgRef.current) return { dw: 0, dh: 0, ox: 0, oy: 0, scale: 1 };
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const iw = imgRef.current.naturalWidth;
    const ih = imgRef.current.naturalHeight;
    const scale = Math.min(cw / iw, ch / ih, 1);
    const dw = iw * scale;
    const dh = ih * scale;
    return { dw, dh, ox: (cw - dw) / 2, oy: (ch - dh) / 2, scale };
  }, []);

  // Draw canvas
  useEffect(() => {
    if (!loaded) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !imgRef.current) return;

    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    const ctx = canvas.getContext('2d')!;
    const { dw, dh, ox, oy } = getDisplaySize();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Full image dimmed
    ctx.save();
    ctx.translate(ox + dw / 2, oy + dh / 2);
    ctx.rotate((local.rotation * Math.PI) / 180);
    ctx.drawImage(imgRef.current, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Bright crop area
    const cx = ox + local.cropX * dw;
    const cy = oy + local.cropY * dh;
    const cw2 = local.cropW * dw;
    const ch2 = local.cropH * dh;

    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, cw2, ch2);
    ctx.clip();
    ctx.translate(ox + dw / 2, oy + dh / 2);
    ctx.rotate((local.rotation * Math.PI) / 180);
    ctx.drawImage(imgRef.current, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();

    // Crop border
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx, cy, cw2, ch2);

    // Rule of thirds
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + (cw2 * i) / 3, cy);
      ctx.lineTo(cx + (cw2 * i) / 3, cy + ch2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy + (ch2 * i) / 3);
      ctx.lineTo(cx + cw2, cy + (ch2 * i) / 3);
      ctx.stroke();
    }

    // Corner handles
    const hs = 8;
    ctx.fillStyle = '#fff';
    for (const [hx, hy] of [[cx, cy], [cx + cw2, cy], [cx, cy + ch2], [cx + cw2, cy + ch2]]) {
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
    }
  }, [loaded, local, getDisplaySize]);

  // Hit test
  const getHitTarget = useCallback(
    (mx: number, my: number): string | null => {
      const { dw, dh, ox, oy } = getDisplaySize();
      const cx = ox + local.cropX * dw;
      const cy = oy + local.cropY * dh;
      const cw2 = local.cropW * dw;
      const ch2 = local.cropH * dh;
      const hs = 12;

      if (Math.abs(mx - cx) < hs && Math.abs(my - cy) < hs) return 'tl';
      if (Math.abs(mx - (cx + cw2)) < hs && Math.abs(my - cy) < hs) return 'tr';
      if (Math.abs(mx - cx) < hs && Math.abs(my - (cy + ch2)) < hs) return 'bl';
      if (Math.abs(mx - (cx + cw2)) < hs && Math.abs(my - (cy + ch2)) < hs) return 'br';
      if (mx >= cx && mx <= cx + cw2 && my >= cy && my <= cy + ch2) return 'move';
      return null;
    },
    [getDisplaySize, local],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const target = getHitTarget(mx, my);
      if (target) {
        setDragging(target);
        dragStartRef.current = { mx, my, t: { ...local } };
      }
    },
    [getHitTarget, local],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging || !dragStartRef.current) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { dw, dh } = getDisplaySize();
      if (dw === 0 || dh === 0) return;
      const dx = (mx - dragStartRef.current.mx) / dw;
      const dy = (my - dragStartRef.current.my) / dh;
      const t = dragStartRef.current.t;
      const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

      const next = { ...local };
      if (dragging === 'move') {
        next.cropX = clamp(t.cropX + dx, 0, 1 - t.cropW);
        next.cropY = clamp(t.cropY + dy, 0, 1 - t.cropH);
      } else if (dragging === 'tl') {
        const nx = clamp(t.cropX + dx, 0, t.cropX + t.cropW - 0.05);
        const ny = clamp(t.cropY + dy, 0, t.cropY + t.cropH - 0.05);
        next.cropW = t.cropW + (t.cropX - nx);
        next.cropH = t.cropH + (t.cropY - ny);
        next.cropX = nx;
        next.cropY = ny;
      } else if (dragging === 'tr') {
        next.cropW = clamp(t.cropW + dx, 0.05, 1 - t.cropX);
        const ny = clamp(t.cropY + dy, 0, t.cropY + t.cropH - 0.05);
        next.cropH = t.cropH + (t.cropY - ny);
        next.cropY = ny;
      } else if (dragging === 'bl') {
        const nx = clamp(t.cropX + dx, 0, t.cropX + t.cropW - 0.05);
        next.cropW = t.cropW + (t.cropX - nx);
        next.cropX = nx;
        next.cropH = clamp(t.cropH + dy, 0.05, 1 - t.cropY);
      } else if (dragging === 'br') {
        next.cropW = clamp(t.cropW + dx, 0.05, 1 - t.cropX);
        next.cropH = clamp(t.cropH + dy, 0.05, 1 - t.cropY);
      }
      setLocal(next);
    },
    [dragging, getDisplaySize, local],
  );

  const handleMouseUp = useCallback(() => {
    if (dragging) {
      setDragging(null);
      onTransformChange(local);
    }
  }, [dragging, local, onTransformChange]);

  const handleRotate = (angle: number) => {
    const next = { ...local, rotation: angle };
    setLocal(next);
    onTransformChange(next);
  };

  const handleSnap = (deg: number) => {
    const next = { ...local, rotation: deg };
    setLocal(next);
    onTransformChange(next);
  };

  const handleReset = () => {
    const reset: WallTransform = { cropX: 0, cropY: 0, cropW: 1, cropH: 1, rotation: 0 };
    setLocal(reset);
    onTransformChange(reset);
  };

  return (
    <div className="flex flex-col h-full bg-[var(--editor-surface)]">
      {/* Canvas area */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden bg-[#0a0a14]">
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ cursor: dragging ? 'grabbing' : 'crosshair' }}
        />
      </div>

      {/* Control bar */}
      <div className="flex items-center gap-4 px-5 shrink-0 h-14 bg-[#0f0f1a] border-t border-white/[0.07]">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <RotateCw className="w-3.5 h-3.5 text-white/35 shrink-0" />
          <span className="text-xs font-mono tabular-nums w-10 text-white/55">
            {Math.round(local.rotation)}&deg;
          </span>
          <div className="flex-1 min-w-0 max-w-[140px]">
            <Slider
              value={local.rotation}
              onValueChange={handleRotate}
              min={-180}
              max={180}
              variant="dark"
              aria-label="Rotation"
            />
          </div>

          {/* Snap buttons */}
          <div className="flex items-center gap-1 shrink-0">
            {[0, 90, 180, -90].map((deg) => {
              const isActive = local.rotation === deg;
              return (
                <button
                  key={deg}
                  onClick={() => handleSnap(deg)}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-xs font-medium border transition-all',
                    isActive
                      ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                      : 'bg-white/[0.06] text-white/45 border-white/[0.08] hover:bg-white/10 hover:text-white',
                  )}
                >
                  {deg}&deg;
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleReset}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.06] text-white/50 border border-white/[0.08] hover:bg-white/10 hover:text-white transition-all"
          >
            Reset
          </button>
          <button
            onClick={onDone}
            className="px-5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white shadow-[0_0_14px_rgba(79,70,229,0.45)] hover:bg-indigo-700 transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
