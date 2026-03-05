

import { useEffect, useRef, useState, useCallback } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CropDialogProps {
  imageSrc: string;
  onCrop: (blob: Blob) => void;
  onCancel: () => void;
}

interface Rect { x: number; y: number; w: number; h: number } // normalized 0-1

type DragHandle = 'tl' | 'tr' | 'bl' | 'br' | 't' | 'r' | 'b' | 'l' | 'move' | null;

const HANDLE_SIZE = 10;

export function CropDialog({ imageSrc, onCrop, onCancel }: CropDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Rect>({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
  const [dragHandle, setDragHandle] = useState<DragHandle>(null);
  const dragStartRef = useRef({ mx: 0, my: 0, crop: { x: 0, y: 0, w: 0, h: 0 } });
  const [imgBounds, setImgBounds] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const [loaded, setLoaded] = useState(false);

  // Load image
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setLoaded(true);
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // Compute image display bounds (letterboxed in canvas)
  const computeBounds = useCallback(() => {
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img) return { x: 0, y: 0, w: 1, h: 1 };
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight) * 0.9;
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  }, []);

  // Draw
  useEffect(() => {
    if (!loaded) return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const img = imgRef.current;
    if (!canvas || !container || !img) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d')!;

    const bounds = computeBounds();
    setImgBounds(bounds);

    // Clear
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, cw, ch);

    // Draw image
    ctx.drawImage(img, bounds.x, bounds.y, bounds.w, bounds.h);

    // Dim area outside crop
    const cx = bounds.x + crop.x * bounds.w;
    const cy = bounds.y + crop.y * bounds.h;
    const cWidth = crop.w * bounds.w;
    const cHeight = crop.h * bounds.h;

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    // Top
    ctx.fillRect(bounds.x, bounds.y, bounds.w, cy - bounds.y);
    // Bottom
    ctx.fillRect(bounds.x, cy + cHeight, bounds.w, bounds.y + bounds.h - cy - cHeight);
    // Left
    ctx.fillRect(bounds.x, cy, cx - bounds.x, cHeight);
    // Right
    ctx.fillRect(cx + cWidth, cy, bounds.x + bounds.w - cx - cWidth, cHeight);

    // Crop border
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx, cy, cWidth, cHeight);

    // Rule-of-thirds grid
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + cWidth * i / 3, cy);
      ctx.lineTo(cx + cWidth * i / 3, cy + cHeight);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy + cHeight * i / 3);
      ctx.lineTo(cx + cWidth, cy + cHeight * i / 3);
      ctx.stroke();
    }

    // Corner handles
    const corners = [
      [cx, cy], [cx + cWidth, cy],
      [cx, cy + cHeight], [cx + cWidth, cy + cHeight],
    ];
    ctx.fillStyle = 'white';
    for (const [hx, hy] of corners) {
      ctx.fillRect(hx - HANDLE_SIZE / 2, hy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    }
  }, [loaded, crop, computeBounds]);

  // Resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      setImgBounds(computeBounds());
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [computeBounds, loaded]);

  const getMouseNorm = (e: React.MouseEvent) => {
    const b = imgBounds;
    return {
      nx: (e.clientX - containerRef.current!.getBoundingClientRect().left - b.x) / b.w,
      ny: (e.clientY - containerRef.current!.getBoundingClientRect().top - b.y) / b.h,
    };
  };

  const hitTest = (e: React.MouseEvent): DragHandle => {
    const { nx, ny } = getMouseNorm(e);
    const tol = 0.03;
    const inX = nx >= crop.x - tol && nx <= crop.x + crop.w + tol;
    const inY = ny >= crop.y - tol && ny <= crop.y + crop.h + tol;
    const nearL = Math.abs(nx - crop.x) < tol;
    const nearR = Math.abs(nx - (crop.x + crop.w)) < tol;
    const nearT = Math.abs(ny - crop.y) < tol;
    const nearB = Math.abs(ny - (crop.y + crop.h)) < tol;

    if (nearT && nearL) return 'tl';
    if (nearT && nearR) return 'tr';
    if (nearB && nearL) return 'bl';
    if (nearB && nearR) return 'br';
    if (nearT && inX) return 't';
    if (nearB && inX) return 'b';
    if (nearL && inY) return 'l';
    if (nearR && inY) return 'r';
    if (nx >= crop.x && nx <= crop.x + crop.w && ny >= crop.y && ny <= crop.y + crop.h) return 'move';
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const handle = hitTest(e);
    if (!handle) return;
    setDragHandle(handle);
    const { nx, ny } = getMouseNorm(e);
    dragStartRef.current = { mx: nx, my: ny, crop: { ...crop } };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragHandle) return;
    const { nx, ny } = getMouseNorm(e);
    const { mx, my, crop: sc } = dragStartRef.current;
    const dx = nx - mx;
    const dy = ny - my;

    let { x, y, w, h } = sc;

    switch (dragHandle) {
      case 'move': x += dx; y += dy; break;
      case 'tl': x += dx; y += dy; w -= dx; h -= dy; break;
      case 'tr': w += dx; y += dy; h -= dy; break;
      case 'bl': x += dx; w -= dx; h += dy; break;
      case 'br': w += dx; h += dy; break;
      case 't': y += dy; h -= dy; break;
      case 'b': h += dy; break;
      case 'l': x += dx; w -= dx; break;
      case 'r': w += dx; break;
    }

    // Clamp
    if (w < 0.05) w = 0.05;
    if (h < 0.05) h = 0.05;
    x = Math.max(0, Math.min(1 - w, x));
    y = Math.max(0, Math.min(1 - h, y));

    setCrop({ x, y, w, h });
  };

  const handleMouseUp = () => setDragHandle(null);

  const handleApply = () => {
    const img = imgRef.current;
    if (!img) return;
    const sx = Math.round(crop.x * img.naturalWidth);
    const sy = Math.round(crop.y * img.naturalHeight);
    const sw = Math.round(crop.w * img.naturalWidth);
    const sh = Math.round(crop.h * img.naturalHeight);

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    canvas.toBlob((blob) => {
      if (blob) onCrop(blob);
    }, 'image/png');
  };

  return (
    <div className="fixed inset-0 z-[2000] flex flex-col bg-[#0a0a14]/95 animate-fade-in">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 h-12 bg-[#161625] border-b border-white/5 shrink-0">
        <span className="text-sm font-medium text-white/80">Crop Image</span>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" icon={<X className="w-3.5 h-3.5" />}
            onClick={onCancel} className="text-white/60 hover:text-white hover:bg-white/10">
            Cancel
          </Button>
          <Button size="sm" icon={<Check className="w-3.5 h-3.5" />} onClick={handleApply}>
            Apply Crop
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}>
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>
    </div>
  );
}
