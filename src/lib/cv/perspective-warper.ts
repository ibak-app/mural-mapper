import type { Point } from '@/lib/types';

/**
 * Solve a 8x8 linear system to find the 3x3 projective homography matrix
 * that maps srcPoints to dstPoints (4 point correspondences).
 *
 * Returns the 3x3 matrix as a flat 9-element array [h0..h8] where h8=1.
 */
function computeHomography(
  src: [number, number][],
  dst: [number, number][],
): number[] {
  // Build the 8x9 matrix for the system Ah = 0
  // Using the DLT (Direct Linear Transform) approach
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = src[i];
    const [dx, dy] = dst[i];
    A.push([-sx, -sy, -1, 0, 0, 0, dx * sx, dx * sy, dx]);
    A.push([0, 0, 0, -sx, -sy, -1, dy * sx, dy * sy, dy]);
  }

  // Solve 8x8 system: rearrange so h8=1
  // We have 8 equations, 8 unknowns (h0..h7), with h8 moved to RHS
  const M: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 8; i++) {
    M.push(A[i].slice(0, 8));
    b.push(-A[i][8]);
  }

  // Gaussian elimination with partial pivoting
  for (let col = 0; col < 8; col++) {
    let maxRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < 8; row++) {
      if (Math.abs(M[row][col]) > maxVal) {
        maxVal = Math.abs(M[row][col]);
        maxRow = row;
      }
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    [b[col], b[maxRow]] = [b[maxRow], b[col]];

    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-10) continue;

    for (let row = col + 1; row < 8; row++) {
      const factor = M[row][col] / pivot;
      for (let j = col; j < 8; j++) {
        M[row][j] -= factor * M[col][j];
      }
      b[row] -= factor * b[col];
    }
  }

  // Back substitution
  const h = new Array(9).fill(0);
  h[8] = 1;
  for (let row = 7; row >= 0; row--) {
    let sum = b[row];
    for (let j = row + 1; j < 8; j++) {
      sum -= M[row][j] * h[j];
    }
    h[row] = sum / M[row][row];
  }

  return h;
}

/**
 * Apply the homography matrix to transform a point from src to dst space.
 */
function transformPoint(h: number[], x: number, y: number): [number, number] {
  const w = h[6] * x + h[7] * y + h[8];
  return [
    (h[0] * x + h[1] * y + h[2]) / w,
    (h[3] * x + h[4] * y + h[5]) / w,
  ];
}

/**
 * Draw a textured triangle from source image to destination using affine mapping.
 */
function drawTriangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  // Source triangle (in image pixel coords)
  s0x: number, s0y: number,
  s1x: number, s1y: number,
  s2x: number, s2y: number,
  // Dest triangle (in output coords)
  d0x: number, d0y: number,
  d1x: number, d1y: number,
  d2x: number, d2y: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0x, d0y);
  ctx.lineTo(d1x, d1y);
  ctx.lineTo(d2x, d2y);
  ctx.closePath();
  ctx.clip();

  // Compute affine transform from src triangle to dest triangle
  // We need to find the 2x3 matrix [a b c; d e f] such that:
  //   [d0x] = [a b] [s0x] + [c]
  //   [d0y]   [d e] [s0y]   [f]
  const denom = (s0x * (s1y - s2y) + s1x * (s2y - s0y) + s2x * (s0y - s1y));
  if (Math.abs(denom) < 1e-10) {
    ctx.restore();
    return;
  }

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

/**
 * Warp a mural image onto a quad (4-corner wall region) using perspective transform.
 * Uses triangle subdivision to approximate the projective warp with affine triangles.
 *
 * @param muralCanvas - Source mural canvas/image
 * @param destQuad - 4 corners of the wall quad in pixel coords [TL, TR, BR, BL]
 * @param outputWidth - Width of the output canvas
 * @param outputHeight - Height of the output canvas
 * @param opacity - Blend opacity
 * @returns Canvas with the warped mural
 */
export async function warpMuralToQuad(
  muralCanvas: HTMLCanvasElement | HTMLImageElement,
  destQuad: [Point, Point, Point, Point],
  outputWidth: number,
  outputHeight: number,
  opacity: number = 1,
): Promise<HTMLCanvasElement> {
  const mw = muralCanvas instanceof HTMLCanvasElement ? muralCanvas.width : muralCanvas.naturalWidth;
  const mh = muralCanvas instanceof HTMLCanvasElement ? muralCanvas.height : muralCanvas.naturalHeight;

  // Source rectangle corners
  const srcPoints: [number, number][] = [
    [0, 0], [mw, 0], [mw, mh], [0, mh],
  ];

  // Destination quad corners
  const dstPoints: [number, number][] = [
    [destQuad[0].x, destQuad[0].y],
    [destQuad[1].x, destQuad[1].y],
    [destQuad[2].x, destQuad[2].y],
    [destQuad[3].x, destQuad[3].y],
  ];

  // Compute the homography matrix
  const H = computeHomography(srcPoints, dstPoints);

  // Create source canvas
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = mw;
  srcCanvas.height = mh;
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.drawImage(muralCanvas as CanvasImageSource, 0, 0);

  // Create output canvas
  const output = document.createElement('canvas');
  output.width = outputWidth;
  output.height = outputHeight;
  const ctx = output.getContext('2d')!;
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = 'multiply';

  // Subdivide the source rectangle into a grid and warp each cell as 2 triangles
  const SUBDIVISIONS = 8;
  const stepX = mw / SUBDIVISIONS;
  const stepY = mh / SUBDIVISIONS;

  for (let gy = 0; gy < SUBDIVISIONS; gy++) {
    for (let gx = 0; gx < SUBDIVISIONS; gx++) {
      const sx0 = gx * stepX;
      const sy0 = gy * stepY;
      const sx1 = (gx + 1) * stepX;
      const sy1 = (gy + 1) * stepY;

      // Transform corners through homography
      const [d0x, d0y] = transformPoint(H, sx0, sy0);
      const [d1x, d1y] = transformPoint(H, sx1, sy0);
      const [d2x, d2y] = transformPoint(H, sx1, sy1);
      const [d3x, d3y] = transformPoint(H, sx0, sy1);

      // Two triangles per quad cell
      drawTriangle(ctx, srcCanvas, sx0, sy0, sx1, sy0, sx1, sy1, d0x, d0y, d1x, d1y, d2x, d2y);
      drawTriangle(ctx, srcCanvas, sx0, sy0, sx1, sy1, sx0, sy1, d0x, d0y, d2x, d2y, d3x, d3y);
    }
  }

  return output;
}
