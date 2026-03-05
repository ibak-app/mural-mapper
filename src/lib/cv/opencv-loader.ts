// Singleton loader for OpenCV.js WASM (~8MB, loaded once on first use)
// Uses official OpenCV CDN for opencv.js 4.9.0

let cvPromise: Promise<any> | null = null;

export function loadOpenCV(): Promise<any> {
  if (cvPromise) return cvPromise;

  cvPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('OpenCV.js requires a browser environment'));
      return;
    }

    // Already loaded
    if ((window as any).cv && (window as any).cv.Mat) {
      resolve((window as any).cv);
      return;
    }

    const script = document.createElement('script');
    script.src = '/opencv.js';
    script.async = true;

    script.onload = () => {
      // OpenCV.js sets window.cv but may need time to init WASM
      const checkReady = () => {
        const cv = (window as any).cv;
        if (cv && cv.Mat) {
          resolve(cv);
        } else if (cv && cv.onRuntimeInitialized !== undefined) {
          cv.onRuntimeInitialized = () => resolve(cv);
        } else {
          setTimeout(checkReady, 50);
        }
      };
      checkReady();
    };

    script.onerror = () => {
      cvPromise = null;
      reject(new Error('Failed to load OpenCV.js'));
    };

    document.head.appendChild(script);
  });

  return cvPromise;
}

export function isOpenCVLoaded(): boolean {
  return typeof window !== 'undefined' && !!(window as any).cv?.Mat;
}
