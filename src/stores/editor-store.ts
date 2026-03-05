import { create } from 'zustand';
import type { ToolType, Region, EditorMode } from '@/lib/types';

interface EditorSnapshot {
  regions: Region[];
}

interface EditorStore {
  activeTool: ToolType;
  editorMode: EditorMode;
  selectedRegionId: string | null;
  brushSize: number;
  tolerance: number;
  zoom: number;
  panX: number;
  panY: number;
  opencvLoaded: boolean;

  undoStack: EditorSnapshot[];
  redoStack: EditorSnapshot[];

  setTool: (tool: ToolType) => void;
  setEditorMode: (mode: EditorMode) => void;
  selectRegion: (id: string | null) => void;
  setBrushSize: (size: number) => void;
  setTolerance: (tolerance: number) => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  setOpencvLoaded: (loaded: boolean) => void;

  pushUndo: (snapshot: EditorSnapshot) => void;
  undo: () => EditorSnapshot | null;
  redo: () => EditorSnapshot | null;
  clearHistory: () => void;
}

const MAX_UNDO = 50;

export const useEditorStore = create<EditorStore>((set, get) => ({
  activeTool: 'select',
  editorMode: 'color',
  selectedRegionId: null,
  brushSize: 20,
  tolerance: 32,
  zoom: 1,
  panX: 0,
  panY: 0,
  opencvLoaded: false,
  undoStack: [],
  redoStack: [],

  setTool: (tool) => set({ activeTool: tool, selectedRegionId: null }),
  setEditorMode: (mode) => set({ editorMode: mode, activeTool: 'select', selectedRegionId: null }),
  selectRegion: (id) => set({ selectedRegionId: id }),
  setBrushSize: (size) => set({ brushSize: size }),
  setTolerance: (tolerance) => set({ tolerance: Math.max(0, Math.min(100, tolerance)) }),
  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(5, zoom)) }),
  setPan: (x, y) => set({ panX: x, panY: y }),
  setOpencvLoaded: (loaded) => set({ opencvLoaded: loaded }),

  pushUndo: (snapshot) => {
    const { undoStack } = get();
    const newStack = [...undoStack, snapshot].slice(-MAX_UNDO);
    set({ undoStack: newStack, redoStack: [] });
  },

  undo: () => {
    const { undoStack, redoStack } = get();
    if (undoStack.length === 0) return null;
    const snapshot = undoStack[undoStack.length - 1];
    set({
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, snapshot],
    });
    return snapshot;
  },

  redo: () => {
    const { redoStack, undoStack } = get();
    if (redoStack.length === 0) return null;
    const snapshot = redoStack[redoStack.length - 1];
    set({
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, snapshot],
    });
    return snapshot;
  },

  clearHistory: () => set({ undoStack: [], redoStack: [] }),
}));
