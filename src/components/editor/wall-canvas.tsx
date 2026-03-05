

import { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Canvas, Rect, Polygon, PencilBrush, FabricObject } from 'fabric';
import { useFabricCanvas } from '@/lib/fabric-tools/use-fabric-canvas';
import { regionToFabricObject, renderMuralInQuad, fabricObjectToGeometry } from '@/lib/fabric-tools/region-renderer';
import {
  floodFill,
  combineMasks,
  maskToPoints,
  getWallImageData,
  detectRegionCV,
} from '@/lib/fabric-tools/magic-wand';
import { useEditorStore } from '@/stores/editor-store';
import { generateId } from '@/lib/ids';
import type { Region, RegionFill, Point } from '@/lib/types';

export interface WallCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  getZoom: () => number;
}

interface WallCanvasProps {
  imageUrl: string;
  regions: Region[];
  onRegionsChange: (regions: Region[]) => void;
  projectId: string;
}

export const WallCanvas = forwardRef<WallCanvasHandle, WallCanvasProps>(function WallCanvas(
  { imageUrl, regions, onRegionsChange, projectId },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { canvasElRef, getCanvas, getImageDimensions, zoomIn, zoomOut, resetZoom, getZoom } =
    useFabricCanvas({
      imageUrl,
      containerRef,
    });

  useImperativeHandle(ref, () => ({ zoomIn, zoomOut, resetZoom, getZoom }), [
    zoomIn,
    zoomOut,
    resetZoom,
    getZoom,
  ]);
  const { activeTool, selectedRegionId, selectRegion, brushSize, tolerance } = useEditorStore();
  const [polygonPoints, setPolygonPoints] = useState<{ x: number; y: number }[]>([]);
  const drawingRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const imageDataCacheRef = useRef<{ url: string; data: ImageData } | null>(null);
  const wandSeedRef = useRef<{ x: number; y: number } | null>(null);
  const wandRegionIdRef = useRef<string | null>(null);
  const wandMaskRef = useRef<Uint8Array | null>(null);

  // Track modifier keys for cursor hints
  const [modifierKey, setModifierKey] = useState<'shift' | 'alt' | null>(null);

  // Keep refs for latest regions/callback so tolerance effect avoids stale closures
  const regionsRef = useRef(regions);
  regionsRef.current = regions;
  const onRegionsChangeRef = useRef(onRegionsChange);
  onRegionsChangeRef.current = onRegionsChange;

  // Track modifier keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.shiftKey) setModifierKey('shift');
      else if (e.altKey) setModifierKey('alt');
    };
    const handleKeyUp = () => setModifierKey(null);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Pan tool: mousedown/mousemove/mouseup for pan dragging
  const panActiveRef = useRef(false);
  const panLastRef = useRef<{ x: number; y: number } | null>(null);

  // Sync regions to canvas (including async mural rendering)
  useEffect(() => {
    const canvas = getCanvas();
    if (!canvas) return;

    const dims = getImageDimensions();
    canvas.getObjects().forEach((obj) => canvas.remove(obj));

    const visibleRegions = regions
      .filter((r) => r.visible)
      .sort((a, b) => a.order - b.order);

    // Add sync objects first
    const asyncJobs: Promise<void>[] = [];
    for (const region of visibleRegions) {
      // For mural fills on quads, render asynchronously
      if (region.fill.type === 'mural-image' && region.geometry.type === 'quad' && projectId) {
        asyncJobs.push(
          renderMuralInQuad(region, dims, projectId).then((muralObj) => {
            if (muralObj) {
              canvas.add(muralObj);
              canvas.renderAll();
            }
          })
        );
        // Also add the quad outline on top
      }

      // Always add the standard region object (outline/fill)
      const obj = regionToFabricObject(region, dims, projectId);
      canvas.add(obj);
      if (region.id === selectedRegionId) {
        canvas.setActiveObject(obj);
      }
    }

    canvas.renderAll();

    // Fire async mural renders
    if (asyncJobs.length > 0) {
      Promise.all(asyncJobs).catch(console.error);
    }
  }, [regions, selectedRegionId, getCanvas, getImageDimensions, projectId]);

  // Handle tool changes — cursor, drawing mode, interactivity
  useEffect(() => {
    const canvas = getCanvas();
    if (!canvas) return;

    canvas.isDrawingMode = activeTool === 'brush';
    canvas.selection = activeTool === 'select';

    // Set cursor based on tool + modifier
    if (activeTool === 'magic-wand') {
      if (modifierKey === 'shift') {
        canvas.defaultCursor = 'cell';
        canvas.hoverCursor = 'cell';
      } else if (modifierKey === 'alt') {
        canvas.defaultCursor = 'not-allowed';
        canvas.hoverCursor = 'not-allowed';
      } else {
        canvas.defaultCursor = 'crosshair';
        canvas.hoverCursor = 'crosshair';
      }
    } else if (activeTool === 'pan') {
      canvas.defaultCursor = 'grab';
      canvas.hoverCursor = 'grab';
    } else if (activeTool === 'select') {
      canvas.defaultCursor = 'default';
      canvas.hoverCursor = 'move';
    } else {
      canvas.defaultCursor = 'crosshair';
      canvas.hoverCursor = 'crosshair';
    }

    if (activeTool === 'brush') {
      const brush = new PencilBrush(canvas);
      brush.width = brushSize;
      brush.color = 'rgba(59, 130, 246, 0.5)';
      canvas.freeDrawingBrush = brush;
    }

    // Disable object interactivity for drawing tools
    const interactive = activeTool === 'select';
    canvas.getObjects().forEach((obj) => {
      obj.selectable = interactive;
      obj.evented = interactive;
    });

    // Reset polygon drawing when tool changes
    if (activeTool !== 'polygon') {
      setPolygonPoints([]);
    }
  }, [activeTool, brushSize, modifierKey, getCanvas]);

  // Mouse handlers
  useEffect(() => {
    const canvas = getCanvas();
    if (!canvas) return;

    const handleMouseDown = (opt: any) => {
      const e = opt.e as MouseEvent;

      // Pan tool drag
      if (activeTool === 'pan') {
        panActiveRef.current = true;
        panLastRef.current = { x: e.clientX, y: e.clientY };
        canvas.defaultCursor = 'grabbing';
        return;
      }

      if (activeTool === 'select') {
        const target = opt.target;
        if (target && (target as any).regionId) {
          selectRegion((target as any).regionId);
        } else {
          selectRegion(null);
        }
        return;
      }

      if (activeTool === 'rectangle' || activeTool === 'quad') {
        const pointer = canvas.getScenePoint(opt.e);
        drawingRef.current = true;
        startRef.current = { x: pointer.x, y: pointer.y };
      }

      if (activeTool === 'polygon') {
        const pointer = canvas.getScenePoint(opt.e);
        setPolygonPoints((prev) => [...prev, { x: pointer.x, y: pointer.y }]);
      }

      if (activeTool === 'whole-wall') {
        const region: Region = {
          id: generateId(),
          name: `Region ${regions.length + 1}`,
          geometry: { type: 'whole-wall' },
          fill: { type: 'solid-color', color: '#3b82f6' },
          opacity: 0.7,
          blendMode: 'multiply',
          visible: true,
          locked: false,
          order: regions.length,
        };
        onRegionsChange([...regions, region]);
      }

      if (activeTool === 'magic-wand') {
        const pointer = canvas.getScenePoint(opt.e);
        const dims = getImageDimensions();
        const w = dims.width * dims.scale;
        const h = dims.height * dims.scale;

        if (pointer.x < 0 || pointer.x >= w || pointer.y < 0 || pointer.y >= h) return;

        const seedX = pointer.x;
        const seedY = pointer.y;
        const isAdd = e.shiftKey;
        const isSubtract = e.altKey;

        const loadAndDetect = async () => {
          try {
            let imgData: ImageData;
            if (imageDataCacheRef.current && imageDataCacheRef.current.url === imageUrl) {
              imgData = imageDataCacheRef.current.data;
            } else {
              imgData = await getWallImageData(imageUrl, dims.width, dims.height, dims.scale);
              imageDataCacheRef.current = { url: imageUrl, data: imgData };
            }

            // Try OpenCV detection first, fall back to floodFill
            let points: { x: number; y: number }[] | null = null;
            let finalMask: Uint8Array | null = null;
            const currentRegions = regionsRef.current;

            if (!(isAdd || isSubtract)) {
              // For fresh detection, try OpenCV
              points = await detectRegionCV(imgData, seedX, seedY, tolerance);
            }

            if (!points) {
              // Fall back to flood fill approach
              const newMask = floodFill(imgData, seedX, seedY, tolerance);

              if ((isAdd || isSubtract) && wandMaskRef.current && wandRegionIdRef.current) {
                finalMask = combineMasks(
                  wandMaskRef.current,
                  newMask,
                  isAdd ? 'add' : 'subtract'
                );
              } else {
                finalMask = newMask;
              }

              points = maskToPoints(finalMask, imgData.width, imgData.height);
            }

            const prevWandId = wandRegionIdRef.current;
            const baseRegions =
              prevWandId && !(isAdd || isSubtract)
                ? currentRegions.filter((r) => r.id !== prevWandId)
                : isAdd || isSubtract
                  ? currentRegions.filter((r) => r.id !== prevWandId)
                  : currentRegions;

            if (!points) {
              if (isSubtract && prevWandId) {
                onRegionsChangeRef.current(currentRegions.filter((r) => r.id !== prevWandId));
                wandMaskRef.current = null;
                wandSeedRef.current = null;
                wandRegionIdRef.current = null;
                selectRegion(null);
              }
              return;
            }

            const regionId = generateId();
            const region: Region = {
              id: regionId,
              name:
                prevWandId && (isAdd || isSubtract)
                  ? currentRegions.find((r) => r.id === prevWandId)?.name ||
                    `Region ${baseRegions.length + 1}`
                  : `Region ${baseRegions.length + 1}`,
              geometry: { type: 'polygon', points },
              fill: { type: 'solid-color', color: '#3b82f6' },
              opacity: 0.7,
              blendMode: 'multiply',
              visible: true,
              locked: false,
              order: baseRegions.length,
            };
            onRegionsChangeRef.current([...baseRegions, region]);
            selectRegion(regionId);

            wandMaskRef.current = finalMask;
            wandSeedRef.current = { x: seedX, y: seedY };
            wandRegionIdRef.current = regionId;
          } catch (err) {
            console.error('[MagicWand] detection failed:', err);
          }
        };

        loadAndDetect();
      }
    };

    const handleMouseMove = (opt: any) => {
      if (activeTool === 'pan' && panActiveRef.current && panLastRef.current) {
        const e = opt.e as MouseEvent;
        const vpt = canvas.viewportTransform!;
        vpt[4] += e.clientX - panLastRef.current.x;
        vpt[5] += e.clientY - panLastRef.current.y;
        panLastRef.current = { x: e.clientX, y: e.clientY };
        canvas.requestRenderAll();
        return;
      }
    };

    const handleMouseUp = (opt: any) => {
      // Pan tool release
      if (activeTool === 'pan' && panActiveRef.current) {
        panActiveRef.current = false;
        panLastRef.current = null;
        canvas.defaultCursor = 'grab';
        return;
      }

      if (activeTool === 'rectangle' && drawingRef.current && startRef.current) {
        const pointer = canvas.getScenePoint(opt.e);
        const dims = getImageDimensions();
        const w = dims.width * dims.scale;
        const h = dims.height * dims.scale;

        const x1 = Math.min(startRef.current.x, pointer.x);
        const y1 = Math.min(startRef.current.y, pointer.y);
        const x2 = Math.max(startRef.current.x, pointer.x);
        const y2 = Math.max(startRef.current.y, pointer.y);

        if (x2 - x1 > 5 && y2 - y1 > 5) {
          const region: Region = {
            id: generateId(),
            name: `Region ${regions.length + 1}`,
            geometry: {
              type: 'rectangle',
              x: x1 / w,
              y: y1 / h,
              width: (x2 - x1) / w,
              height: (y2 - y1) / h,
            },
            fill: { type: 'solid-color', color: '#3b82f6' },
            opacity: 0.7,
            blendMode: 'multiply',
            visible: true,
            locked: false,
            order: regions.length,
          };
          onRegionsChange([...regions, region]);
        }
        drawingRef.current = false;
        startRef.current = null;
      }

      // Quad tool — draws a rectangle that becomes a quad with 4 corners
      if (activeTool === 'quad' && drawingRef.current && startRef.current) {
        const pointer = canvas.getScenePoint(opt.e);
        const dims = getImageDimensions();
        const w = dims.width * dims.scale;
        const h = dims.height * dims.scale;

        const x1 = Math.min(startRef.current.x, pointer.x);
        const y1 = Math.min(startRef.current.y, pointer.y);
        const x2 = Math.max(startRef.current.x, pointer.x);
        const y2 = Math.max(startRef.current.y, pointer.y);

        if (x2 - x1 > 5 && y2 - y1 > 5) {
          const region: Region = {
            id: generateId(),
            name: `Quad ${regions.length + 1}`,
            geometry: {
              type: 'quad',
              corners: [
                { x: x1 / w, y: y1 / h }, // TL
                { x: x2 / w, y: y1 / h }, // TR
                { x: x2 / w, y: y2 / h }, // BR
                { x: x1 / w, y: y2 / h }, // BL
              ],
            },
            fill: { type: 'mural-image', muralId: '', fitMode: 'cover', offsetX: 0, offsetY: 0, scale: 1, rotation: 0 },
            opacity: 1,
            blendMode: 'normal',
            visible: true,
            locked: false,
            order: regions.length,
          };
          onRegionsChange([...regions, region]);
          selectRegion(region.id);
        }
        drawingRef.current = false;
        startRef.current = null;
      }
    };

    const handleDblClick = () => {
      if (activeTool === 'polygon' && polygonPoints.length >= 3) {
        const dims = getImageDimensions();
        const w = dims.width * dims.scale;
        const h = dims.height * dims.scale;

        const region: Region = {
          id: generateId(),
          name: `Region ${regions.length + 1}`,
          geometry: {
            type: 'polygon',
            points: polygonPoints.map((p) => ({ x: p.x / w, y: p.y / h })),
          },
          fill: { type: 'solid-color', color: '#3b82f6' },
          opacity: 0.7,
          blendMode: 'multiply',
          visible: true,
          locked: false,
          order: regions.length,
        };
        onRegionsChange([...regions, region]);
        setPolygonPoints([]);
      }
    };

    const handlePathCreated = (opt: any) => {
      if (activeTool === 'brush' && opt.path) {
        const dims = getImageDimensions();
        const w = dims.width * dims.scale;
        const h = dims.height * dims.scale;
        const path = opt.path;
        const points: { x: number; y: number }[] = [];

        if (path.path) {
          for (const cmd of path.path) {
            if (cmd.length >= 3) {
              points.push({ x: cmd[1] / w, y: cmd[2] / h });
            }
          }
        }

        canvas.remove(path);

        if (points.length >= 2) {
          const region: Region = {
            id: generateId(),
            name: `Region ${regions.length + 1}`,
            geometry: { type: 'brush', points, strokeWidth: brushSize },
            fill: { type: 'solid-color', color: '#3b82f6' },
            opacity: 0.7,
            blendMode: 'multiply',
            visible: true,
            locked: false,
            order: regions.length,
          };
          onRegionsChange([...regions, region]);
        }
      }
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:move', handleMouseMove);
    canvas.on('mouse:up', handleMouseUp);
    canvas.on('mouse:dblclick', handleDblClick);
    canvas.on('path:created', handlePathCreated);

    return () => {
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:move', handleMouseMove);
      canvas.off('mouse:up', handleMouseUp);
      canvas.off('mouse:dblclick', handleDblClick);
      canvas.off('path:created', handlePathCreated);
    };
  }, [activeTool, regions, polygonPoints, brushSize, tolerance, imageUrl, getCanvas, getImageDimensions, onRegionsChange, selectRegion]);

  // Re-detect when tolerance changes (magic wand refinement)
  useEffect(() => {
    if (activeTool !== 'magic-wand' || !wandSeedRef.current || !wandRegionIdRef.current) return;
    if (!imageDataCacheRef.current) return;

    const timer = setTimeout(() => {
      const imgData = imageDataCacheRef.current!.data;
      const seed = wandSeedRef.current!;
      const regionId = wandRegionIdRef.current!;

      const newMask = floodFill(imgData, seed.x, seed.y, tolerance);
      const points = maskToPoints(newMask, imgData.width, imgData.height);
      if (!points) return;

      wandMaskRef.current = newMask;

      const currentRegions = regionsRef.current;
      const updated = currentRegions.map((r) =>
        r.id === regionId ? { ...r, geometry: { type: 'polygon' as const, points } } : r
      );
      onRegionsChangeRef.current(updated);
    }, 150);

    return () => clearTimeout(timer);
  }, [tolerance, activeTool]);

  // Clear wand state when switching away from magic-wand
  useEffect(() => {
    if (activeTool !== 'magic-wand') {
      wandSeedRef.current = null;
      wandRegionIdRef.current = null;
      wandMaskRef.current = null;
    }
  }, [activeTool]);

  return (
    <div ref={containerRef} className="flex-1 relative overflow-hidden bg-gray-100">
      <canvas ref={canvasElRef} />
    </div>
  );
});
