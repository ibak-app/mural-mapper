// ImageBitmap-based cache — all decoding happens off the main thread
// Thumbnails are tiny JPEGs (~5KB), full bitmaps are cached per file
// Full bitmaps use LRU eviction to avoid GPU memory exhaustion on WebKit

const THUMB_SIZE = 150;
const MAX_CACHED_BITMAPS = 15; // ~15 large images before evicting oldest
const bitmapCache = new Map<string, ImageBitmap>(); // insertion order = LRU order
const thumbCache = new Map<string, string>();
const fileKeys = new WeakMap<File | Blob, string>();
let keyCounter = 0;

function getKey(file: File | Blob): string {
  let key = fileKeys.get(file);
  if (!key) {
    if (file instanceof File) {
      key = `${file.name}_${file.size}_${file.lastModified}`;
    } else {
      key = `blob_${keyCounter++}_${file.size}`;
    }
    fileKeys.set(file, key);
  }
  return key;
}

// Evict oldest entries when cache exceeds limit
function enforceCacheLimit() {
  while (bitmapCache.size > MAX_CACHED_BITMAPS) {
    const oldest = bitmapCache.keys().next().value;
    if (oldest === undefined) break;
    const bmp = bitmapCache.get(oldest);
    if (bmp) bmp.close();
    bitmapCache.delete(oldest);
  }
}

// Generate a tiny JPEG thumbnail URL — decode + resize runs off main thread
export async function generateThumb(file: File | Blob): Promise<string> {
  const key = getKey(file);
  const cached = thumbCache.get(key);
  if (cached) return cached;

  const bitmap = await createImageBitmap(file, {
    resizeWidth: THUMB_SIZE,
    resizeHeight: THUMB_SIZE,
    resizeQuality: 'low',
  });

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
  const url = URL.createObjectURL(blob);
  thumbCache.set(key, url);
  return url;
}

// Staggered batch thumb generation — first N immediately, rest streamed
export async function generateThumbsBatch(
  files: (File | Blob)[],
  onThumb: (index: number, url: string) => void,
  immediateCount = 3,
): Promise<void> {
  // First batch in parallel
  const first = files.slice(0, immediateCount);
  const firstResults = await Promise.all(first.map(f => generateThumb(f)));
  firstResults.forEach((url, i) => onThumb(i, url));

  // Rest one-by-one to avoid overwhelming the decoder
  for (let i = immediateCount; i < files.length; i++) {
    const url = await generateThumb(files[i]);
    onThumb(i, url);
  }
}

// Get full-size ImageBitmap — decoded off main thread, LRU cached
export async function getFullBitmap(file: File | Blob): Promise<ImageBitmap> {
  const key = getKey(file);
  const cached = bitmapCache.get(key);
  if (cached) {
    // Move to end (most recently used)
    bitmapCache.delete(key);
    bitmapCache.set(key, cached);
    return cached;
  }

  const bitmap = await createImageBitmap(file);
  bitmapCache.set(key, bitmap);
  enforceCacheLimit();
  return bitmap;
}

// Draw a bitmap onto a canvas, fitted (contain mode), with optional crop
export function drawFitted(
  canvas: HTMLCanvasElement,
  bitmap: ImageBitmap,
  crop?: { x: number; y: number; w: number; h: number } | null,
  padding = 16,
) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement!.getBoundingClientRect();
  const cw = rect.width;
  const ch = rect.height;
  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  canvas.style.width = `${cw}px`;
  canvas.style.height = `${ch}px`;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cw, ch);

  // Source region (full image or crop)
  const sx = crop?.x ?? 0;
  const sy = crop?.y ?? 0;
  const sw = crop?.w ?? bitmap.width;
  const sh = crop?.h ?? bitmap.height;

  const availW = cw - padding * 2;
  const availH = ch - padding * 2;
  const scale = Math.min(availW / sw, availH / sh, 1);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (cw - dw) / 2;
  const dy = (ch - dh) / 2;

  ctx.drawImage(bitmap, sx, sy, sw, sh, dx, dy, dw, dh);
}

// Preload thumbnails during idle time (full bitmaps loaded on-demand with LRU)
export function preloadAll(
  files: (File | Blob)[],
  onProgress?: (loaded: number, total: number) => void,
): () => void {
  let cancelled = false;
  let loaded = 0;
  const total = files.length;

  const preloadNext = (index: number) => {
    if (cancelled || index >= files.length) return;

    const schedule = typeof requestIdleCallback !== 'undefined'
      ? requestIdleCallback
      : (cb: () => void) => setTimeout(cb, 16);

    schedule(async () => {
      if (cancelled) return;
      const file = files[index];
      const key = getKey(file);
      // Only preload thumbnails — full bitmaps are loaded on-demand with LRU eviction
      if (!thumbCache.has(key)) {
        try {
          await generateThumb(file);
        } catch {
          // Skip
        }
      }
      loaded++;
      onProgress?.(loaded, total);
      preloadNext(index + 1);
    });
  };

  preloadNext(0);

  return () => {
    cancelled = true;
  };
}

// Evict cached data for a file
export function evict(file: File | Blob) {
  const key = getKey(file);
  const bitmap = bitmapCache.get(key);
  if (bitmap) { bitmap.close(); bitmapCache.delete(key); }
  const url = thumbCache.get(key);
  if (url) { URL.revokeObjectURL(url); thumbCache.delete(key); }
}
