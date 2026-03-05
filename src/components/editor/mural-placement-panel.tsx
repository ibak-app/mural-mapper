

import { Upload } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import type { MuralImageFill, Mural, FitMode } from '@/lib/types';

const FIT_MODES: { value: FitMode; label: string }[] = [
  { value: 'cover', label: 'Cover' },
  { value: 'contain', label: 'Contain' },
  { value: 'stretch', label: 'Stretch' },
  { value: 'tile', label: 'Tile' },
];

interface MuralPlacementPanelProps {
  fill: MuralImageFill;
  murals: Mural[];
  projectId: string;
  onFillChange: (fill: MuralImageFill) => void;
  onUploadMural: (file: File) => void;
}

function ParamRow({ label, value, displayValue, min, max, onChange }: {
  label: string;
  value: number;
  displayValue: string;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/38">{label}</span>
        <span className="text-xs font-mono tabular-nums text-white/55">{displayValue}</span>
      </div>
      <Slider value={value} onValueChange={onChange} min={min} max={max} variant="dark" aria-label={label} />
    </div>
  );
}

export function MuralPlacementPanel({
  fill,
  murals,
  projectId,
  onFillChange,
  onUploadMural,
}: MuralPlacementPanelProps) {
  const updateFill = (partial: Partial<MuralImageFill>) => {
    onFillChange({ ...fill, ...partial });
  };

  return (
    <div className="space-y-4">
      {/* Image picker */}
      <div className="space-y-2">
        <span className="text-xs block text-white/35">Mural Image</span>
        <div className="grid grid-cols-3 gap-1.5">
          {murals.map((mural) => {
            const isSelected = fill.muralId === mural.id;
            return (
              <button
                key={mural.id}
                onClick={() => updateFill({ muralId: mural.id })}
                className={cn(
                  'aspect-square rounded-lg overflow-hidden border-2 transition-all',
                  isSelected
                    ? 'border-indigo-500 shadow-[0_0_0_2px_rgba(79,70,229,0.3)]'
                    : 'border-white/[0.06] hover:border-indigo-500/50',
                )}
              >
                <img
                  src={`/api/projects/${projectId}/murals/${mural.id}`}
                  alt={mural.name}
                  className="w-full h-full object-cover"
                />
              </button>
            );
          })}
        </div>

        <label className="flex items-center justify-center gap-1.5 rounded-lg py-2 cursor-pointer border border-dashed border-white/10 text-white/28 text-[11px] hover:border-indigo-500 hover:text-indigo-400 transition-colors">
          <Upload className="w-3 h-3" />
          Upload mural
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadMural(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {fill.muralId && (
        <>
          <div className="h-px bg-white/[0.06]" />

          {/* Fit mode */}
          <div className="space-y-1.5">
            <span className="text-xs block text-white/35">Fit Mode</span>
            <div className="grid grid-cols-4 gap-1">
              {FIT_MODES.map(({ value, label }) => {
                const isActive = fill.fitMode === value;
                return (
                  <button
                    key={value}
                    onClick={() => updateFill({ fitMode: value })}
                    className={cn(
                      'flex flex-col items-center gap-0.5 py-1.5 rounded-lg text-[10px] font-medium border transition-all',
                      isActive
                        ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/35'
                        : 'bg-white/[0.04] text-white/40 border-white/[0.07] hover:bg-white/[0.08] hover:text-white/75',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="h-px bg-white/[0.06]" />

          <ParamRow
            label="Scale"
            value={Math.round(fill.scale * 100)}
            displayValue={`${Math.round(fill.scale * 100)}%`}
            min={10}
            max={300}
            onChange={(v) => updateFill({ scale: v / 100 })}
          />
          <ParamRow
            label="Rotation"
            value={fill.rotation}
            displayValue={`${Math.round(fill.rotation)}\u00b0`}
            min={-180}
            max={180}
            onChange={(v) => updateFill({ rotation: v })}
          />
          <ParamRow
            label="Pan X"
            value={Math.round(fill.offsetX * 100)}
            displayValue={`${Math.round(fill.offsetX * 100)}%`}
            min={-100}
            max={100}
            onChange={(v) => updateFill({ offsetX: v / 100 })}
          />
          <ParamRow
            label="Pan Y"
            value={Math.round(fill.offsetY * 100)}
            displayValue={`${Math.round(fill.offsetY * 100)}%`}
            min={-100}
            max={100}
            onChange={(v) => updateFill({ offsetY: v / 100 })}
          />
        </>
      )}
    </div>
  );
}
