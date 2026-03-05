import type { Point } from '@/lib/types';

/**
 * Scanline flood fill — processes horizontal runs for performance.
 * Returns a binary mask (1 = selected, 0 = not) of width × height.
 */
export function floodFill(
  imageData: ImageData,
  seedX: number,
  seedY: number,
  tolerance: number
): Uint8Array {
  const { width, height, data } = imageData;
  const mask = new Uint8Array(width * height);
  const threshold = tolerance * 4.41;
  const thresholdSq = threshold * threshold;

  const sx = Math.round(seedX);
  const sy = Math.round(seedY);
  if (sx < 0 || sx >= width || sy < 0 || sy >= height) return mask;

  const seedIdx = (sy * width + sx) * 4;
  const sr = data[seedIdx];
  const sg = data[seedIdx + 1];
  const sb = data[seedIdx + 2];

  function matches(x: number, y: number): boolean {
    const idx = (y * width + x) * 4;
    const dr = data[idx] - sr;
    const dg = data[idx + 1] - sg;
    const db = data[idx + 2] - sb;
    return dr * dr + dg * dg + db * db <= thresholdSq;
  }

  const stack: [number, number][] = [[sx, sy]];

  while (stack.length > 0) {
    const [cx, cy] = stack.pop()!;
    if (cy < 0 || cy >= height || cx < 0 || cx >= width) continue;

    const rowOffset = cy * width;
    if (mask[rowOffset + cx]) continue;
    if (!matches(cx, cy)) continue;

    // Find left edge of this run
    let left = cx;
    while (left > 0 && !mask[rowOffset + left - 1] && matches(left - 1, cy)) {
      left--;
    }

    // Find right edge of this run
    let right = cx;
    while (right < width - 1 && !mask[rowOffset + right + 1] && matches(right + 1, cy)) {
      right++;
    }

    // Fill the run
    for (let x = left; x <= right; x++) {
      mask[rowOffset + x] = 1;
    }

    // Seed rows above and below — only seed at transitions (entering unfilled matching pixel)
    for (let x = left; x <= right; x++) {
      if (cy > 0 && !mask[(cy - 1) * width + x]) {
        stack.push([x, cy - 1]);
      }
      if (cy < height - 1 && !mask[(cy + 1) * width + x]) {
        stack.push([x, cy + 1]);
      }
    }
  }

  return mask;
}

/**
 * Extract polygon boundary from a binary mask using row-scanning.
 * For each row with filled pixels, records the leftmost and rightmost x.
 * Constructs a polygon by going down the left edge, then up the right edge.
 * This is simple, robust, and works well for wall-like regions.
 */
export function maskToPolygon(
  mask: Uint8Array,
  width: number,
  height: number
): Point[] {
  const leftEdges: Point[] = [];
  const rightEdges: Point[] = [];

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    let left = -1;
    let right = -1;

    for (let x = 0; x < width; x++) {
      if (mask[rowOffset + x]) {
        if (left === -1) left = x;
        right = x;
      }
    }

    if (left !== -1) {
      leftEdges.push({ x: left, y });
      rightEdges.push({ x: right, y });
    }
  }

  if (leftEdges.length < 2) return [];

  // Build polygon: left edges top→bottom, then right edges bottom→top
  const polygon: Point[] = [];
  for (let i = 0; i < leftEdges.length; i++) {
    polygon.push(leftEdges[i]);
  }
  for (let i = rightEdges.length - 1; i >= 0; i--) {
    polygon.push(rightEdges[i]);
  }

  return polygon;
}

/**
 * Douglas-Peucker polygon simplification.
 */
export function simplifyPolygon(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPolygon(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyPolygon(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    const ex = point.x - lineStart.x;
    const ey = point.y - lineStart.y;
    return Math.sqrt(ex * ex + ey * ey);
  }

  const num = Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x);
  return num / Math.sqrt(lenSq);
}

/**
 * Load wall image and extract ImageData at the given display scale.
 */
