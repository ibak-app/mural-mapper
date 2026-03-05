

import { useState, useRef, useCallback, DragEvent, useId } from 'react';
import { GripVertical, Pencil, Trash2, Upload, Loader2, Image } from 'lucide-react';
import { Dropzone } from '@/components/ui/dropzone';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Wall } from '@/lib/types';

// ─── Feedback status dot ──────────────────────────────────────────────────────

function StatusDot({ wall }: { wall: Wall }) {
  const hasFeedback = wall.mockups.some(
    (m) => m.feedback && m.feedback.status !== 'none',
  );
  if (!hasFeedback) return null;
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
      title="Has feedback"
    />
  );
}

// ─── Individual Wall Card ─────────────────────────────────────────────────────

interface WallCardProps {
  wall: Wall;
  projectId: string;
  isDragOver: boolean;
  isDragging: boolean;
  editingId: string | null;
  editingName: string;
  onDragStart: (e: DragEvent, id: string) => void;
  onDragOver: (e: DragEvent, id: string) => void;
  onDrop: (e: DragEvent, id: string) => void;
  onDragEnd: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onStartRename: (wall: Wall) => void;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
}

function WallCard({
  wall,
  projectId,
  isDragOver,
  isDragging,
  editingId,
  editingName,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onEdit,
  onDelete,
  onStartRename,
  onRenameChange,
  onRenameCommit,
}: WallCardProps) {
  const mockupCount = wall.mockups.length;

  return (
    <Card
      draggable
      onDragStart={(e) => onDragStart(e as DragEvent, wall.id)}
      onDragOver={(e) => onDragOver(e as DragEvent, wall.id)}
      onDrop={(e) => onDrop(e as DragEvent, wall.id)}
      onDragEnd={onDragEnd}
      className={cn(
        'group relative overflow-hidden cursor-grab active:cursor-grabbing select-none transition-all duration-150',
        isDragOver
          ? 'border-indigo-400 shadow-md shadow-indigo-100 scale-[1.015] ring-2 ring-indigo-200'
          : 'hover:shadow-md hover:border-slate-300 hover:-translate-y-0.5',
        isDragging && 'opacity-40 scale-[0.98]',
      )}
    >
      {/* Drop indicator bar */}
      {isDragOver && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500 rounded-l-2xl z-20" />
      )}

      {/* Thumbnail — 4:3 aspect */}
      <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
        <img
          src={`/api/projects/${projectId}/walls/${wall.id}/image?type=thumbnail`}
          alt={wall.name}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          draggable={false}
        />

        {/* Hover overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />

        {/* Centered edit button on hover */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
          <Button
            variant="secondary"
            size="sm"
            icon={<Pencil className="w-3 h-3" />}
            onClick={(e) => { e.stopPropagation(); onEdit(wall.id); }}
            className="shadow-lg"
          >
            Edit
          </Button>
        </div>

        {/* Drag handle — top left */}
        <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-80 transition-opacity duration-150 text-white z-10">
          <GripVertical className="w-4 h-4 drop-shadow" />
        </div>

        {/* Delete button — top right */}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(wall.id); }}
          aria-label="Delete wall"
          className={cn(
            'absolute top-2 right-2 z-10',
            'w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center',
            'opacity-0 group-hover:opacity-100 transition-opacity duration-150',
            'hover:bg-red-600 shadow-md',
          )}
        >
          <Trash2 className="w-3 h-3" />
        </button>

        {/* Mockup count badge */}
        {mockupCount > 0 && (
          <div className="absolute bottom-2 right-2 z-10 inline-flex items-center gap-1 px-1.5 py-0.5 bg-black/50 backdrop-blur-sm text-white text-[10px] font-semibold rounded-full">
            <Image className="w-2.5 h-2.5" />
            {mockupCount}
          </div>
        )}
      </div>

      {/* Card footer */}
      <div className="px-3 py-2.5 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          {editingId === wall.id ? (
            <input
              value={editingName}
              onChange={(e) => onRenameChange(e.target.value)}
              onBlur={onRenameCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRenameCommit();
                if (e.key === 'Escape') onRenameCommit();
              }}
              autoFocus
              className="text-xs font-semibold w-full border-b-2 border-indigo-500 focus:outline-none bg-transparent text-slate-800 py-0.5"
            />
          ) : (
            <p
              className="text-xs font-semibold truncate text-slate-700 hover:text-indigo-600 cursor-text transition-colors"
              title={wall.name}
              onDoubleClick={() => onStartRename(wall)}
            >
              {wall.name}
            </p>
          )}
        </div>
        <StatusDot wall={wall} />
      </div>
    </Card>
  );
}

