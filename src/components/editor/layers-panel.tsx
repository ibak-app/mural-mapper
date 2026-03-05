

import { useState } from 'react';
import { Eye, EyeOff, Lock, Unlock, ArrowUp, ArrowDown, Trash2, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Region } from '@/lib/types';

interface LayersPanelProps {
  regions: Region[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
  onDelete: (id: string) => void;
  onReorder: (id: string, direction: 'up' | 'down') => void;
  onRename: (id: string, name: string) => void;
}

function LayerSwatch({ fill }: { fill: Region['fill'] }) {
  if (!fill) {
    return <div className="w-5 h-5 rounded bg-white/[0.06] border border-white/10" />;
  }
  if (fill.type === 'solid-color') {
    return <div className="w-5 h-5 rounded border border-white/15" style={{ backgroundColor: fill.color }} />;
  }
  return (
    <div className="w-5 h-5 rounded flex items-center justify-center bg-gradient-to-br from-indigo-600 to-indigo-400 border border-white/15">
      <Layers className="w-2.5 h-2.5 text-white/80" />
    </div>
  );
}

function LayerItem({
  region,
  isSelected,
  isFirst,
  isLast,
  onSelect,
  onToggleVisibility,
  onToggleLock,
  onDelete,
  onReorder,
  onRename,
}: {
  region: Region;
  isSelected: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
  onDelete: (id: string) => void;
  onReorder: (id: string, dir: 'up' | 'down') => void;
  onRename: (id: string, name: string) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={cn(
        'relative flex items-center gap-1.5 px-2 py-1.5 cursor-pointer border-b border-white/[0.04] transition-all duration-100',
        isSelected
          ? 'bg-indigo-500/[0.12] border-l-2 border-l-indigo-500'
          : 'border-l-2 border-l-transparent hover:bg-white/[0.04]',
      )}
      onClick={() => onSelect(region.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Visibility toggle */}
      <button
        className={cn('flex items-center justify-center w-5 h-5 rounded shrink-0 transition-colors hover:text-white',
          region.visible ? 'text-white/50' : 'text-white/18')}
        onClick={(e) => { e.stopPropagation(); onToggleVisibility(region.id); }}
        title={region.visible ? 'Hide layer' : 'Show layer'}
      >
        {region.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
      </button>

      <LayerSwatch fill={region.fill} />

      {/* Name input */}
      <input
        className={cn(
          'flex-1 text-xs bg-transparent border-none outline-none truncate min-w-0 caret-indigo-400',
          isSelected ? 'text-indigo-200' : 'text-white/65',
        )}
        value={region.name}
        onChange={(e) => onRename(region.id, e.target.value)}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Action buttons */}
      <div className={cn('flex items-center gap-0.5 shrink-0 transition-opacity', hovered || isSelected ? 'opacity-100' : 'opacity-0')}>
        <button
          className={cn('flex items-center justify-center w-5 h-5 rounded shrink-0 transition-colors hover:text-amber-400',
            region.locked ? 'text-amber-500' : 'text-white/30')}
          onClick={(e) => { e.stopPropagation(); onToggleLock(region.id); }}
          title={region.locked ? 'Unlock' : 'Lock'}
        >
          {region.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
        </button>

        <button
          className="flex items-center justify-center w-5 h-5 rounded shrink-0 text-white/35 hover:text-white disabled:text-white/12 transition-colors"
          onClick={(e) => { e.stopPropagation(); onReorder(region.id, 'up'); }}
          disabled={isFirst}
          title="Move up"
        >
          <ArrowUp className="w-2.5 h-2.5" />
        </button>

        <button
          className="flex items-center justify-center w-5 h-5 rounded shrink-0 text-white/35 hover:text-white disabled:text-white/12 transition-colors"
          onClick={(e) => { e.stopPropagation(); onReorder(region.id, 'down'); }}
          disabled={isLast}
          title="Move down"
        >
          <ArrowDown className="w-2.5 h-2.5" />
        </button>

        <button
          className="flex items-center justify-center w-5 h-5 rounded shrink-0 text-white/25 hover:text-red-400 transition-colors"
          onClick={(e) => { e.stopPropagation(); onDelete(region.id); }}
          title="Delete"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

export function LayersPanel({
  regions,
  selectedId,
  onSelect,
  onToggleVisibility,
  onToggleLock,
  onDelete,
  onReorder,
  onRename,
}: LayersPanelProps) {
  const sorted = [...regions].sort((a, b) => b.order - a.order);

  return (
    <div className="flex flex-col shrink-0 overflow-hidden w-[240px] bg-[#13131f] border-l border-white/[0.07]">
      <div className="flex items-center justify-between px-4 shrink-0 h-[42px] border-b border-white/[0.07]">
        <span className="text-xs font-bold uppercase tracking-widest text-white/35">Layers</span>
        <span className="text-xs tabular-nums text-white/20">{sorted.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 gap-2 text-white/20">
            <Layers className="w-6 h-6" />
            <span className="text-xs">No regions yet</span>
          </div>
        ) : (
          sorted.map((region, idx) => (
            <LayerItem
              key={region.id}
              region={region}
              isSelected={selectedId === region.id}
              isFirst={idx === 0}
              isLast={idx === sorted.length - 1}
              onSelect={onSelect}
              onToggleVisibility={onToggleVisibility}
              onToggleLock={onToggleLock}
              onDelete={onDelete}
              onReorder={onReorder}
              onRename={onRename}
            />
          ))
        )}
      </div>
    </div>
  );
}
