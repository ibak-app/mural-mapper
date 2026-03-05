

import { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowLeft, Download, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { matchColor, matchLuminance } from '@/lib/cv/light-matcher';
import { compositeArtOnWall } from '@/lib/cv/compositor';

interface Corner { x: number; y: number }

interface RefineStepProps {
  wallImage: HTMLImageElement;
  artImage: HTMLImageElement;
  corners: [Corner, Corner, Corner, Corner];
  onBack: () => void;
}

interface Settings {
  opacity: number;
  shadowStrength: number;
  colorMatch: number;
  lightMatch: number;
  edgeFeather: number;
}

const DEFAULT_SETTINGS: Settings = {
  opacity: 100,
  shadowStrength: 30,
  colorMatch: 0,
  lightMatch: 0,
  edgeFeather: 0,
};

export function RefineStep({ wallImage, artImage, corners, onBack }: RefineStepProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [showOriginal, setShowOriginal] = useState(false);
  const [sliderPos, setSliderPos] = useState(50);
  const [compareMode, setCompareMode] = useState(false);
  const dragging = useRef(false);

  // Cached canvases
  const wallCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const warpedArtRef = useRef<HTMLCanvasElement | null>(null);

  // Create wall canvas and warped art canvas on mount
  useEffect(() => {
    const iw = wallImage.naturalWidth;
    const ih = wallImage.naturalHeight;

    // Wall canvas
    const wc = document.createElement('canvas');
    wc.width = iw;
    wc.height = ih;
    const wctx = wc.getContext('2d')!;
    wctx.drawImage(wallImage, 0, 0);
    wallCanvasRef.current = wc;

    // Warp art onto wall-sized canvas using triangle subdivision
    const ac = document.createElement('canvas');
    ac.width = iw;
    ac.height = ih;
    const actx = ac.getContext('2d')!;

    const aw = artImage.naturalWidth;
    const ah = artImage.naturalHeight;

    // Create art source canvas
    const artSrc = document.createElement('canvas');
    artSrc.width = aw;
    artSrc.height = ah;
    const asctx = artSrc.getContext('2d')!;
    asctx.drawImage(artImage, 0, 0);

    // Convert normalized corners to pixel coords
    const pts = corners.map((c) => ({ x: c.x * iw, y: c.y * ih }));

    // Bilinear interpolation within the quad
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const quadInterp = (u: number, v: number) => ({
      x: lerp(lerp(pts[0].x, pts[1].x, u), lerp(pts[3].x, pts[2].x, u), v),
      y: lerp(lerp(pts[0].y, pts[1].y, u), lerp(pts[3].y, pts[2].y, u), v),
    });

    const SUBS = 12;
    const stepX = aw / SUBS;
    const stepY = ah / SUBS;

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

        drawTriangle(actx, artSrc,
          sx0, sy0, sx1, sy0, sx1, sy1,
          d00.x, d00.y, d10.x, d10.y, d11.x, d11.y,
        );
        drawTriangle(actx, artSrc,
          sx0, sy0, sx1, sy1, sx0, sy1,
          d00.x, d00.y, d11.x, d11.y, d01.x, d01.y,
        );
      }
    }

    warpedArtRef.current = ac;
  }, [wallImage, artImage, corners]);

  // Render composite whenever settings change
  const renderComposite = useCallback(() => {
    const canvas = canvasRef.current;
    const wallCanvas = wallCanvasRef.current;
    const warpedArt = warpedArtRef.current;
    if (!canvas || !wallCanvas || !warpedArt) return;

    const container = containerRef.current;
    if (!container) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d')!;

    const iw = wallImage.naturalWidth;
    const ih = wallImage.naturalHeight;
    const scale = Math.min(cw / iw, ch / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;

    ctx.fillStyle = '#0f0f1a';
    ctx.fillRect(0, 0, cw, ch);

    if (showOriginal) {
      ctx.drawImage(wallCanvas, dx, dy, dw, dh);
      return;
    }

    // Apply light/color matching to warped art
    const processedArt = document.createElement('canvas');
    processedArt.width = iw;
    processedArt.height = ih;
    const pctx = processedArt.getContext('2d')!;
    pctx.drawImage(warpedArt, 0, 0);

    if (settings.lightMatch > 0 || settings.colorMatch > 0) {
      const artData = pctx.getImageData(0, 0, iw, ih);

      // Sample wall region within the quad for reference
      const wallCtx = wallCanvas.getContext('2d')!;
      // Use the bounding box of the quad for wall sampling
      const xs = corners.map((c) => c.x * iw);
      const ys = corners.map((c) => c.y * ih);
      const bx = Math.max(0, Math.floor(Math.min(...xs)));
      const by = Math.max(0, Math.floor(Math.min(...ys)));
      const bw = Math.min(iw, Math.ceil(Math.max(...xs))) - bx;
      const bh = Math.min(ih, Math.ceil(Math.max(...ys))) - by;
      const wallRegion = wallCtx.getImageData(bx, by, Math.max(1, bw), Math.max(1, bh));

      if (settings.lightMatch > 0) {
        matchLuminance(artData, wallRegion, settings.lightMatch / 100);
      }
      if (settings.colorMatch > 0) {
        matchColor(artData, wallRegion, settings.colorMatch / 100);
      }
      pctx.putImageData(artData, 0, 0);
    }

    // Composite
    const result = compositeArtOnWall(wallCanvas, processedArt, {
      opacity: settings.opacity / 100,
      shadowStrength: settings.shadowStrength / 100,
      edgeFeather: settings.edgeFeather,
      blendMode: 'multiply',
    });

    if (compareMode) {
      // Before/after split
      const splitX = dx + dw * (sliderPos / 100);

      // Left side: original
      ctx.save();
      ctx.beginPath();
      ctx.rect(dx, dy, splitX - dx, dh);
      ctx.clip();
      ctx.drawImage(wallCanvas, dx, dy, dw, dh);
      ctx.restore();

      // Right side: composite
      ctx.save();
      ctx.beginPath();
      ctx.rect(splitX, dy, dx + dw - splitX, dh);
      ctx.clip();
      ctx.drawImage(result, dx, dy, dw, dh);
      ctx.restore();

      // Divider line
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(splitX, dy);
      ctx.lineTo(splitX, dy + dh);
      ctx.stroke();

      // Labels
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.font = '11px Inter, sans-serif';
      const pad = 8;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(dx + pad, dy + pad, 50, 20);
      ctx.fillRect(splitX + pad, dy + pad, 50, 20);
      ctx.fillStyle = 'white';
      ctx.textAlign = 'left';
      ctx.fillText('Before', dx + pad + 6, dy + pad + 14);
      ctx.fillText('After', splitX + pad + 6, dy + pad + 14);
    } else {
      ctx.drawImage(result, dx, dy, dw, dh);
    }
  }, [settings, showOriginal, compareMode, sliderPos, wallImage, corners]);

  useEffect(() => {
    renderComposite();
  }, [renderComposite]);

  // Resize handler
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => renderComposite());
    ro.observe(container);
    return () => ro.disconnect();
  }, [renderComposite]);

  const handleSliderMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pos = ((e.clientX - rect.left) / rect.width) * 100;
    setSliderPos(Math.max(5, Math.min(95, pos)));
  };

  const handleDownload = () => {
    const wallCanvas = wallCanvasRef.current;
    const warpedArt = warpedArtRef.current;
    if (!wallCanvas || !warpedArt) return;

    const iw = wallImage.naturalWidth;
    const ih = wallImage.naturalHeight;

    // Apply processing at full resolution
    const processedArt = document.createElement('canvas');
    processedArt.width = iw;
    processedArt.height = ih;
    const pctx = processedArt.getContext('2d')!;
    pctx.drawImage(warpedArt, 0, 0);

    if (settings.lightMatch > 0 || settings.colorMatch > 0) {
      const artData = pctx.getImageData(0, 0, iw, ih);
      const wallCtx = wallCanvas.getContext('2d')!;
      const xs = corners.map((c) => c.x * iw);
      const ys = corners.map((c) => c.y * ih);
      const bx = Math.max(0, Math.floor(Math.min(...xs)));
      const by = Math.max(0, Math.floor(Math.min(...ys)));
      const bw = Math.min(iw, Math.ceil(Math.max(...xs))) - bx;
      const bh = Math.min(ih, Math.ceil(Math.max(...ys))) - by;
      const wallRegion = wallCtx.getImageData(bx, by, Math.max(1, bw), Math.max(1, bh));

      if (settings.lightMatch > 0) matchLuminance(artData, wallRegion, settings.lightMatch / 100);
      if (settings.colorMatch > 0) matchColor(artData, wallRegion, settings.colorMatch / 100);
      pctx.putImageData(artData, 0, 0);
    }

    const result = compositeArtOnWall(wallCanvas, processedArt, {
      opacity: settings.opacity / 100,
      shadowStrength: settings.shadowStrength / 100,
      edgeFeather: settings.edgeFeather,
      blendMode: 'multiply',
    });

    const link = document.createElement('a');
    link.download = 'mural-mockup.png';
    link.href = result.toDataURL('image/png');
    link.click();
  };

  const updateSetting = (key: keyof Settings) => (value: number) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="fixed inset-0 flex bg-[#0f0f1a] animate-fade-in" style={{ top: 54 }}>
      {/* Canvas area */}
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 h-12 bg-[#161625] border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-white/40 hover:text-white transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-white/80">Refine & Export</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCompareMode((v) => !v)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                compareMode
                  ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500/30'
                  : 'bg-white/[0.07] text-white/60 border-white/10 hover:text-white',
              )}
            >
              <SlidersHorizontal className="w-3 h-3" />
              Before / After
            </button>
            <Button size="sm" icon={<Download className="w-3.5 h-3.5" />} onClick={handleDownload}>
              Download
            </Button>
          </div>
        </div>

        {/* Canvas */}
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden"
          onMouseMove={compareMode ? handleSliderMouseMove : undefined}
          onMouseUp={() => { dragging.current = false; }}
          onMouseLeave={() => { dragging.current = false; }}
        >
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
          {compareMode && (
            <div
              className="absolute top-0 bottom-0 w-1 bg-white/60 cursor-col-resize z-10"
              style={{ left: `${sliderPos}%` }}
              onMouseDown={() => { dragging.current = true; }}
            >
              <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center">
                <SlidersHorizontal className="w-3.5 h-3.5 text-gray-600" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right panel — settings */}
      <div className="w-72 bg-[#161625] border-l border-white/5 flex flex-col overflow-y-auto">
        <div className="p-5 space-y-6">
          <div>
            <h3 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-4">Adjustments</h3>

            <div className="space-y-5">
              <SliderRow label="Opacity" value={settings.opacity} onChange={updateSetting('opacity')} suffix="%" />
              <SliderRow label="Shadow / Texture" value={settings.shadowStrength} onChange={updateSetting('shadowStrength')} suffix="%" />
              <SliderRow label="Light Match" value={settings.lightMatch} onChange={updateSetting('lightMatch')} suffix="%" />
              <SliderRow label="Color Match" value={settings.colorMatch} onChange={updateSetting('colorMatch')} suffix="%" />
              <SliderRow label="Edge Feather" value={settings.edgeFeather} onChange={updateSetting('edgeFeather')} max={50} suffix="px" />
            </div>
          </div>

          <div className="border-t border-white/5 pt-5">
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw className="w-3.5 h-3.5" />}
              onClick={() => setSettings(DEFAULT_SETTINGS)}
              className="w-full text-white/40 hover:text-white hover:bg-white/5"
            >
              Reset to defaults
            </Button>
          </div>

          <div className="border-t border-white/5 pt-5">
            <h3 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Quick View</h3>
            <button
              onMouseDown={() => setShowOriginal(true)}
              onMouseUp={() => setShowOriginal(false)}
              onMouseLeave={() => setShowOriginal(false)}
              className="w-full text-center py-2.5 rounded-xl bg-white/5 text-white/50 text-xs font-medium hover:bg-white/10 hover:text-white/70 transition-all select-none"
            >
              Hold to see original
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  suffix = '',
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-white/60">{label}</span>
        <span className="text-xs tabular-nums text-white/40">{value}{suffix}</span>
      </div>
      <Slider value={value} onValueChange={onChange} min={min} max={max} variant="dark" />
    </div>
  );
}

// Triangle warp helper (same as map-step)
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
