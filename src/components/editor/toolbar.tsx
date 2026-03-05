

import { useEditorStore } from '@/stores/editor-store';
import { Island } from '@/components/ui/island';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import {
  MousePointer2, Square, Pentagon, Paintbrush, Wand2,
  Maximize, Diamond, Hand, Minus, Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolType, EditorMode } from '@/lib/types';
import type { LucideIcon } from 'lucide-react';

const tools: { type: ToolType; label: string; Icon: LucideIcon; shortcut: string; modes: EditorMode[] }[] = [
  { type: 'select', label: 'Select', Icon: MousePointer2, shortcut: 'V', modes: ['color', 'mural'] },
  { type: 'rectangle', label: 'Rectangle', Icon: Square, shortcut: 'R', modes: ['color'] },
  { type: 'polygon', label: 'Polygon', Icon: Pentagon, shortcut: 'P', modes: ['color'] },
  { type: 'brush', label: 'Brush', Icon: Paintbrush, shortcut: 'B', modes: ['color'] },
  { type: 'magic-wand', label: 'Magic Wand', Icon: Wand2, shortcut: 'M', modes: ['color'] },
  { type: 'whole-wall', label: 'Whole Wall', Icon: Maximize, shortcut: 'W', modes: ['color'] },
  { type: 'quad', label: 'Quad', Icon: Diamond, shortcut: 'Q', modes: ['mural'] },
  { type: 'pan', label: 'Pan', Icon: Hand, shortcut: 'H', modes: ['color', 'mural'] },
];

interface ToolbarProps {
  zoom?: number;
  mode?: EditorMode;
  onModeChange?: (mode: EditorMode) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
}

export function Toolbar({ zoom = 1, mode = 'color', onModeChange, onZoomIn, onZoomOut, onResetZoom }: ToolbarProps) {
  const { activeTool, setTool, brushSize, setBrushSize, tolerance, setTolerance, opencvLoaded } = useEditorStore();
  const filteredTools = tools.filter((t) => t.modes.includes(mode));

  return (
    <TooltipProvider>
      <Island variant="dark" className="flex items-center gap-1 px-2 py-1.5 rounded-full max-w-[90vw] flex-wrap">

        {/* Mode toggle */}
        {onModeChange && (
          <>
            <div className="flex rounded-full p-0.5 mr-1 bg-white/[0.07]">
              {(['color', 'mural'] as EditorMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => onModeChange(m)}
                  className={cn(
                    'px-3 py-0.5 rounded-full text-xs font-semibold capitalize transition-all',
                    mode === m
                      ? 'bg-indigo-600 text-white shadow-[0_0_10px_rgba(79,70,229,0.6)]'
                      : 'text-white/45 hover:text-white/70',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="self-stretch w-px mx-1 bg-white/10" />
          </>
        )}

        {/* Tool buttons */}
        {filteredTools.map((tool) => {
          const isActive = activeTool === tool.type;
          return (
            <Tooltip key={tool.type} content={<>{tool.label} <span className="ml-1.5 text-[10px] font-mono opacity-50">{tool.shortcut}</span></>} side="bottom">
              <button
                onClick={() => setTool(tool.type)}
                className={cn(
                  'w-8 h-8 flex items-center justify-center rounded-full transition-all',
                  isActive
                    ? 'bg-indigo-500/25 text-indigo-300 shadow-[0_0_0_2px_#4f46e5,0_0_12px_rgba(79,70,229,0.5)]'
                    : 'text-white/55 hover:bg-white/[0.08] hover:text-white',
                )}
              >
                <tool.Icon className="w-4 h-4" />
              </button>
            </Tooltip>
          );
        })}

        {/* Brush size control */}
        {activeTool === 'brush' && (
          <>
            <div className="self-stretch w-px mx-1 bg-white/10" />
            <div className="flex items-center gap-2 px-1">
              <Paintbrush className="w-3 h-3 text-white/40 shrink-0" />
              <Slider
                value={brushSize}
                onValueChange={setBrushSize}
                min={5}
                max={100}
                variant="dark"
                className="w-20"
                aria-label="Brush size"
              />
              <span className="text-xs font-mono tabular-nums w-6 text-right text-white/40">
                {brushSize}
              </span>
            </div>
          </>
        )}

        {/* Magic wand tolerance */}
        {activeTool === 'magic-wand' && (
          <>
            <div className="self-stretch w-px mx-1 bg-white/10" />
            <div className="flex items-center gap-2 px-1">
              <span className="text-[10px] text-white/40">TOL</span>
              <Slider
                value={tolerance}
                onValueChange={setTolerance}
                min={0}
                max={100}
                variant="dark"
                className="w-20"
                aria-label="Tolerance"
              />
              <span className="text-xs font-mono tabular-nums w-6 text-right text-white/40">
                {tolerance}
              </span>
            </div>
            {opencvLoaded && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium">CV</span>
            )}
            <span className="text-[10px] px-2 rounded py-0.5 text-white/25 bg-white/5 whitespace-nowrap">
              Shift + Alt
            </span>
          </>
        )}

        {/* Zoom controls */}
        <div className="self-stretch w-px mx-1 bg-white/10" />
        <div className="flex items-center">
          <button
            onClick={onZoomOut}
            className="w-7 h-7 flex items-center justify-center rounded-full text-white/55 hover:bg-white/[0.08] hover:text-white transition-colors"
            title="Zoom out (-)"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onResetZoom}
            className="px-2 h-7 flex items-center justify-center rounded text-xs font-mono tabular-nums text-white/45 hover:bg-white/[0.08] hover:text-white transition-colors min-w-[44px]"
            title="Reset zoom (0)"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={onZoomIn}
            className="w-7 h-7 flex items-center justify-center rounded-full text-white/55 hover:bg-white/[0.08] hover:text-white transition-colors"
            title="Zoom in (+)"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

      </Island>
    </TooltipProvider>
  );
}
