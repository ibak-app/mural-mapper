import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ImagePlus, Crop, X, Loader2, Copy, RotateCcw, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  generateThumbsBatch,
  getFullBitmap,
  drawFitted,
  evict,
  generateThumb,
} from '@/lib/image-cache';
import { CropDialog } from '@/components/crop-dialog';
import type { Wall, MuralPoolEntry } from '@/App';

interface GalleryTabProps {
  walls: Wall[];
  onWallsChange: (walls: Wall[], changedIdx?: number) => void;
  selectedIdx: number;
  onSelectIdx: (idx: number) => void;
  muralPool: MuralPoolEntry[];
  onMuralPoolChange: (pool: MuralPoolEntry[]) => void;
}

/* ------------------------------------------------------------------ */
/*  Sidebar Thumb (memoised)                                           */
/* ------------------------------------------------------------------ */

interface ThumbProps {
  wall: Wall;
  index: number;
  selected: boolean;
  isDragOver: boolean;
  linkColor?: string;
  onSelect: (i: number) => void;
  onPointerDown: (i: number, e: React.PointerEvent) => void;
}

const Thumb = React.memo<ThumbProps>(function Thumb({
  wall,
  index,
  selected,
  isDragOver,
  linkColor,
  onSelect,
  onPointerDown,
}) {
  return (
    <div
      className={cn(
        'relative w-[80px] h-[60px] rounded-md overflow-hidden cursor-pointer border-2 shrink-0 select-none',
        selected ? 'border-blue-500 ring-2 ring-blue-300' : 'border-transparent',
        isDragOver && 'border-t-4 border-t-blue-500',
      )}
      onClick={() => onSelect(index)}
      onPointerDown={(e) => onPointerDown(index, e)}
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
      {wall.quads.length > 0 && (
        <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-green-400 border border-white" />
      )}

      {/* link group indicator */}
      {linkColor && (
        <span
          className="absolute top-1 left-1 w-2.5 h-2.5 rounded-full border border-white"
          style={{ backgroundColor: linkColor }}
          title="Linked wall"
        />
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
  muralPool,
  onMuralPoolChange,
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
  const muralFileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [dropZoneActive, setDropZoneActive] = useState(false);
  const [previewMuralIdx, setPreviewMuralIdx] = useState<number | null>(null);
  const [muralDragOverIdx, setMuralDragOverIdx] = useState<number | null>(null);

  const dragIdx = useRef<number | null>(null);
  const muralDragIdx = useRef<number | null>(null);
  const muralPoolRef = useRef(muralPool);
  muralPoolRef.current = muralPool;
  const previewMuralIdxRef = useRef(previewMuralIdx);
  previewMuralIdxRef.current = previewMuralIdx;
  const muralThumbListRef = useRef<HTMLDivElement>(null);

  /* ---- link group colors ---- */
  const LINK_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
  const linkColorMap = useMemo(() => {
    const map = new Map<string, string>();
    let colorIdx = 0;
    for (const w of walls) {
      for (const q of w.quads) {
        if (q.linkId && !map.has(q.linkId)) {
          map.set(q.linkId, LINK_COLORS[colorIdx % LINK_COLORS.length]);
          colorIdx++;
        }
      }
    }
    return map;
  }, [walls]);

  /* ---- canvas draw ------------------------------------------------ */

  const redraw = useCallback(async () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    /* Mural preview mode */
    if (previewMuralIdx !== null) {
      const entry = muralPool[previewMuralIdx];
      if (!entry) return;
      setLoading(true);
      try {
        const bitmap = await getFullBitmap(entry.blob);
        if (previewMuralIdxRef.current !== previewMuralIdx) return;
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        drawFitted(canvas, bitmap);
      } finally {
        setLoading(false);
      }
      return;
    }

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
  }, [walls, selectedIdx, previewMuralIdx, muralPool]);

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

      /* Escape clears mural preview */
      if (e.key === 'Escape' && previewMuralIdxRef.current !== null) {
        e.preventDefault();
        setPreviewMuralIdx(null);
        return;
      }

      let dir = 0;
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') dir = -1;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') dir = 1;
      if (dir === 0) return;
      e.preventDefault();

      if (previewMuralIdxRef.current !== null) {
        // Navigate murals
        const mLen = muralPoolRef.current.length;
        if (mLen === 0) return;
        const mCur = previewMuralIdxRef.current;
        const mNext = Math.max(0, Math.min(mLen - 1, mCur + dir));
        if (mNext !== mCur) setPreviewMuralIdx(mNext);
      } else {
        // Navigate walls
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

  /* auto-scroll selected mural thumb into view */
  useEffect(() => {
    if (previewMuralIdx === null) return;
    const list = muralThumbListRef.current;
    if (!list) return;
    const el = list.children[previewMuralIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [previewMuralIdx]);

  /* ---- pointer-based drag reorder ---------------------------------- */

  const pointerStartY = useRef<number>(0);
  const pointerDragging = useRef(false);
  const dragOverIdxRef = useRef<number | null>(null);

  const handleThumbPointerDown = useCallback((i: number, e: React.PointerEvent) => {
    dragIdx.current = i;
    pointerStartY.current = e.clientY;
    pointerDragging.current = false;
    dragOverIdxRef.current = null;

    const onMove = (ev: PointerEvent) => {
      if (!pointerDragging.current && Math.abs(ev.clientY - pointerStartY.current) > 5) {
        pointerDragging.current = true;
      }
      if (!pointerDragging.current) return;
      // Find which thumb the pointer is over
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!el) return;
      const thumbEl = el.closest('[data-wall-idx]') as HTMLElement | null;
      if (thumbEl) {
        const idx = parseInt(thumbEl.dataset.wallIdx!, 10);
        if (!isNaN(idx)) {
          dragOverIdxRef.current = idx;
          setDragOverIdx(idx);
        }
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const from = dragIdx.current;
      const to = dragOverIdxRef.current;
      if (pointerDragging.current && from !== null && to !== null && from !== to) {
        const next = [...wallsRef.current];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        onWallsChange(next);

        if (selectedRef.current === from) {
          onSelectIdx(to);
        } else if (from < selectedRef.current && to >= selectedRef.current) {
          onSelectIdx(selectedRef.current - 1);
        } else if (from > selectedRef.current && to <= selectedRef.current) {
          onSelectIdx(selectedRef.current + 1);
        }
      }
      dragIdx.current = null;
      dragOverIdxRef.current = null;
      setDragOverIdx(null);
      pointerDragging.current = false;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [onWallsChange, onSelectIdx]);

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
        quads: [],
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
        quads: [],
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
    // Reset blob back to original file, clear crop and quads
    cur[idx] = { ...w, blob: w.file, crop: undefined, quads: [] };
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
      quads: [],
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

  /* ---- wall select (clears mural preview) ------------------------- */

  const handleWallSelect = useCallback((i: number) => {
    setPreviewMuralIdx(null);
    onSelectIdx(i);
  }, [onSelectIdx]);

  /* ---- mural drag-to-reorder -------------------------------------- */

  const muralDragOverIdxRef = useRef<number | null>(null);

  const handleMuralPointerDown = useCallback((i: number, e: React.PointerEvent) => {
    muralDragIdx.current = i;
    const startY = e.clientY;
    let dragging = false;
    muralDragOverIdxRef.current = null;

    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientY - startY) > 5) dragging = true;
      if (!dragging) return;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!el) return;
      const thumbEl = el.closest('[data-mural-idx]') as HTMLElement | null;
      if (thumbEl) {
        const idx = parseInt(thumbEl.dataset.muralIdx!, 10);
        if (!isNaN(idx)) {
          muralDragOverIdxRef.current = idx;
          setMuralDragOverIdx(idx);
        }
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const from = muralDragIdx.current;
      const to = muralDragOverIdxRef.current;
      if (dragging && from !== null && to !== null && from !== to) {
        const next = [...muralPoolRef.current];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        onMuralPoolChange(next);

        if (previewMuralIdxRef.current !== null) {
          if (previewMuralIdxRef.current === from) {
            setPreviewMuralIdx(to);
          } else if (from < previewMuralIdxRef.current && to >= previewMuralIdxRef.current) {
            setPreviewMuralIdx(previewMuralIdxRef.current - 1);
          } else if (from > previewMuralIdxRef.current && to <= previewMuralIdxRef.current) {
            setPreviewMuralIdx(previewMuralIdxRef.current + 1);
          }
        }
      }
      muralDragIdx.current = null;
      muralDragOverIdxRef.current = null;
      setMuralDragOverIdx(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [onMuralPoolChange]);

  /* ---- mural pool handlers ---------------------------------------- */

  const handleAddMurals = useCallback(async (files: File[]) => {
    const newEntries: MuralPoolEntry[] = [];
    for (const f of files) {
      const thumbUrl = await generateThumb(f);
      newEntries.push({
        id: crypto.randomUUID().slice(0, 8),
        file: f,
        blob: f,
        thumbUrl,
      });
    }
    onMuralPoolChange([...muralPool, ...newEntries]);
  }, [muralPool, onMuralPoolChange]);

  const handleMuralFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      handleAddMurals(Array.from(files));
      e.target.value = '';
    },
    [handleAddMurals],
  );

  const handleRemoveMural = useCallback((poolId: string) => {
    const inUse = walls.some(w => w.quads.some(q => q.murals.some(m => m.muralPoolId === poolId)));
    if (inUse) return;
    onMuralPoolChange(muralPool.filter(p => p.id !== poolId));
  }, [walls, muralPool, onMuralPoolChange]);

  /* ---- render ----------------------------------------------------- */

  const selectedWall = walls[selectedIdx];

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 min-h-0">
        {/* ---- Sidebar ---- */}
        <div className="w-[100px] border-r bg-gray-50 flex flex-col">
          <div
            ref={thumbListRef}
            className="flex-1 overflow-y-auto hide-scrollbar p-2 space-y-2 flex flex-col items-center"
          >
            {walls.map((w, i) => (
              <div key={w.id} data-wall-idx={i}>
                <Thumb
                  wall={w}
                  index={i}
                  selected={i === selectedIdx}
                  isDragOver={dragOverIdx === i}
                  linkColor={w.quads.some(q => q.linkId) ? linkColorMap.get(w.quads.find(q => q.linkId)?.linkId ?? '') : undefined}
                  onSelect={handleWallSelect}
                  onPointerDown={handleThumbPointerDown}
                />
              </div>
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

          {/* loading spinner removed — preloading handles it seamlessly */}

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

        {/* ---- Mural Library Sidebar ---- */}
        <div className="w-[100px] border-l bg-gray-50 flex flex-col shrink-0">
          <div
            ref={muralThumbListRef}
            className="flex-1 overflow-y-auto hide-scrollbar p-2 space-y-2 flex flex-col items-center"
          >
            {muralPool.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
                <ImagePlus className="w-8 h-8" />
                <p className="text-[10px] text-center">Add murals</p>
              </div>
            ) : (
              muralPool.map((entry, i) => {
                const inUse = walls.some(w => w.quads.some(q => q.murals.some(m => m.muralPoolId === entry.id)));
                return (
                  <div
                    key={entry.id}
                    data-mural-idx={i}
                    className={cn(
                      'group relative w-[80px] h-[60px] rounded-md overflow-hidden cursor-pointer border-2 shrink-0 select-none',
                      previewMuralIdx === i ? 'border-blue-500 ring-2 ring-blue-300' : 'border-transparent',
                      muralDragOverIdx === i && 'border-t-4 border-t-blue-500',
                    )}
                    onClick={() => setPreviewMuralIdx(i)}
                    onPointerDown={(e) => handleMuralPointerDown(i, e)}
                  >
                    <img
                      src={entry.thumbUrl}
                      alt={entry.file.name}
                      className="w-full h-full object-cover"
                      draggable={false}
                    />
                    {/* number badge */}
                    <span className="absolute bottom-0.5 left-0.5 text-[10px] font-bold bg-black/60 text-white rounded px-1 leading-tight">
                      {i + 1}
                    </span>
                    {/* Remove button on hover (only if not in use) */}
                    {!inUse && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRemoveMural(entry.id); }}
                        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                        title="Remove from library"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                    {/* In-use indicator */}
                    {inUse && (
                      <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-green-400 border border-white" title="In use" />
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Add button */}
          <button
            onClick={() => muralFileInputRef.current?.click()}
            className="h-10 flex items-center justify-center gap-1 text-sm text-gray-500 hover:text-blue-600 hover:bg-blue-50 border-t transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Add</span>
          </button>

          <input
            ref={muralFileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={handleMuralFileChange}
          />

          {/* Footer count */}
          <div className="px-1 py-1.5 border-t text-center">
            <span className="text-[11px] text-slate-400">
              {muralPool.length} mural{muralPool.length !== 1 ? 's' : ''}
            </span>
          </div>
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
