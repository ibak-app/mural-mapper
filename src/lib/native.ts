// Native bridge — uses Tauri commands when running as desktop app,
// falls back to browser APIs when running in a regular browser.

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

interface NativeImageInfo {
  width: number;
  height: number;
  thumb_b64: string; // base64 JPEG thumbnail
  path: string;
}

/** Open native file picker for images. Returns file paths. */
export async function pickImageFiles(multiple = true): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      multiple,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
    });
    if (!result) return [];
    // Normalize — result can be string, string[], or objects with path property
    const items = Array.isArray(result) ? result : [result];
    return items.map(item => typeof item === 'string' ? item : (item as any).path ?? String(item));
  } catch (e) {
    console.error('pickImageFiles failed:', e);
    return [];
  }
}

/** Load a single image thumbnail natively (Rust-side). */
export async function loadImageThumb(path: string): Promise<NativeImageInfo | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<NativeImageInfo>('load_image_thumb', { path, maxThumbSize: 200 });
  } catch (e) {
    console.error('loadImageThumb failed:', e);
    return null;
  }
}

/** Load full-resolution image as data URL for canvas ops. */
export async function readImageFull(path: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('read_image_full', { path });
}

/** Convert data URL to HTMLImageElement. */
export function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}