// ─── Add Card ─────────────────────────────────────────────────────────────────

function AddCard({
  uploading,
  onFiles,
}: {
  uploading: boolean;
  onFiles: (files: File[]) => void;
}) {
  const inputId = useId();

  return (
    <label
      htmlFor={inputId}
      className={cn(
        'aspect-[4/3] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center',
        'cursor-pointer transition-all duration-200 group',
        uploading
          ? 'border-indigo-300 bg-indigo-50/60'
          : 'border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/30',
      )}
    >
      {uploading ? (
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
          <span className="text-xs text-indigo-400 font-medium">Uploading…</span>
        </div>
      ) : (
        <>
          <div className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center transition-colors mb-2',
            'bg-slate-100 group-hover:bg-indigo-100',
          )}>
            <Upload className="w-4 h-4 text-slate-400 group-hover:text-indigo-500 transition-colors" />
          </div>
          <span className="text-xs font-semibold text-slate-400 group-hover:text-indigo-500 transition-colors">
            Add Photos
          </span>
        </>
      )}
      <input
        id={inputId}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0) onFiles(files);
          e.target.value = '';
        }}
      />
    </label>
  );
}

// ─── Gallery Grid Props ───────────────────────────────────────────────────────

interface GalleryGridProps {
  walls: Wall[];
  projectId: string;
  onAddWalls: (files: File[]) => Promise<void>;
  onRemoveWall: (wallId: string) => void;
  onRenameWall: (wallId: string, name: string) => void;
  onEditWall: (wallId: string) => void;
  onReorder: (wallIds: string[]) => void;
}

// ─── Gallery Grid ─────────────────────────────────────────────────────────────

export function GalleryGrid({
  walls,
  projectId,
  onAddWalls,
  onRemoveWall,
  onRenameWall,
  onEditWall,
  onReorder,
}: GalleryGridProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragItemRef = useRef<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const sorted = [...walls].sort((a, b) => {
    const ao = typeof a.order === 'number' ? a.order : 999;
    const bo = typeof b.order === 'number' ? b.order : 999;
    return ao - bo;
  });

  const handleUpload = useCallback(
    async (files: File[]) => {
      setUploading(true);
      try {
        await onAddWalls(files);
      } finally {
        setUploading(false);
      }
    },
    [onAddWalls],
  );

  const handleDragStart = (e: DragEvent, wallId: string) => {
    dragItemRef.current = wallId;
    setDraggingId(wallId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: DragEvent, wallId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragItemRef.current !== wallId) {
      setDragOverId(wallId);
    }
  };

  const handleDrop = (e: DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverId(null);
    setDraggingId(null);
    const dragId = dragItemRef.current;
    if (!dragId || dragId === targetId) return;

    const ids = sorted.map((w) => w.id);
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(targetId);
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, dragId);
    onReorder(ids);
    dragItemRef.current = null;
  };

  const handleDragEnd = () => {
    setDragOverId(null);
    setDraggingId(null);
    dragItemRef.current = null;
  };

  const startRename = (wall: Wall) => {
    setEditingId(wall.id);
    setEditingName(wall.name);
  };

  const commitRename = () => {
    if (editingId && editingName.trim()) {
      onRenameWall(editingId, editingName.trim());
    }
    setEditingId(null);
  };

  const handleDelete = (wallId: string) => {
    if (!confirm('Remove this wall photo?')) return;
    onRemoveWall(wallId);
  };

  // Empty state — full dropzone
  if (sorted.length === 0) {
    return (
      <Dropzone
        onFiles={handleUpload}
        label={uploading ? 'Uploading…' : 'Drop wall photos here or click to browse'}
        multiple
      />
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {sorted.map((wall) => (
        <WallCard
          key={wall.id}
          wall={wall}
          projectId={projectId}
          isDragOver={dragOverId === wall.id}
          isDragging={draggingId === wall.id}
          editingId={editingId}
          editingName={editingName}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
          onEdit={onEditWall}
          onDelete={handleDelete}
          onStartRename={startRename}
          onRenameChange={setEditingName}
          onRenameCommit={commitRename}
        />
      ))}

      {/* Add more card */}
      <AddCard uploading={uploading} onFiles={handleUpload} />
    </div>
  );
}
