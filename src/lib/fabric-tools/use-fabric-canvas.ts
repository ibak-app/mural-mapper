

import { useEffect, useRef, useCallback } from 'react';
import { Canvas, FabricImage, Point } from 'fabric';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;

interface UseFabricCanvasOptions {
  imageUrl: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function useFabricCanvas({ imageUrl, containerRef }: UseFabricCanvasOptions) {
  const canvasRef = useRef<Canvas | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const isPanningRef = useRef(false);
  const lastPanPointRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current || !canvasElRef.current) return;

    const container = containerRef.current;
    const canvas = new Canvas(canvasElRef.current, {
      width: container.clientWidth,
      height: container.clientHeight,
      backgroundColor: '#f3f4f6',
      selection: false,
    });
    canvasRef.current = canvas;

    // Load background image
    FabricImage.fromURL(imageUrl, { crossOrigin: 'anonymous' }).then((img) => {
      const containerW = container.clientWidth;
      const containerH = container.clientHeight;
      const scale = Math.min(containerW / (img.width || 1), containerH / (img.height || 1));
      img.set({
        scaleX: scale,
        scaleY: scale,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
      });
      canvas.backgroundImage = img;
      canvas.renderAll();
    });

    // Handle resize
    const handleResize = () => {
      canvas.setDimensions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
      canvas.renderAll();
    };
    const observer = new ResizeObserver(handleResize);
    observer.observe(container);

    return () => {
      observer.disconnect();
      canvas.dispose();
      canvasRef.current = null;
    };
  }, [imageUrl, containerRef]);

  // Wheel zoom (+ pinch-to-zoom via ctrlKey)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const upperCanvas = canvas.getSelectionElement();
    if (!upperCanvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const delta = e.deltaY;
      let zoomFactor = 0.999 ** delta;

      // Pinch-to-zoom on trackpad sends ctrlKey + small deltas
      if (e.ctrlKey) {
        zoomFactor = 0.99 ** delta;
      }

      let newZoom = canvas.getZoom() * zoomFactor;
      newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));

      const point = new Point(e.offsetX, e.offsetY);
      canvas.zoomToPoint(point, newZoom);
      canvas.requestRenderAll();
    };

    upperCanvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      upperCanvas.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Middle-click pan
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseDown = (opt: any) => {
      const e = opt.e as MouseEvent;
      // Middle button (button === 1)
      if (e.button === 1) {
        isPanningRef.current = true;
        lastPanPointRef.current = { x: e.clientX, y: e.clientY };
        canvas.defaultCursor = 'grabbing';
        e.preventDefault();
      }
    };

    const handleMouseMove = (opt: any) => {
      if (!isPanningRef.current || !lastPanPointRef.current) return;
      const e = opt.e as MouseEvent;
      const vpt = canvas.viewportTransform!;
      vpt[4] += e.clientX - lastPanPointRef.current.x;
      vpt[5] += e.clientY - lastPanPointRef.current.y;
      lastPanPointRef.current = { x: e.clientX, y: e.clientY };
      canvas.requestRenderAll();
    };

    const handleMouseUp = () => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        lastPanPointRef.current = null;
        canvas.defaultCursor = 'default';
      }
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:up', handleMouseUp);
    };
  }, []);

  const getCanvas = useCallback(() => canvasRef.current, []);

  const getImageDimensions = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.backgroundImage) return { width: 1, height: 1, scale: 1 };
    const bg = canvas.backgroundImage as FabricImage;
    return {
      width: bg.width || 1,
      height: bg.height || 1,
      scale: bg.scaleX || 1,
    };
  }, []);

  const zoomIn = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const center = canvas.getCenterPoint();
    let newZoom = Math.min(MAX_ZOOM, canvas.getZoom() * 1.2);
    canvas.zoomToPoint(new Point(center.x, center.y), newZoom);
    canvas.requestRenderAll();
  }, []);

  const zoomOut = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const center = canvas.getCenterPoint();
    let newZoom = Math.max(MIN_ZOOM, canvas.getZoom() / 1.2);
    canvas.zoomToPoint(new Point(center.x, center.y), newZoom);
    canvas.requestRenderAll();
  }, []);

  const resetZoom = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    canvas.requestRenderAll();
  }, []);

  const getZoom = useCallback(() => {
    return canvasRef.current?.getZoom() ?? 1;
  }, []);

  return { canvasElRef, getCanvas, getImageDimensions, zoomIn, zoomOut, resetZoom, getZoom };
}
