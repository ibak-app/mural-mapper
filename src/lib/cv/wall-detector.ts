import { loadOpenCV } from './opencv-loader';

export interface WallDetectionResult {
  points: Array<{ x: number; y: number }>;
  mask: Uint8Array;
  width: number;
  height: number;
}

export async function detectWallRegion(
  imageData: ImageData,
  seedX: number,
  seedY: number,
  tolerance: number = 32,
): Promise<WallDetectionResult> {
  const cv = await loadOpenCV();
  const { width, height } = imageData;

  // Create Mat from ImageData
  const src = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const dilated = new cv.Mat();

  try {
    // 1. Grayscale
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // 2. Gaussian blur for noise reduction
    const ksize = new cv.Size(5, 5);
    cv.GaussianBlur(gray, blurred, ksize, 0);

    // 3. Canny edge detection
    cv.Canny(blurred, edges, 50, 150);

    // 4. Dilate edges to close small gaps
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cv.dilate(edges, dilated, kernel);
    kernel.delete();

    // 5. Create flood fill mask (must be h+2, w+2)
    const mask = new cv.Mat.zeros(height + 2, width + 2, cv.CV_8UC1);

    // Copy dilated edges as barriers into the mask
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (dilated.ucharAt(y, x) > 0) {
          mask.ucharPtr(y + 1, x + 1)[0] = 255;
        }
      }
    }

    // 6. Flood fill from seed point
    const seedPoint = new cv.Point(seedX, seedY);
    const newVal = new cv.Scalar(255, 255, 255, 255);
    const loDiff = new cv.Scalar(tolerance, tolerance, tolerance, tolerance);
    const upDiff = new cv.Scalar(tolerance, tolerance, tolerance, tolerance);

    cv.floodFill(
      src,
      mask,
      seedPoint,
      newVal,
      new cv.Rect(),
      loDiff,
      upDiff,
      4 | cv.FLOODFILL_MASK_ONLY | (255 << 8),
    );

    // 7. Extract the filled region from mask (inner part, skip 1px border)
    const regionMask = new cv.Mat(height, width, cv.CV_8UC1);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        regionMask.ucharPtr(y, x)[0] = mask.ucharAt(y + 1, x + 1) === 255 ? 255 : 0;
      }
    }

    // 8. Morphological close to smooth boundaries
    const closeKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7));
    const closed = new cv.Mat();
    cv.morphologyEx(regionMask, closed, cv.MORPH_CLOSE, closeKernel);
    closeKernel.delete();

    // 9. Find contours
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    if (contours.size() === 0) {
      throw new Error('No contour found');
    }

    // Get largest contour
    let maxArea = 0;
    let maxIdx = 0;
    for (let i = 0; i < contours.size(); i++) {
      const area = cv.contourArea(contours.get(i));
      if (area > maxArea) {
        maxArea = area;
        maxIdx = i;
      }
    }

    // 10. Approximate polygon (Douglas-Peucker)
    const contour = contours.get(maxIdx);
    const epsilon = 0.005 * cv.arcLength(contour, true);
    const approx = new cv.Mat();
    cv.approxPolyDP(contour, approx, epsilon, true);

    // Convert to normalized points
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < approx.rows; i++) {
      points.push({
        x: approx.intAt(i, 0) / width,
        y: approx.intAt(i, 1) / height,
      });
    }

    // Extract binary mask as Uint8Array
    const maskData = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      maskData[i] = closed.data[i] > 0 ? 1 : 0;
    }

    // Cleanup
    approx.delete();
    hierarchy.delete();
    contours.delete();
    closed.delete();
    regionMask.delete();
    mask.delete();

    return { points, mask: maskData, width, height };
  } finally {
    src.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    dilated.delete();
  }
}
