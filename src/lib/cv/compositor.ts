/**
 * Final compositing engine.
 * Takes a wall photo + warped artwork and produces a realistic composite.
 */

export interface CompositeOptions {
  opacity: number;        // 0-1, artwork visibility
  shadowStrength: number; // 0-1, how much wall texture/shadow shows through
  edgeFeather: number;    // 0-50px, edge softening radius
  blendMode: 'multiply' | 'overlay' | 'soft-light' | 'normal';
}

const DEFAULT_OPTIONS: CompositeOptions = {
  opacity: 1,
  shadowStrength: 0.3,
  edgeFeather: 0,
  blendMode: 'multiply',
};

/**
 * Composite the warped artwork onto the wall photo.
 *
 * @param wallCanvas - The original wall photo (canvas or image)
 * @param artCanvas - The perspective-warped artwork (same dimensions as wall, transparent outside quad)
 * @param options - Compositing options
 * @returns A new canvas with the final composite
 */
export function compositeArtOnWall(
  wallCanvas: HTMLCanvasElement | HTMLImageElement,
  artCanvas: HTMLCanvasElement,
  options: Partial<CompositeOptions> = {},
): HTMLCanvasElement {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const w = artCanvas.width;
  const h = artCanvas.height;

  // Create output canvas starting with wall photo
  const output = document.createElement('canvas');
  output.width = w;
  output.height = h;
  const ctx = output.getContext('2d')!;

  // Draw wall as base
  ctx.drawImage(wallCanvas, 0, 0, w, h);

  // If shadow strength > 0, create a shadow texture layer
  if (opts.shadowStrength > 0 && opts.blendMode !== 'normal') {
    // Extract wall luminance for the shadow/texture overlay
    const wallCtx = document.createElement('canvas');
    wallCtx.width = w;
    wallCtx.height = h;
    const wctx = wallCtx.getContext('2d')!;
    wctx.drawImage(wallCanvas, 0, 0, w, h);

    // Get art alpha mask to know where to apply shadow
    const artCtx = artCanvas.getContext('2d')!;
    const artData = artCtx.getImageData(0, 0, w, h);

    // Draw artwork with opacity
    ctx.globalAlpha = opts.opacity;
    ctx.drawImage(artCanvas, 0, 0);

    // Apply wall texture on top using multiply blend (preserves shadows)
    ctx.globalAlpha = opts.shadowStrength;
    ctx.globalCompositeOperation = opts.blendMode;

    // We only want the shadow to apply where the art is, so create a masked version
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = w;
    shadowCanvas.height = h;
    const sctx = shadowCanvas.getContext('2d')!;

    // Draw wall grayscale
    sctx.drawImage(wallCanvas, 0, 0, w, h);

    // Convert to grayscale for pure luminance
    const shadowData = sctx.getImageData(0, 0, w, h);
    for (let i = 0; i < shadowData.data.length; i += 4) {
      const gray = 0.299 * shadowData.data[i] + 0.587 * shadowData.data[i + 1] + 0.114 * shadowData.data[i + 2];
      shadowData.data[i] = gray;
      shadowData.data[i + 1] = gray;
      shadowData.data[i + 2] = gray;
      // Use art alpha to mask shadow
      shadowData.data[i + 3] = artData.data[i + 3];
    }
    sctx.putImageData(shadowData, 0, 0);

    ctx.drawImage(shadowCanvas, 0, 0);

    // Reset
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  } else {
    // Simple overlay without shadow
    ctx.globalAlpha = opts.opacity;
    ctx.drawImage(artCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }

  // Edge feathering
  if (opts.edgeFeather > 0) {
    applyEdgeFeather(ctx, artCanvas, w, h, opts.edgeFeather);
  }

  return output;
}

/**
 * Apply a feathered edge where art meets wall.
 * This blends the art edges smoothly into the wall.
 */
function applyEdgeFeather(
  ctx: CanvasRenderingContext2D,
  artCanvas: HTMLCanvasElement,
  w: number,
  h: number,
  radius: number,
): void {
  // Get the art's alpha channel to find edges
  const artCtx = artCanvas.getContext('2d')!;
  const artData = artCtx.getImageData(0, 0, w, h);

  // Simple approach: blur the alpha mask of the art, then use it to blend
  // For performance, we'll use a box blur approximation
  const alpha = new Float32Array(w * h);
  for (let i = 0; i < artData.data.length; i += 4) {
    alpha[i / 4] = artData.data[i + 3] / 255;
  }

  // Box blur the alpha (approximates Gaussian)
  const blurred = boxBlur(alpha, w, h, radius);

  // Re-read the composite
  const compositeData = ctx.getImageData(0, 0, w, h);

  // Get a clean wall layer
  const wallCanvas = document.createElement('canvas');
  wallCanvas.width = w;
  wallCanvas.height = h;
  // We can't get the original wall here easily, so we skip this step
  // The edge feather is applied during the warp step instead
  // This is a simplified version that just softens the alpha edges

  for (let i = 0; i < compositeData.data.length; i += 4) {
    const idx = i / 4;
    const originalAlpha = alpha[idx];
    const blurredAlpha = blurred[idx];

    // Only affect edge pixels (where original alpha transitions)
    if (originalAlpha > 0 && originalAlpha < 1) {
      compositeData.data[i + 3] = Math.round(blurredAlpha * 255);
    }
  }

  ctx.putImageData(compositeData, 0, 0);
}

function boxBlur(data: Float32Array, w: number, h: number, radius: number): Float32Array {
  const r = Math.round(radius);
  if (r <= 0) return data;

  const out = new Float32Array(data.length);
  const temp = new Float32Array(data.length);

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    let sum = 0;
    let count = 0;
    for (let x = -r; x <= r; x++) {
      if (x >= 0 && x < w) { sum += data[y * w + x]; count++; }
    }
    for (let x = 0; x < w; x++) {
      temp[y * w + x] = sum / count;
      const addX = x + r + 1;
      const remX = x - r;
      if (addX < w) { sum += data[y * w + addX]; count++; }
      if (remX >= 0) { sum -= data[y * w + remX]; count--; }
    }
  }

  // Vertical pass
  for (let x = 0; x < w; x++) {
    let sum = 0;
    let count = 0;
    for (let y = -r; y <= r; y++) {
      if (y >= 0 && y < h) { sum += temp[y * w + x]; count++; }
    }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / count;
      const addY = y + r + 1;
      const remY = y - r;
      if (addY < h) { sum += temp[addY * w + x]; count++; }
      if (remY >= 0) { sum -= temp[remY * w + x]; count--; }
    }
  }

  return out;
}
