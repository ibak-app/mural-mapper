// Web Worker for wall detection — runs entirely off the main thread

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const workerSelf: any = self;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cv: any = null;

interface Corner { x: number; y: number }
interface WallCandidate { corners: [Corner, Corner, Corner, Corner]; area: number }

workerSelf.onmessage = async (e: MessageEvent) => {
  const { imageData, width, height } = e.data as {
    imageData: ImageData;
    width: number;
    height: number;
  };

  try {
    // Stage 1: Load OpenCV
    workerSelf.postMessage({ type: 'stage', stage: 'loading-opencv' });
    if (!cv) {
      // Load OpenCV.js in worker context
      (workerSelf as any).importScripts('/opencv.js');
      cv = (workerSelf as any).cv;
      // Wait for WASM to initialize if needed
      if (cv.getBuildInformation === undefined) {
        await new Promise<void>((resolve) => {
          cv.onRuntimeInitialized = resolve;
        });
      }
    }

    // Stage 2: Preprocessing
    workerSelf.postMessage({ type: 'stage', stage: 'preprocessing' });
    const src = cv.matFromImageData(imageData);
    const gray = new cv.Mat();
    const blurred = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

    // Stage 3: Edge detection
    workerSelf.postMessage({ type: 'stage', stage: 'detecting-edges' });
    const edges = new cv.Mat();
    cv.Canny(blurred, edges, 50, 150);
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    const dilated = new cv.Mat();
    cv.dilate(edges, dilated, kernel);

    // Stage 4: Find walls
    workerSelf.postMessage({ type: 'stage', stage: 'finding-walls' });
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(dilated, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const candidates: WallCandidate[] = [];
    const totalArea = width * height;

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      if (area < totalArea * 0.03) continue;

      const peri = cv.arcLength(contour, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, 0.02 * peri, true);

      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const pts: Corner[] = [];
        for (let j = 0; j < 4; j++) {
          pts.push({
            x: approx.intAt(j, 0) / width,
            y: approx.intAt(j, 1) / height,
          });
        }
        candidates.push({
          corners: sortCorners(pts),
          area: area / totalArea,
        });
      }
      approx.delete();
    }

    // Cleanup
    contours.delete();
    hierarchy.delete();
    dilated.delete();
    kernel.delete();
    edges.delete();
    blurred.delete();
    gray.delete();
    src.delete();

    // Sort by area, top 6
    candidates.sort((a, b) => b.area - a.area);

    workerSelf.postMessage({ type: 'result', candidates: candidates.slice(0, 6) });
  } catch (err) {
    workerSelf.postMessage({ type: 'error', error: String(err) });
  }
};

function sortCorners(pts: Corner[]): [Corner, Corner, Corner, Corner] {
  const sorted = [...pts].sort((a, b) => a.y - b.y);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sorted.slice(2, 4).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}
