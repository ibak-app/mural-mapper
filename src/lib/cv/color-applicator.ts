import type { Point } from '@/lib/types';

/**
 * Applies a color to a wall region while preserving texture/shadows.
 * Uses the 'color' composite mode (like Dulux/Sherwin-Williams visualizers).
 */
export function applyColorToWall(
  sourceCanvas: HTMLCanvasElement | OffscreenCanvas,
  polygon: Point[],
  color: string,
  opacity: number = 0.6,
): HTMLCanvasElement {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;

  const result = document.createElement('canvas');
  result.width = width;
  result.height = height;
  const ctx = result.getContext('2d')!;

  // Draw original image
  ctx.drawImage(sourceCanvas as HTMLCanvasElement, 0, 0);

  // Create clipping path from polygon
  ctx.save();
  ctx.beginPath();
  const pts = polygon.map(p => ({ x: p.x * width, y: p.y * height }));
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.closePath();
  ctx.clip();

  // Apply color with 'color' blend mode — preserves luminance (texture/shadows)
  ctx.globalCompositeOperation = 'color';
  ctx.globalAlpha = opacity;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);

  ctx.restore();

  return result;
}
