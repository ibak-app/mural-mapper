import { useCallback, useState, useRef, useEffect, memo, type DragEvent } from 'react';
import { ImagePlus, Paintbrush, Crop, X, ArrowRight, Loader2, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CropDialog } from '@/components/crop-dialog';

interface Corner { x: number; y: number }

export interface WallItem {
  id: string;
  img: HTMLImageElement | null;
  src: string;
  blob: Blob;
  nativePath?: string;
  corners?: [Corner, Corner, Corner, Corner];
}

interface ProjectStepProps {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  walls: WallItem[];
  onWallsChange: (walls: WallItem[]) => void;
  artImage: HTMLImageElement | null;
  artSrc: string | null;
  onArtChange: (img: HTMLImageElement | null, src: string | null, blob: Blob | null) => void;
  onSelectWall: (index: number) => void;
  onBackToProjects: () => void;
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

// Memoized thumbnail — only re-renders when its own props change
const Thumb = memo(function Thumb({ src, index, selected, hasCornors, dragging, dragOver, onSelect, onDragStart, onDragOver, onDrop, onDragEnd, setRef }: {
  src: string;
  index: number;
  selected: boolean;
  hasCornors: boolean;
  dragging: boolean;
  dragOver: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  setRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={setRef}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      className={cn(
        'relative rounded-md overflow-hidden cursor-grab active:cursor-grabbing border-2 transition-[border-color,box-shadow]',
        selected ? 'border-indigo-500 shadow-sm' : 'border-transparent hover:border-slate-300',
        dragging ? 'opacity-30 scale-90' : '',
        dragOver ? 'border-indigo-400 scale-105' : '',
      )}
    >
      <div className="aspect-[4/3] bg-slate-200 relative">
        {src ? (
          <img src={src} alt={`Wall ${index + 1}`} className="w-full h-full object-cover" loading="lazy" decoding="async" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />
          </div>
        )}
        <div className="absolute bottom-0.5 left-0.5 bg-black/60 text-white text-[9px] font-bold px-1 rounded">
          {index + 1}
        </div>
        {hasCornors && (
          <div className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-emerald-400" />
        )}
      </div>
    </div>
  );
});

export function ProjectStep({
  projectName, onProjectNameChange,
  walls, onWallsChange,
  artImage, artSrc, onArtChange,
  onSelectWall, onBackToProjects,
}: ProjectStepProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [cropping, setCropping] = useState(false);
  const [loadingCount, setLoadingCount] = useState(0);
  const wallInputRef = useRef<HTMLInputElement>(null);
  const artInputRef = useRef<HTMLInputElement>(null);
  const thumbRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const selectedIdxRef = useRef(selectedIdx);
  selectedIdxRef.current = selectedIdx;

  // Keep selectedIdx in bounds
  useEffect(() => {
    if (walls.length === 0) { setSelectedIdx(0); return; }
    if (selectedIdx >= walls.length) setSelectedIdx(walls.length - 1);
  }, [walls.length, selectedIdx]);

  // Arrow key navigation — uses ref to avoid re-render lag
  useEffect(() => {
    let rafId = 0;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (cropping) return;
      if (e.target instanceof HTMLInputElement) return;
      if (walls.length === 0) return;

      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          setSelectedIdx(prev => {
            const next = Math.max(0, prev - 1);
            thumbRefs.current.get(next)?.scrollIntoView({ block: 'nearest' });
            return next;
          });
        });
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          setSelectedIdx(prev => {
            const next = Math.min(walls.length - 1, prev + 1);
            thumbRefs.current.get(next)?.scrollIntoView({ block: 'nearest' });
            return next;
          });
        });
      } else if (e.key === 'Delete') {
        e.preventDefault();
        removeWall(selectedIdxRef.current);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('keydown', handleKeyDown); cancelAnimationFrame(rafId); };
  }, [walls.length, cropping]);

  const wallsRef = useRef(walls);
  wallsRef.current = walls;

  // Staggered image loading — add first batch immediately, rest one-by-one
  const addWallFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (arr.length === 0) return;

    const IMMEDIATE = 3;
    const allItems: WallItem[] = arr.map(f => ({
      id: genId(),
      img: null,
      src: '', // start empty
      blob: f,
      _objUrl: URL.createObjectURL(f), // store URL but don't assign to src yet
    } as WallItem & { _objUrl: string }));

    // First batch: assign src immediately
    for (let i = 0; i < Math.min(IMMEDIATE, allItems.length); i++) {
      allItems[i].src = (allItems[i] as any)._objUrl;
    }

    const startIdx = wallsRef.current.length;
    onWallsChange([...wallsRef.current, ...allItems]);
    setSelectedIdx(startIdx);

    // Rest: stagger src assignment so browser doesn't decode all at once
    if (allItems.length > IMMEDIATE) {
      let i = IMMEDIATE;
      const loadNext = () => {
        if (i >= allItems.length) return;
        const item = allItems[i];
        const url = (item as any)._objUrl;
        onWallsChange(wallsRef.current.map(w =>
          w.id === item.id ? { ...w, src: url } : w
        ));
        i++;
        setTimeout(loadNext, 50);
      };
      setTimeout(loadNext, 100);
    }
  }, [onWallsChange]);

  const handleArtFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => onArtChange(img, src, file);
    img.src = src;
  }, [onArtChange]);

  const removeWall = (idx: number) => {
    const next = wallsRef.current.filter((_, i) => i !== idx);
    onWallsChange(next);
  };

  const handleReorder = () => {
    if (dragIdx === null || dragOverIdx === null || dragIdx === dragOverIdx) return;
    const next = [...walls];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(dragOverIdx, 0, moved);
    onWallsChange(next);
    setSelectedIdx(dragOverIdx);
  };

  const handleCropComplete = (blob: Blob) => {
    const wall = walls[selectedIdx];
    if (!wall) return;
    const src = URL.createObjectURL(blob);
    onWallsChange(walls.map((w, i) =>
      i === selectedIdx ? { ...w, img: null, src, blob, corners: undefined } : w
    ));
    setCropping(false);
  };

  const handleWallDrop = (e: DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-indigo-400');
    if (e.dataTransfer.files.length > 0) addWallFiles(e.dataTransfer.files);
  };

  const canStart = walls.length > 0 && artImage !== null;
  const selectedWall = walls[selectedIdx] ?? null;

  const handleStartMapping = async (idx: number) => {
    setLoadingCount(prev => prev + 1);
    const wall = walls[idx];
    if (wall.img) {
      setLoadingCount(prev => prev - 1);
      onSelectWall(idx);
      return;
    }
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = wall.src;
      });
      onWallsChange(walls.map((w, i) => i === idx ? { ...w, img } : w));
      onSelectWall(idx);
    } catch (e) {
      console.warn('Failed to load wall image:', e);
    }
    setLoadingCount(prev => prev - 1);
  };

  return (
    <>
      <div className="fixed inset-0 flex" style={{ top: 54 }} tabIndex={-1}>
        {/* LEFT SIDEBAR */}
        <div className="w-[100px] bg-slate-50 border-r border-slate-200 flex flex-col shrink-0">
          <div className="px-2 py-2.5 border-b border-slate-200">
            <button
              onClick={onBackToProjects}
              className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-indigo-500 transition-colors mb-1"
            >
              <ChevronLeft className="w-3 h-3" />
              Projects
            </button>
            <input
              type="text"
              value={projectName}
              onChange={(e) => onProjectNameChange(e.target.value)}
              className="w-full text-[11px] font-semibold text-slate-700 bg-transparent border-none outline-none truncate"
              placeholder="Project..."
            />
            <div className="text-[10px] text-slate-400 mt-0.5">
              {walls.length} wall{walls.length !== 1 ? 's' : ''}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-1.5 space-y-1 px-1.5">
            {walls.map((wall, i) => (
              <Thumb
                key={wall.id}
                src={wall.src}
                index={i}
                selected={selectedIdx === i}
                hasCornors={!!wall.corners}
                dragging={dragIdx === i}
                dragOver={dragOverIdx === i && dragIdx !== null && dragIdx !== i}
                onSelect={() => setSelectedIdx(i)}
                onDragStart={() => setDragIdx(i)}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverIdx(i); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleReorder(); setDragIdx(null); setDragOverIdx(null); }}
                onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                setRef={(el) => { if (el) thumbRefs.current.set(i, el); else thumbRefs.current.delete(i); }}
              />
            ))}

            <button
              onClick={() => wallInputRef.current?.click()}
              className="w-full aspect-[4/3] rounded-md border-2 border-dashed border-slate-300 flex flex-col items-center justify-center gap-0.5 text-slate-400 hover:border-indigo-400 hover:text-indigo-500 hover:bg-indigo-50/50 transition-all"
            >
              <ImagePlus className="w-4 h-4" />
              <span className="text-[9px] font-medium">Add</span>
            </button>
          </div>

          {/* Art selector */}
          <div className="border-t border-slate-200 p-1.5">
            <div
              onClick={() => artInputRef.current?.click()}
              className={cn(
                'rounded-md border-2 border-dashed overflow-hidden cursor-pointer transition-all',
                artSrc ? 'border-indigo-200' : 'border-slate-300 hover:border-indigo-400',
              )}
            >
              {artSrc ? (
                <div className="aspect-square relative group">
                  <img src={artSrc} alt="Art" className="w-full h-full object-contain bg-white p-0.5" loading="lazy" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                    <span className="text-white text-[9px] font-semibold opacity-0 group-hover:opacity-100">Change</span>
                  </div>
                </div>
              ) : (
                <div className="aspect-square flex flex-col items-center justify-center gap-0.5 text-slate-400">
                  <Paintbrush className="w-3.5 h-3.5" />
                  <span className="text-[8px] font-semibold">Artwork</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* MAIN AREA */}
        <div className="flex-1 flex flex-col bg-slate-100 relative">
          {walls.length === 0 ? (
            <div
              className="flex-1 flex items-center justify-center"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleWallDrop}
            >
              <div onClick={() => wallInputRef.current?.click()} className="text-center cursor-pointer group">
                <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center mx-auto mb-4 group-hover:scale-105 transition-transform">
                  <ImagePlus className="w-8 h-8 text-indigo-600" />
                </div>
                <p className="text-base font-semibold text-slate-800">Drop wall photos here</p>
                <p className="text-sm text-slate-400 mt-1">or click to browse — add multiple at once</p>
              </div>
            </div>
          ) : selectedWall ? (
            <>
              <div
                className="flex-1 flex items-center justify-center p-4 overflow-hidden"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleWallDrop}
              >
                {selectedWall.src ? (
                  <img
                    src={selectedWall.src}
                    alt={`Wall ${selectedIdx + 1}`}
                    className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
                    decoding="async"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
                    <span className="text-sm text-slate-400">Loading...</span>
                  </div>
                )}
              </div>

              <div className="h-12 bg-white border-t border-slate-200 flex items-center justify-between px-5 shrink-0">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-slate-700">
                    Wall {selectedIdx + 1} / {walls.length}
                  </span>
                  {selectedWall.corners && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Mapped</span>
                  )}
                  <span className="text-[10px] text-slate-400">↑↓ navigate</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCropping(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    <Crop className="w-3.5 h-3.5" />
                    Crop
                  </button>
                  <button
                    onClick={() => removeWall(selectedIdx)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    Remove
                  </button>
                  <div className="w-px h-5 bg-slate-200 mx-1" />
                  <Button
                    size="sm"
                    disabled={!canStart || loadingCount > 0}
                    loading={loadingCount > 0}
                    onClick={() => handleStartMapping(selectedIdx)}
                    icon={<ArrowRight className="w-3.5 h-3.5" />}
                  >
                    {selectedWall.corners ? 'Edit Mapping' : 'Map This Wall'}
                  </Button>
                </div>
              </div>
            </>
          ) : null}

          {loadingCount > 0 && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                <span className="text-sm font-medium text-slate-600">Preparing image...</span>
              </div>
            </div>
          )}

          {walls.length > 0 && !artSrc && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium px-4 py-2 rounded-full shadow-sm z-10">
              Select an artwork image in the sidebar to start mapping
            </div>
          )}
        </div>

        <input ref={wallInputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { if (e.target.files) addWallFiles(e.target.files); e.target.value = ''; }}
        />
        <input ref={artInputRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleArtFile(f); e.target.value = ''; }}
        />
      </div>

      {cropping && selectedWall?.src && (
        <CropDialog imageSrc={selectedWall.src} onCrop={handleCropComplete} onCancel={() => setCropping(false)} />
      )}
    </>
  );
}