export async function getWallImageData(
  imageUrl: string,
  imageWidth: number,
  imageHeight: number,
  scale: number
): Promise<ImageData> {
  const cw = Math.ceil(imageWidth * scale);
  const ch = Math.ceil(imageHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx2d = canvas.getContext('2d')!;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error(`Failed to load image: ${imageUrl}`));
    el.src = imageUrl;
  });

  ctx2d.drawImage(img, 0, 0, cw, ch);
  return ctx2d.getImageData(0, 0, cw, ch);
}

/**
 * Combine two binary masks.
 * - 'add': union (OR)
 * - 'subtract': remove newMask pixels from baseMask (AND-NOT)
 */
export function combineMasks(
  baseMask: Uint8Array,
  newMask: Uint8Array,
  mode: 'add' | 'subtract'
): Uint8Array {
  const result = new Uint8Array(baseMask.length);
  for (let i = 0; i < baseMask.length; i++) {
    if (mode === 'add') {
      result[i] = baseMask[i] || newMask[i] ? 1 : 0;
    } else {
      result[i] = baseMask[i] && !newMask[i] ? 1 : 0;
    }
  }
  return result;
}

/**
 * Convert a binary mask to normalized (0-1) polygon points, or null if area too small.
 */
export function maskToPoints(
  mask: Uint8Array,
  width: number,
  height: number
): Point[] | null {
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) count++;
  }
  if (count < 100) return null;

  const polygon = maskToPolygon(mask, width, height);
  if (polygon.length < 3) return null;

  const epsilon = Math.max(width, height) * 0.005;
  let simplified = simplifyPolygon(polygon, epsilon);

  if (simplified.length < 3) {
    simplified = polygon;
  }

  return simplified.map((p) => ({
    x: Math.max(0, Math.min(1, p.x / width)),
    y: Math.max(0, Math.min(1, p.y / height)),
  }));
}

/**
 * Orchestrator: flood fill → boundary polygon → simplify → normalize.
 * Returns normalized (0-1) polygon points, or null if area too small.
 */
export function detectRegion(
  imageData: ImageData,
  seedX: number,
  seedY: number,
  tolerance: number
): Point[] | null {
  const { width, height } = imageData;

  const mask = floodFill(imageData, seedX, seedY, tolerance);

  // Count filled pixels
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) count++;
  }
  if (count < 100) return null;

  const polygon = maskToPolygon(mask, width, height);
  if (polygon.length < 3) return null;

  // Simplify — use a reasonable epsilon based on image size
  const epsilon = Math.max(width, height) * 0.005;
  let simplified = simplifyPolygon(polygon, epsilon);

  if (simplified.length < 3) {
    // Fall back to unsimplified if simplification is too aggressive
    simplified = polygon;
  }

  // Normalize to 0-1 range
  return simplified.map((p) => ({
    x: Math.max(0, Math.min(1, p.x / width)),
    y: Math.max(0, Math.min(1, p.y / height)),
  }));
}

import { detectWallRegion } from '@/lib/cv/wall-detector';
import { isOpenCVLoaded } from '@/lib/cv/opencv-loader';

/**
 * OpenCV-enhanced region detection with fallback to scanline flood fill.
 * If OpenCV.js is already loaded, uses the full CV pipeline (Canny edges +
 * flood fill + morphological close + contour approximation) for more accurate
 * wall boundary detection. Falls back to the pure-JS detectRegion() when
 * OpenCV has not been loaded yet, keeping the first interaction fast.
 */
export async function detectRegionCV(
  imageData: ImageData,
  seedX: number,
  seedY: number,
  tolerance: number,
): Promise<{ x: number; y: number }[] | null> {
  // Try OpenCV first if loaded
  if (isOpenCVLoaded()) {
    try {
      const result = await detectWallRegion(imageData, seedX, seedY, tolerance);
      if (result.points.length >= 3) {
        return result.points;
      }
    } catch {
      // Fall through to legacy detection
    }
  }

  // Fallback to existing flood fill
  return detectRegion(imageData, seedX, seedY, tolerance);
}
