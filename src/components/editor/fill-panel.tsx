

import { useState } from 'react';
import { ChevronDown, Upload } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { MuralPlacementPanel } from './mural-placement-panel';
import { cn } from '@/lib/utils';
import type { RegionFill, Mural, BlendMode, MuralImageFill } from '@/lib/types';

const PALETTE = [
  '#FFFFFF', '#F8F9FA', '#E9ECEF', '#DEE2E6', '#CED4DA', '#ADB5BD',
  '#6C757D', '#495057', '#343A40', '#212529', '#000000',
  '#FF6B6B', '#EE5A24', '#F0932B', '#FFC312', '#A3CB38', '#009432',
  '#1289A7', '#0652DD', '#6F1E51', '#833471', '#ED4C67',
  '#B33939', '#CD6133', '#CC8E35', '#F7DC6F', '#82E0AA', '#1ABC9C',
  '#3498DB', '#2980B9', '#8E44AD', '#E74C3C', '#2C3E50',
];

const BLEND_MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-burn', 'color-dodge', 'hard-light', 'soft-light',
];

interface FillPanelProps {
  fill: RegionFill | null;
  opacity: number;
  blendMode: BlendMode;
  murals: Mural[];
  projectId: string;
  onFillChange: (fill: RegionFill) => void;
  onOpacityChange: (opacity: number) => void;
  onBlendModeChange: (mode: BlendMode) => void;
  onUploadMural: (file: File) => void;
}

function SectionHeader({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-2.5 text-white/60 hover:bg-white/[0.04] transition-colors"
    >
      <span className="text-xs font-semibold uppercase tracking-widest">{label}</span>
      <ChevronDown className={cn('w-3 h-3 text-white/35 transition-transform', open && 'rotate-180')} />
    </button>
  );
}

