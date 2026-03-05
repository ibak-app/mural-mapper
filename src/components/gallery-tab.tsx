import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { ImagePlus, Crop, X, Loader2, Copy, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  generateThumbsBatch,
  getFullBitmap,
  drawFitted,
  evict,
  generateThumb,
} from '@/lib/image-cache';
import { CropDialog } from '@/components/crop-dialog';
import type { Wall } from '@/App';

interface GalleryTabProps {
  walls: Wall[];
  onWallsChange: (walls: Wall[]) => void;
  selectedIdx: number;
  onSelectIdx: (idx: number) => void;
}

/* ------------------------------------------------------------------ */
/*  Sidebar Thumb (memoised)                                           */
/* ------------------------------------------------------------------ */

interface ThumbProps {
  wall: Wall;
  index: number;
  selected: boolean;
  isDragOver: boolean;
  onSelect: (i: number) => void;
  onDragStart: (i: number) => void;
  onDragOver: (e: React.DragEvent, i: number) => void;
  onDrop: (i: number) => void;
  onDragEnd: () => void;
}

const Thumb = React.memo<ThumbProps>(function Thumb({
  wall,
  index,
  selected,
  isDragOver,
  onSelect,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}) {
  return (
    <div
      className={cn(
        'relative w-[80px] h-[60px] rounded-md overflow-hidden cursor-pointer border-2 shrink-0',
        selected ? 'border-blue-500 ring-2 ring-blue-300' : 'border-transparent',
        isDragOver && 'border-t-4 border-t-blue-500',
      )}
      draggable
      onClick={() => onSelect(index)}
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={() => onDrop(index)}
      onDragEnd={onDragEnd}
    >
      {wall.thumbUrl ? (
        <img
          src={wall.thumbUrl}
          alt={`Wall ${index + 1}`}
          className="w-full h-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gray-100">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      )}

      {/* number badge */}
      <span className="absolute bottom-0.5 left-0.5 text-[10px] font-bold bg-black/60 text-white rounded px-1 leading-tight">
        {index + 1}
      </span>

      {/* green dot if quad is defined */}
      {wall.quad && (
        <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-green-400 border border-white" />
      )}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  GalleryTab                                                         */
/* ------------------------------------------------------------------ */

export function GalleryTab({
  walls,
  onWallsChange,
  selectedIdx,
  onSelectIdx,
}: GalleryTabProps) {
  /* refs to avoid stale closures */
  const wallsRef = useRef(walls);
  wallsRef.current = walls;
  const selectedRef = useRef(selectedIdx);
  selectedRef.current = selectedIdx;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const thumbListRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [dropZoneActive, setDropZoneActive] = useState(false);

  const dragIdx = useRef<number | null>(null);

  /* ---- canvas draw ------------------------------------------------ */

  const redraw = useCallback(async () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const w = walls[selectedIdx];
    if (!w) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    setLoading(true);
    try {
      const bitmap = await getFullBitmap(w.blob);
      /* check index hasn't changed while we waited */
      if (selectedRef.current !== selectedIdx) return;

      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      drawFitted(canvas, bitmap, w.crop);
    } finally {
      setLoading(false);
    }
  }, [walls, selectedIdx]);

  /* redraw on selection or crop change */
  useLayoutEffect(() => {
    redraw();
  }, [redraw]);

  /* ResizeObserver */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [redraw]);

  /* ---- arrow key navigation --------------------------------------- */

  useEffect(() => {
    let rafId: number | null = null;
    let pending: number | null = null;

    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      let dir = 0;
      if (e.key === 'ArrowUp') dir = -1;
      if (e.key === 'ArrowDown') dir = 1;
      if (dir === 0) return;

      e.preventDefault();

      /* coalesce with rAF */
      if (pending === null) {
        pending = dir;
        rafId = requestAnimationFrame(() => {
          const cur = selectedRef.current;
          const len = wallsRef.current.length;
          if (len === 0) { pending = null; return; }
          const next = Math.max(0, Math.min(len - 1, cur + pending!));
          if (next !== cur) onSelectIdx(next);
          pending = null;
        });
      } else {
        pending += dir;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [onSelectIdx]);

  /* auto-scroll selected thumb into view */
  useEffect(() => {
    const list = thumbListRef.current;
    if (!list) return;
    const el = list.children[selectedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIdx]);

  /* ---- drag & drop reorder ---------------------------------------- */

  const handleDragStart = useCallback((i: number) => {
    dragIdx.current = i;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, i: number) => {
    e.preventDefault();
    setDragOverIdx(i);
  }, []);

  const handleDragEnd = useCallback(() => {
    dragIdx.current = null;
    setDragOverIdx(null);
  }, []);

  const handleDrop = useCallback(
    (dropIdx: number) => {
      const from = dragIdx.current;
      if (from === null || from === dropIdx) return;

      const next = [...wallsRef.current];
      const [moved] = next.splice(from, 1);
      next.splice(dropIdx, 0, moved);
      onWallsChange(next);

      /* keep selection on the same wall */
      if (selectedRef.current === from) {
        onSelectIdx(dropIdx);
      } else if (from < selectedRef.current && dropIdx >= selectedRef.current) {
        onSelectIdx(selectedRef.current - 1);
      } else if (from > selectedRef.current && dropIdx <= selectedRef.current) {
        onSelectIdx(selectedRef.current + 1);
      }

      dragIdx.current = null;
      setDragOverIdx(null);
    },
    [onWallsChange, onSelectIdx],
  );

  /* ---- add images (shared logic) ---------------------------------- */

  const addFiles = useCallback(
    (fileArr: File[]) => {
      if (fileArr.length === 0) return;

      const startIdx = wallsRef.current.length;

      const newWalls: Wall[] = fileArr.map((f) => ({
        id: crypto.randomUUID(),
        file: f,
        thumbUrl: '',
        blob: f,
        murals: [],
      }));

      const merged = [...wallsRef.current, ...newWalls];
      onWallsChange(merged);
      onSelectIdx(startIdx);

      const thumbUrls = new Map<number, string>();
      generateThumbsBatch(fileArr, (i, url) => {
        thumbUrls.set(startIdx + i, url);
        const cur = [...wallsRef.current];
        for (const [idx, thumbUrl] of thumbUrls) {
          if (idx < cur.length) {
            cur[idx] = { ...cur[idx], thumbUrl };
          }
        }
        onWallsChange(cur);
      });
    },
    [onWallsChange, onSelectIdx],
  );

  const handleAddFiles = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      addFiles(Array.from(files));
      e.target.value = '';
    },
    [addFiles],
  );

  /* ---- drag & drop files onto canvas ------------------------------ */

  const handleFileDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDropZoneActive(false);
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      if (files.length > 0) addFiles(files);
    },
    [addFiles],
  );

  const handleFileDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
      setDropZoneActive(true);
    }
  }, []);

  const handleFileDragLeave = useCallback((e: React.DragEvent) => {
    // Only deactivate when leaving the container (not child elements)
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDropZoneActive(false);
  }, []);

  /* ---- crop ------------------------------------------------------- */

  const openCrop = useCallback(() => {
    const w = wallsRef.current[selectedRef.current];
    if (!w) return;
    const url = URL.createObjectURL(w.file);
    setCropSrc(url);
  }, []);

  const handleCropDone = useCallback(
    async (blob: Blob) => {
      const idx = selectedRef.current;
      const cur = [...wallsRef.current];
      const w = cur[idx];
      if (!w) return;

      const thumbUrl = await generateThumb(blob);
      cur[idx] = {
        ...w,
        blob,
        thumbUrl,
        crop: undefined,
        quad: undefined,
      };
      onWallsChange(cur);

      if (cropSrc) URL.revokeObjectURL(cropSrc);
      setCropSrc(null);
    },
    [onWallsChange, cropSrc],
  );

  const handleCropCancel = useCallback(() => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  }, [cropSrc]);

  /* ---- reset crop ------------------------------------------------- */

  const handleResetCrop = useCallback(() => {
    const idx = selectedRef.current;
    const cur = [...wallsRef.current];
    const w = cur[idx];
    if (!w) return;
    // Reset blob back to original file, clear crop and quad
    cur[idx] = { ...w, blob: w.file, crop: undefined, quad: undefined };
    // Regenerate thumb from original file
    generateThumb(w.file).then(thumbUrl => {
      const updated = [...wallsRef.current];
      if (updated[idx]) {
        updated[idx] = { ...updated[idx], thumbUrl };
        onWallsChange(updated);
      }
    });
    onWallsChange(cur);
  }, [onWallsChange]);

  /* ---- duplicate -------------------------------------------------- */

  const handleDuplicate = useCallback(() => {
    const idx = selectedRef.current;
    const w = wallsRef.current[idx];
    if (!w) return;
    const dup: Wall = {
      ...w,
      id: crypto.randomUUID(),
      murals: [],
    };
    const cur = [...wallsRef.current];
    cur.splice(idx + 1, 0, dup);
    onWallsChange(cur);
    onSelectIdx(idx + 1);
  }, [onWallsChange, onSelectIdx]);

  /* ---- remove ----------------------------------------------------- */

  const handleRemove = useCallback(() => {
    const idx = selectedRef.current;
    const cur = [...wallsRef.current];
    const w = cur[idx];
    if (!w) return;

    evict(w.blob);
    cur.splice(idx, 1);
    onWallsChange(cur);

    if (cur.length === 0) {
      onSelectIdx(0);
    } else {
      onSelectIdx(Math.min(idx, cur.length - 1));
    }
  }, [onWallsChange, onSelectIdx]);

  /* ---- render ----------------------------------------------------- */

  const selectedWall = walls[selectedIdx];

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 min-h-0">
        {/* ---- Sidebar ---- */}
        <div className="w-[100px] border-r bg-gray-50 flex flex-col">
          <div
            ref={thumbListRef}
            className="flex-1 overflow-y-auto p-2 space-y-2 flex flex-col items-center"
          >
            {walls.map((w, i) => (
              <Thumb
                key={w.id}
                wall={w}
                index={i}
                selected={i === selectedIdx}
                isDragOver={dragOverIdx === i}
                onSelect={onSelectIdx}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
              />
            ))}
          </div>

          {/* add button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="h-10 flex items-center justify-center gap-1 text-sm text-gray-500 hover:text-blue-600 hover:bg-blue-50 border-t transition-colors"
          >
            <ImagePlus className="w-4 h-4" />
            <span>Add</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={handleAddFiles}
          />
        </div>

        {/* ---- Main canvas area (drop zone) ---- */}
        <div
          ref={containerRef}
          className="flex-1 relative bg-gray-900"
          onDrop={handleFileDrop}
          onDragOver={handleFileDragOver}
          onDragLeave={handleFileDragLeave}
        >
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-white/70" />
            </div>
          )}

          {/* Drop zone overlay */}
          {dropZoneActive && (
            <div className="absolute inset-0 flex items-center justify-center bg-blue-600/20 border-2 border-dashed border-blue-400 rounded-lg z-10 pointer-events-none">
              <div className="bg-blue-600/80 text-white text-sm font-medium px-6 py-3 rounded-full">
                Drop images here
              </div>
            </div>
          )}

          {walls.length === 0 && !dropZoneActive && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 gap-3">
              <ImagePlus className="w-12 h-12" />
              <p className="text-sm">Add wall images to get started</p>
              <p className="text-xs text-gray-500">Drop images here or click below</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 transition-colors"
              >
                Browse Images
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ---- Bottom bar ---- */}
      <div className="h-12 bg-white border-t flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-4 text-sm text-gray-600">
          {walls.length > 0 && (
            <>
              <span className="font-medium">
                Wall {selectedIdx + 1} / {walls.length}
              </span>
              <span className="text-gray-400">&#8593;&#8595; navigate</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          {selectedWall && (
            <>
              <button
                onClick={openCrop}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md hover:bg-gray-100 transition-colors text-gray-700"
              >
                <Crop className="w-4 h-4" />
                Crop
              </button>
              {selectedWall.blob !== selectedWall.file && (
                <button
                  onClick={handleResetCrop}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md hover:bg-gray-100 transition-colors text-gray-700"
                  title="Reset to original image"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </button>
              )}
              <button
                onClick={handleDuplicate}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md hover:bg-gray-100 transition-colors text-gray-700"
              >
                <Copy className="w-4 h-4" />
                Duplicate
              </button>
              <button
                onClick={handleRemove}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md hover:bg-red-50 hover:text-red-600 transition-colors text-gray-700"
              >
                <X className="w-4 h-4" />
                Remove
              </button>
            </>
          )}
          <span className="text-xs text-gray-400 ml-2">
            {walls.length} wall{walls.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* ---- Crop dialog ---- */}
      {cropSrc && (
        <CropDialog
          imageSrc={cropSrc}
          onCrop={handleCropDone}
          onCancel={handleCropCancel}
        />
      )}
    </div>
  );
}
