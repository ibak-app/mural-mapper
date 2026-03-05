/**
 * Light & color matching utilities.
 * All operations work on ImageData (Canvas 2D API) — no external deps.
 */

interface ChannelStats {
  mean: number;
  std: number;
}

/** Compute mean and std deviation of a single channel from RGBA pixel data. */
function channelStats(data: Uint8ClampedArray, channel: 0 | 1 | 2, mask?: Uint8Array): ChannelStats {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const idx = i / 4;
    if (mask && !mask[idx]) continue;
    sum += data[i + channel];
    count++;
  }
  if (count === 0) return { mean: 128, std: 40 };
  const mean = sum / count;

  let variance = 0;
  for (let i = 0; i < data.length; i += 4) {
    const idx = i / 4;
    if (mask && !mask[idx]) continue;
    const diff = data[i + channel] - mean;
    variance += diff * diff;
  }
  const std = Math.sqrt(variance / count) || 1;
  return { mean, std };
}

/** Convert RGB to LAB (approximate, fast). */
function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  // Normalize to 0-1
  let rr = r / 255, gg = g / 255, bb = b / 255;

  // Linearize (sRGB gamma)
  rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
  gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
  bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;

  // To XYZ (D65 illuminant)
  let x = (rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375) / 0.95047;
  let y = (rr * 0.2126729 + gg * 0.7151522 + bb * 0.0721750);
  let z = (rr * 0.0193339 + gg * 0.1191920 + bb * 0.9503041) / 1.08883;

  // To Lab
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(x), fy = f(y), fz = f(z);

  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bL = 200 * (fy - fz);
  return [L, a, bL];
}

/** Convert LAB to RGB. */
function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;

  const finv = (t: number) => t > 0.206897 ? t * t * t : (t - 16 / 116) / 7.787;

  let x = 0.95047 * finv(fx);
  let y = finv(fy);
  let z = 1.08883 * finv(fz);

  // XYZ to linear RGB
  let rr = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  let gg = x * -0.9692660 + y * 1.8760108 + z * 0.0415560;
  let bb = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;

  // Gamma compress
  const gamma = (v: number) => v > 0.0031308 ? 1.055 * Math.pow(v, 1 / 2.4) - 0.055 : 12.92 * v;
  rr = gamma(rr);
  gg = gamma(gg);
  bb = gamma(bb);

  return [
    Math.max(0, Math.min(255, Math.round(rr * 255))),
    Math.max(0, Math.min(255, Math.round(gg * 255))),
    Math.max(0, Math.min(255, Math.round(bb * 255))),
  ];
}

/**
 * Match the color distribution of the artwork to the wall region.
 * Uses Reinhard color transfer in LAB space (mean/std matching).
 *
 * @param artData - Artwork ImageData (mutated in place)
 * @param wallData - Wall photo ImageData (reference)
 * @param strength - 0 = no change, 1 = full match
 */
export function matchColor(
  artData: ImageData,
  wallData: ImageData,
  strength: number = 0.5,
): void {
  if (strength <= 0) return;
  const s = Math.min(1, strength);

  // Compute LAB stats for wall
  const wallPixels = wallData.data;
  const wallLabs: [number, number, number][] = [];
  for (let i = 0; i < wallPixels.length; i += 4) {
    wallLabs.push(rgbToLab(wallPixels[i], wallPixels[i + 1], wallPixels[i + 2]));
  }
  const wallL = { mean: 0, std: 0 }, wallA = { mean: 0, std: 0 }, wallB = { mean: 0, std: 0 };
  const n = wallLabs.length;
  for (const [l, a, b] of wallLabs) { wallL.mean += l; wallA.mean += a; wallB.mean += b; }
  wallL.mean /= n; wallA.mean /= n; wallB.mean /= n;
  for (const [l, a, b] of wallLabs) {
    wallL.std += (l - wallL.mean) ** 2;
    wallA.std += (a - wallA.mean) ** 2;
    wallB.std += (b - wallB.mean) ** 2;
  }
  wallL.std = Math.sqrt(wallL.std / n) || 1;
  wallA.std = Math.sqrt(wallA.std / n) || 1;
  wallB.std = Math.sqrt(wallB.std / n) || 1;

  // Compute LAB stats for art and transform
  const artPixels = artData.data;
  const artLabs: [number, number, number][] = [];
  for (let i = 0; i < artPixels.length; i += 4) {
    artLabs.push(rgbToLab(artPixels[i], artPixels[i + 1], artPixels[i + 2]));
  }
  const artL = { mean: 0, std: 0 }, artA = { mean: 0, std: 0 }, artB = { mean: 0, std: 0 };
  const m = artLabs.length;
  for (const [l, a, b] of artLabs) { artL.mean += l; artA.mean += a; artB.mean += b; }
  artL.mean /= m; artA.mean /= m; artB.mean /= m;
  for (const [l, a, b] of artLabs) {
    artL.std += (l - artL.mean) ** 2;
    artA.std += (a - artA.mean) ** 2;
    artB.std += (b - artB.mean) ** 2;
  }
  artL.std = Math.sqrt(artL.std / m) || 1;
  artA.std = Math.sqrt(artA.std / m) || 1;
  artB.std = Math.sqrt(artB.std / m) || 1;

  // Apply Reinhard transfer
  for (let i = 0; i < artPixels.length; i += 4) {
    const idx = i / 4;
    let [l, a, b] = artLabs[idx];

    // Transfer: normalize art, scale to wall distribution
    const newL = ((l - artL.mean) / artL.std) * wallL.std + wallL.mean;
    const newA = ((a - artA.mean) / artA.std) * wallA.std + wallA.mean;
    const newB = ((b - artB.mean) / artB.std) * wallB.std + wallB.mean;

    // Blend with original based on strength
    l = l + (newL - l) * s;
    a = a + (newA - a) * s;
    b = b + (newB - b) * s;

    const [r, g, bv] = labToRgb(l, a, b);
    artPixels[i] = r;
    artPixels[i + 1] = g;
    artPixels[i + 2] = bv;
    // Alpha unchanged
  }
}