export function FillPanel({
  fill,
  opacity,
  blendMode,
  murals,
  projectId,
  onFillChange,
  onOpacityChange,
  onBlendModeChange,
  onUploadMural,
}: FillPanelProps) {
  const [customColor, setCustomColor] = useState('#3b82f6');
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [customOpen, setCustomOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(true);

  const isMuralFill = fill?.type === 'mural-image';

  return (
    <div className="flex flex-col shrink-0 overflow-hidden w-[280px] bg-[#13131f] border-r border-white/[0.07]">
      {/* Panel header */}
      <div className="flex items-center px-4 shrink-0 h-[42px] border-b border-white/[0.07]">
        <span className="text-xs font-bold uppercase tracking-widest text-white/35">Fill</span>
      </div>

      <Tabs defaultValue="color" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="shrink-0 rounded-none bg-transparent border-b border-white/[0.07] p-0 gap-0 w-full">
          <TabsTrigger value="color" className="flex-1 rounded-none py-2.5 text-xs font-semibold data-[state=active]:bg-transparent data-[state=active]:text-indigo-300 data-[state=active]:shadow-none text-white/35 relative">
            Color
          </TabsTrigger>
          <TabsTrigger value="mural" className="flex-1 rounded-none py-2.5 text-xs font-semibold data-[state=active]:bg-transparent data-[state=active]:text-indigo-300 data-[state=active]:shadow-none text-white/35 relative">
            Mural
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-y-auto">
          <TabsContent value="color" className="mt-0">
            {/* Palette */}
            <div className="border-b border-white/5">
              <SectionHeader label="Palette" open={paletteOpen} onToggle={() => setPaletteOpen(!paletteOpen)} />
              {paletteOpen && (
                <div className="px-4 pb-4">
                  <div className="grid grid-cols-8 gap-1.5">
                    {PALETTE.map((color) => {
                      const isSelected = fill?.type === 'solid-color' && fill.color === color;
                      return (
                        <button
                          key={color}
                          onClick={() => onFillChange({ type: 'solid-color', color })}
                          className={cn(
                            'w-6 h-6 rounded transition-transform',
                            isSelected && 'scale-115 ring-2 ring-indigo-500 ring-offset-1 ring-offset-[#13131f]',
                          )}
                          style={{ backgroundColor: color, border: isSelected ? '2px solid #4f46e5' : '2px solid rgba(255,255,255,0.08)' }}
                          title={color}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Custom color */}
            <div className="border-b border-white/5">
              <SectionHeader label="Custom" open={customOpen} onToggle={() => setCustomOpen(!customOpen)} />
              {customOpen && (
                <div className="px-4 pb-4">
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-white/5 border border-white/[0.08]">
                    <div className="relative w-8 h-8 rounded-lg overflow-hidden shrink-0 border-2 border-white/[0.12]">
                      <div className="absolute inset-0" style={{ backgroundColor: customColor }} />
                      <input
                        type="color"
                        value={customColor}
                        onChange={(e) => setCustomColor(e.target.value)}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                    </div>
                    <input
                      type="text"
                      value={customColor}
                      onChange={(e) => setCustomColor(e.target.value)}
                      className="flex-1 text-xs font-mono bg-transparent outline-none uppercase text-white/75 caret-indigo-400"
                      spellCheck={false}
                    />
                    <button
                      onClick={() => onFillChange({ type: 'solid-color', color: customColor })}
                      className="px-2.5 py-1 rounded-md text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shrink-0 shadow-[0_0_8px_rgba(79,70,229,0.4)]"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="mural" className="mt-0 p-4">
            {isMuralFill ? (
              <MuralPlacementPanel
                fill={fill as MuralImageFill}
                murals={murals}
                projectId={projectId}
                onFillChange={onFillChange}
                onUploadMural={onUploadMural}
              />
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {murals.map((mural) => (
                    <button
                      key={mural.id}
                      className="aspect-square rounded-xl overflow-hidden border-2 border-white/[0.08] hover:border-indigo-500 transition-colors"
                      onClick={() =>
                        onFillChange({
                          type: 'mural-image',
                          muralId: mural.id,
                          fitMode: 'cover',
                          offsetX: 0,
                          offsetY: 0,
                          scale: 1,
                          rotation: 0,
                        })
                      }
                    >
                      <img
                        src={`/api/projects/${projectId}/murals/${mural.id}`}
                        alt={mural.name}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
                <label className="flex flex-col items-center justify-center gap-1.5 rounded-xl p-4 cursor-pointer border-2 border-dashed border-white/[0.12] text-white/30 hover:border-indigo-500 hover:text-indigo-400 transition-colors">
                  <Upload className="w-4 h-4" />
                  <span className="text-xs font-medium">Upload mural</span>
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
            )}
          </TabsContent>
        </div>
      </Tabs>

      {/* Opacity & Blend — sticky footer */}
      <div className="shrink-0 border-t border-white/[0.07]">
        <SectionHeader label="Layer" open={settingsOpen} onToggle={() => setSettingsOpen(!settingsOpen)} />
        {settingsOpen && (
          <div className="px-4 pb-4 space-y-4">
            {/* Opacity */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/40">Opacity</span>
                <span className="text-xs font-mono tabular-nums text-white/60">{Math.round(opacity * 100)}%</span>
              </div>
              <Slider
                value={Math.round(opacity * 100)}
                onValueChange={(v) => onOpacityChange(v / 100)}
                min={0}
                max={100}
                variant="dark"
                aria-label="Opacity"
              />
            </div>

            {/* Blend mode */}
            <div className="space-y-1.5">
              <span className="text-xs block text-white/40">Blend Mode</span>
              <div className="relative">
                <select
                  value={blendMode}
                  onChange={(e) => onBlendModeChange(e.target.value as BlendMode)}
                  className="w-full text-xs rounded-lg px-3 py-2 appearance-none outline-none capitalize bg-white/[0.06] text-white/70 border border-white/10"
                >
                  {BLEND_MODES.map((m) => (
                    <option key={m} value={m} style={{ background: '#1e1e2e' }}>
                      {m}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30 pointer-events-none" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
