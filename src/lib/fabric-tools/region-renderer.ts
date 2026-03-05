import { Rect, Polygon, Path, FabricImage, FabricObject } from 'fabric';
import type { Region, RegionGeometry, SolidColorFill, MuralImageFill, QuadGeometry, Point } from '@/lib/types';
import { warpMuralToQuad } from '@/lib/cv/perspective-warper';

interface RenderContext {
  width: number;
  height: number;
  scale: number;
}

function hexToRgba(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function getFillColor(region: Region): string {
  if (region.fill.type === 'solid-color') {
    return hexToRgba((region.fill as SolidColorFill).color, region.opacity);
  }
  return 'rgba(100,100,255,0.3)';
}

function quadToPixelPoints(corners: [Point, Point, Point, Point], w: number, h: number) {
  return corners.map((c) => ({ x: c.x * w, y: c.y * h }));
}

export function regionToFabricObject(
  region: Region,
  ctx: RenderContext,
  projectId?: string
): FabricObject {
  const { width: imageWidth, height: imageHeight, scale } = ctx;
  const w = imageWidth * scale;
  const h = imageHeight * scale;
  let obj: FabricObject;

  const geo = region.geometry;
  const fill = getFillColor(region);

  const commonProps = {
    stroke: '#3b82f6',
    strokeWidth: 2,
    strokeDashArray: [5, 5] as number[],
    selectable: !region.locked,
    visible: region.visible,
  };

  if (geo.type === 'rectangle') {
    obj = new Rect({
      left: geo.x * w,
      top: geo.y * h,
      width: geo.width * w,
      height: geo.height * h,
      fill,
      ...commonProps,
    });
  } else if (geo.type === 'quad') {
    const points = quadToPixelPoints(geo.corners, w, h);
    obj = new Polygon(points, {
      fill,
      ...commonProps,
      stroke: '#f59e0b',
    });
  } else if (geo.type === 'polygon') {
    const points = geo.points.map((p) => ({ x: p.x * w, y: p.y * h }));
    obj = new Polygon(points, {
      fill,
      ...commonProps,
    });
  } else if (geo.type === 'brush') {
    const pathData = geo.points.reduce((acc, p, i) => {
      const x = p.x * w;
      const y = p.y * h;
      return acc + (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`);
    }, '') + ' Z';
    obj = new Path(pathData, {
      fill,
      ...commonProps,
    });
  } else {
    // whole-wall
    obj = new Rect({
      left: 0,
      top: 0,
      width: w,
      height: h,
      fill,
      ...commonProps,
    });
  }

  (obj as any).regionId = region.id;
  if (region.blendMode !== 'normal') {
    obj.globalCompositeOperation = region.blendMode;
  }
  return obj;
}

/** Async mural compositing — loads mural, applies perspective warp via homography, composites onto canvas */
export async function renderMuralInQuad(
  region: Region,
  ctx: RenderContext,
  projectId: string
): Promise<FabricObject | null> {
  if (region.fill.type !== 'mural-image' || region.geometry.type !== 'quad') return null;

  const fill = region.fill as MuralImageFill;
  const geo = region.geometry as QuadGeometry;
  const { width: imageWidth, height: imageHeight, scale } = ctx;
  const w = imageWidth * scale;
  const h = imageHeight * scale;

  const points = quadToPixelPoints(geo.corners, w, h);

  try {
    const muralUrl = `/api/projects/${projectId}/murals/${fill.muralId}`;

    // Load mural as HTMLImageElement
    const muralImg = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = muralUrl;
    });

    // Prepare mural on a canvas (apply scale, offset, rotation)
    const muralCanvas = document.createElement('canvas');
    const mw = muralImg.naturalWidth;
    const mh = muralImg.naturalHeight;
    muralCanvas.width = Math.round(mw * fill.scale);
    muralCanvas.height = Math.round(mh * fill.scale);
    const mCtx = muralCanvas.getContext('2d')!;
    mCtx.save();
    mCtx.translate(muralCanvas.width / 2, muralCanvas.height / 2);
    mCtx.rotate((fill.rotation * Math.PI) / 180);
    mCtx.drawImage(muralImg, -mw * fill.scale / 2, -mh * fill.scale / 2, mw * fill.scale, mh * fill.scale);
    mCtx.restore();

    // Perspective warp the mural onto the quad
    const destQuad: [Point, Point, Point, Point] = [
      { x: points[0].x, y: points[0].y },
      { x: points[1].x, y: points[1].y },
      { x: points[2].x, y: points[2].y },
      { x: points[3].x, y: points[3].y },
    ];

    const warped = await warpMuralToQuad(muralCanvas, destQuad, w, h, region.opacity);

    // Convert warped canvas to FabricImage
    const fabricImg = new FabricImage(warped, {
      left: 0,
      top: 0,
      selectable: false,
      evented: false,
    });

    (fabricImg as any).regionId = region.id;
    if (region.blendMode !== 'normal') {
      fabricImg.globalCompositeOperation = region.blendMode;
    }

    return fabricImg;
  } catch (err) {
    console.error('[MuralRenderer] Perspective warp failed, using clip-path fallback:', err);
    // Fallback to simple clip-path approach
    return renderMuralInQuadFallback(region, ctx, projectId);
  }
}

/** Fallback: clip-path approach without perspective warping */
async function renderMuralInQuadFallback(
  region: Region,
  ctx: RenderContext,
  projectId: string
): Promise<FabricObject | null> {
  const fill = region.fill as MuralImageFill;
  const geo = region.geometry as QuadGeometry;
  const { width: imageWidth, height: imageHeight, scale } = ctx;
  const w = imageWidth * scale;
  const h = imageHeight * scale;

  const points = quadToPixelPoints(geo.corners, w, h);
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxX = Math.max(...points.map((p) => p.x));
  const maxY = Math.max(...points.map((p) => p.y));
  const bw = maxX - minX;
  const bh = maxY - minY;

  try {
    const muralUrl = `/api/projects/${projectId}/murals/${fill.muralId}`;
    const img = await FabricImage.fromURL(muralUrl, { crossOrigin: 'anonymous' });

    const iw = img.width || bw;
    const ih = img.height || bh;
    const sx = bw / iw;
    const sy = bh / ih;

    if (fill.fitMode === 'cover') {
      const s = Math.max(sx, sy) * fill.scale;
      img.scaleX = s;
      img.scaleY = s;
    } else if (fill.fitMode === 'contain') {
      const s = Math.min(sx, sy) * fill.scale;
      img.scaleX = s;
      img.scaleY = s;
    } else if (fill.fitMode === 'stretch') {
      img.scaleX = sx * fill.scale;
      img.scaleY = sy * fill.scale;
    } else {
      img.scaleX = fill.scale;
      img.scaleY = fill.scale;
    }

    img.left = minX + fill.offsetX * bw;
    img.top = minY + fill.offsetY * bh;
    img.angle = fill.rotation;
    img.opacity = region.opacity;

    const clipPoints = points.map((p) => ({ x: p.x - minX, y: p.y - minY }));
    const clipPoly = new Polygon(clipPoints, {
      left: minX,
      top: minY,
      absolutePositioned: true,
    });
    img.clipPath = clipPoly;

    (img as any).regionId = region.id;
    if (region.blendMode !== 'normal') {
      img.globalCompositeOperation = region.blendMode;
    }

    return img;
  } catch (err) {
    console.error('[MuralRenderer] Fallback also failed:', err);
    return null;
  }
}

export function fabricObjectToGeometry(
  obj: FabricObject,
  ctx: RenderContext
): RegionGeometry {
  const { width: imageWidth, height: imageHeight, scale } = ctx;
  const w = imageWidth * scale;
  const h = imageHeight * scale;

  if (obj instanceof Polygon && !(obj instanceof Rect)) {
    const points = (obj as any).points.map((p: { x: number; y: number }) => ({
      x: (p.x + (obj.left || 0)) / w,
      y: (p.y + (obj.top || 0)) / h,
    }));

    // Check if it's a quad (exactly 4 points)
    if (points.length === 4) {
      return { type: 'quad', corners: points as [Point, Point, Point, Point] };
    }

    return { type: 'polygon', points };
  }

  if (obj instanceof Path) {
    return { type: 'brush', points: [], strokeWidth: 20 };
  }

  // Rectangle or whole-wall
  const left = (obj.left || 0) / w;
  const top = (obj.top || 0) / h;
  const width = ((obj.width || 0) * (obj.scaleX || 1)) / w;
  const height = ((obj.height || 0) * (obj.scaleY || 1)) / h;

  if (left <= 0.01 && top <= 0.01 && width >= 0.98 && height >= 0.98) {
    return { type: 'whole-wall' };
  }

  return { type: 'rectangle', x: left, y: top, width, height };
}