/**
 * Match the luminance/brightness of the artwork to the wall.
 *
 * @param artData - Artwork ImageData (mutated in place)
 * @param wallData - Wall photo ImageData (reference)
 * @param strength - 0 = no change, 1 = full match
 */
export function matchLuminance(
  artData: ImageData,
  wallData: ImageData,
  strength: number = 0.5,
): void {
  if (strength <= 0) return;
  const s = Math.min(1, strength);

  // Compute luminance stats for wall
  const wallStats = channelStats(wallData.data, 0); // approximate with R channel for speed
  const wallGray = {
    mean: 0,
    std: 0,
  };
  let wCount = 0;
  for (let i = 0; i < wallData.data.length; i += 4) {
    const gray = 0.299 * wallData.data[i] + 0.587 * wallData.data[i + 1] + 0.114 * wallData.data[i + 2];
    wallGray.mean += gray;
    wCount++;
  }
  wallGray.mean /= wCount;
  for (let i = 0; i < wallData.data.length; i += 4) {
    const gray = 0.299 * wallData.data[i] + 0.587 * wallData.data[i + 1] + 0.114 * wallData.data[i + 2];
    wallGray.std += (gray - wallGray.mean) ** 2;
  }
  wallGray.std = Math.sqrt(wallGray.std / wCount) || 1;

  // Compute luminance stats for art
  const artGray = { mean: 0, std: 0 };
  let aCount = 0;
  for (let i = 0; i < artData.data.length; i += 4) {
    const gray = 0.299 * artData.data[i] + 0.587 * artData.data[i + 1] + 0.114 * artData.data[i + 2];
    artGray.mean += gray;
    aCount++;
  }
  artGray.mean /= aCount;
  for (let i = 0; i < artData.data.length; i += 4) {
    const gray = 0.299 * artData.data[i] + 0.587 * artData.data[i + 1] + 0.114 * artData.data[i + 2];
    artGray.std += (gray - artGray.mean) ** 2;
  }
  artGray.std = Math.sqrt(artGray.std / aCount) || 1;

  // Apply luminance transfer
  const scale = wallGray.std / artGray.std;
  const shift = wallGray.mean - artGray.mean * scale;

  for (let i = 0; i < artData.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const orig = artData.data[i + c];
      const adjusted = orig * scale + shift;
      artData.data[i + c] = Math.max(0, Math.min(255, Math.round(orig + (adjusted - orig) * s)));
    }
  }
}

/**
 * Sample the average color of a wall region for display purposes.
 */
export function sampleWallColor(wallData: ImageData): { r: number; g: number; b: number; luminance: number } {
  let r = 0, g = 0, b = 0;
  const n = wallData.data.length / 4;
  for (let i = 0; i < wallData.data.length; i += 4) {
    r += wallData.data[i];
    g += wallData.data[i + 1];
    b += wallData.data[i + 2];
  }
  r = Math.round(r / n);
  g = Math.round(g / n);
  b = Math.round(b / n);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return { r, g, b, luminance };
}
