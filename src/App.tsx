import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { FolderOpen, Plus, Trash2, Check, Loader2, Download, Upload, Undo2, Redo2 } from 'lucide-react';
import { saveProject, loadProject, listProjects, deleteProject, type ProjectData, type MuralEntry } from '@/lib/db';
import { generateThumb, preloadAll } from '@/lib/image-cache';
import { exportProject, importProject } from '@/lib/project-file';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeFile, readFile } from '@tauri-apps/plugin-fs';
import { GalleryTab } from '@/components/gallery-tab';
import { WallsTab } from '@/components/walls-tab';
import { MuralsTab } from '@/components/murals-tab';
import { PresentTab } from '@/components/present-tab';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Corner { x: number; y: number }

interface QuadSurface {
  id: string;
  corners: [Corner, Corner, Corner, Corner];
  label?: string;
  linkId?: string;
  murals: MuralPlacement[];
}

interface MuralPoolEntry {
  id: string;
  file: File;
  blob: Blob;
  thumbUrl: string;
}

interface MuralPlacement {
  id: string;
  muralPoolId: string;
  file: File;
  thumbUrl: string;
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation?: number;
  rotationLocked?: boolean;
  opacity?: number;
  blendMode?: GlobalCompositeOperation;
  clipLeft?: number;
  clipRight?: number;
  clipTop?: number;
  clipBottom?: number;
  comment: string;
  liked?: boolean;
}

interface Wall {
  id: string;
  file: File;
  thumbUrl: string;
  blob: Blob;
  crop?: { x: number; y: number; w: number; h: number };
  quads: QuadSurface[];
}

export type { Wall, MuralPlacement, Corner, QuadSurface, MuralPoolEntry };

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

type Tab = 'gallery' | 'walls' | 'murals' | 'present';
type Mode = 'select' | 'workspace';

const LAST_PROJECT_KEY = 'mural-mapper-last-project';
const SAVE_DEBOUNCE_MS = 800;

const TABS: { key: Tab; label: string; needsWalls: boolean }[] = [
  { key: 'gallery', label: 'Gallery', needsWalls: false },
  { key: 'walls', label: 'Walls', needsWalls: true },
  { key: 'murals', label: 'Murals', needsWalls: true },
  { key: 'present', label: 'Present', needsWalls: true },
];

/* ------------------------------------------------------------------ */
/*  Logo SVG                                                           */
/* ------------------------------------------------------------------ */

function LogoIcon() {
  return (
    <div className="w-[30px] h-[30px] rounded-lg gradient-primary flex items-center justify-center shrink-0 shadow-[0_2px_8px_rgba(79,70,229,0.35)]">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="5.5" height="5.5" rx="1.5" fill="white" opacity="0.9" />
        <rect x="8.5" y="2" width="5.5" height="5.5" rx="1.5" fill="white" opacity="0.6" />
        <rect x="2" y="8.5" width="5.5" height="5.5" rx="1.5" fill="white" opacity="0.6" />
        <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1.5" fill="white" opacity="0.9" />
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Project Select Screen                                              */
/* ------------------------------------------------------------------ */

function ProjectSelectScreen({
  onSelect,
  onCreate,
}: {
  onSelect: (name: string) => void;
  onCreate: (name: string) => void;
}) {
  const [projects, setProjects] = useState<string[]>([]);
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    listProjects().then(p => {
      setProjects(p);
      setLoading(false);
    });
  }, []);

  const handleCreate = () => {
    const name = newName.trim() || `Project ${projects.length + 1}`;
    onCreate(name);
  };

  const handleDelete = async (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteProject(name);
    setProjects(prev => prev.filter(p => p !== name));
    if (localStorage.getItem(LAST_PROJECT_KEY) === name) {
      localStorage.removeItem(LAST_PROJECT_KEY);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--bg-base)]">
      <div className="w-full max-w-md mx-auto px-6 animate-fade-in">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <FolderOpen className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-800">Select a Project</h1>
          <p className="text-sm text-slate-400 mt-1">
            Open an existing project or create a new one
          </p>
        </div>

        {/* New project input */}
        <div className="flex gap-2 mb-6">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            placeholder="New project name..."
            className="flex-1 px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            autoFocus
          />
          <button
            onClick={handleCreate}
            className="px-4 py-2.5 rounded-lg bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            New
          </button>
        </div>

        {/* Existing projects list */}
        {loading ? (
          <div className="text-center py-8">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : projects.length > 0 ? (
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1 mb-2">
              Recent Projects
            </div>
            {projects.map(name => {
              const isOpening = opening === name;
              return (
                <div
                  key={name}
                  onClick={() => {
                    if (!opening) {
                      setOpening(name);
                      onSelect(name);
                    }
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all group text-left ${
                    isOpening
                      ? 'border-indigo-400 bg-indigo-50 cursor-wait'
                      : opening
                        ? 'border-slate-200 opacity-50 cursor-not-allowed'
                        : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 cursor-pointer'
                  }`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !opening) {
                      setOpening(name);
                      onSelect(name);
                    }
                  }}
                >
                  <div className="flex items-center gap-3">
                    {isOpening ? (
                      <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
                    ) : (
                      <FolderOpen className="w-4 h-4 text-slate-400 group-hover:text-indigo-500" />
                    )}
                    <span className="text-sm font-medium text-slate-700">{name}</span>
                    {isOpening && (
                      <span className="text-xs text-indigo-400">Opening...</span>
                    )}
                  </div>
                  {!opening && (
                    <button
                      onClick={e => handleDelete(name, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-100 text-slate-400 hover:text-red-500 transition-all"
                      title="Delete project"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-center text-sm text-slate-400 py-4">No projects yet</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */

export default function App() {
  const [mode, setMode] = useState<Mode>('select');
  const [activeTab, setActiveTab] = useState<Tab>('gallery');
  const [projectName, setProjectName] = useState('');
  const [walls, setWalls] = useState<Wall[]>([]);
  const [muralPool, setMuralPool] = useState<MuralPoolEntry[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [undoStack, setUndoStack] = useState<Wall[][]>([]);
  const [redoStack, setRedoStack] = useState<Wall[][]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  /* ---- keep selectedIdx in bounds ---- */
  useEffect(() => {
    if (walls.length === 0) {
      setSelectedIdx(0);
    } else if (selectedIdx >= walls.length) {
      setSelectedIdx(walls.length - 1);
    }
  }, [walls.length, selectedIdx]);

  /* ---- debounced auto-save ---- */
  const debouncedSave = useCallback(
    (name: string, w: Wall[], pool: MuralPoolEntry[]) => {
      if (!name) return;
      clearTimeout(saveTimer.current);
      setSaveStatus('saving');
      saveTimer.current = setTimeout(async () => {
        localStorage.setItem(LAST_PROJECT_KEY, name);
        const data: ProjectData = {
          name,
          walls: w.map(wall => ({
            id: wall.id,
            blob: wall.blob,
            quads: wall.quads.map(q => ({
              id: q.id,
              corners: q.corners,
              label: q.label,
              linkId: q.linkId,
              murals: q.murals.map(m => ({
                id: m.id,
                muralPoolId: m.muralPoolId,
                blob: m.file as Blob,
                scale: m.scale,
                offsetX: m.offsetX,
                offsetY: m.offsetY,
                rotation: m.rotation ?? 0,
                rotationLocked: m.rotationLocked ?? false,
                opacity: m.opacity ?? 1,
                blendMode: m.blendMode ?? 'source-over',
                clipLeft: m.clipLeft ?? 0,
                clipRight: m.clipRight ?? 0,
                clipTop: m.clipTop ?? 0,
                clipBottom: m.clipBottom ?? 0,
                comment: m.comment,
                liked: m.liked ?? false,
              })),
            })),
          })),
          muralPool: pool.map(p => ({
            id: p.id,
            blob: p.blob,
          })),
        };
        try {
          await saveProject(data);
          setSaveStatus('saved');
          clearTimeout(savedTimer.current);
          savedTimer.current = setTimeout(() => setSaveStatus('idle'), 2000);
        } catch (e) {
          console.warn('Auto-save failed:', e);
          setSaveStatus('idle');
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [],
  );

  useEffect(() => {
    if (mode !== 'workspace' || !projectName) return;
    debouncedSave(projectName, walls, muralPool);
  }, [projectName, walls, muralPool, mode, debouncedSave]);

  /* ---- background preload all images when idle ---- */
  useEffect(() => {
    if (mode !== 'workspace') return;
    const allFiles: (File | Blob)[] = [
      ...walls.map(w => w.blob),
      ...walls.flatMap(w => w.quads.flatMap(q => q.murals.map(m => m.file))),
      ...muralPool.map(p => p.blob),
    ];
    if (allFiles.length === 0) return;
    const cancel = preloadAll(allFiles);
    return cancel;
  }, [mode, walls, muralPool]);

  /* ---- open existing project ---- */
  const openProject = useCallback(async (name: string) => {
    try {
      setProjectName(name);
      localStorage.setItem(LAST_PROJECT_KEY, name);

      const data = await loadProject(name);
      if (data && data.walls.length > 0) {
        // Helper to migrate old clip fields on a mural entry
        function migrateClip(m: { clipMode?: string; clipInset?: number; clipLeft?: number; clipRight?: number; clipTop?: number; clipBottom?: number }) {
          if (m.clipMode && m.clipMode !== 'none' && !m.clipLeft && !m.clipRight && !m.clipTop && !m.clipBottom) {
            const inset = m.clipInset ?? 0.15;
            if (m.clipMode === 'horizontal') {
              m.clipLeft = inset;
              m.clipRight = inset;
            } else if (m.clipMode === 'vertical') {
              m.clipTop = inset;
              m.clipBottom = inset;
            } else if (m.clipMode === 'rect') {
              m.clipLeft = inset;
              m.clipRight = inset;
              m.clipTop = inset;
              m.clipBottom = inset;
            }
          }
        }

        // Helper to restore a MuralEntry to a MuralPlacement
        function restoreMural(m: MuralEntry): MuralPlacement {
          migrateClip(m);
          return {
            id: m.id,
            muralPoolId: (m as { muralPoolId?: string }).muralPoolId ?? m.id,
            file: new File([m.blob], `${m.id}.jpg`, { type: m.blob.type || 'image/jpeg' }),
            thumbUrl: '',
            scale: m.scale,
            offsetX: m.offsetX,
            offsetY: m.offsetY,
            rotation: m.rotation,
            rotationLocked: (m as { rotationLocked?: boolean }).rotationLocked ?? false,
            opacity: m.opacity,
            blendMode: m.blendMode as GlobalCompositeOperation,
            clipLeft: (m as { clipLeft?: number }).clipLeft ?? 0,
            clipRight: (m as { clipRight?: number }).clipRight ?? 0,
            clipTop: (m as { clipTop?: number }).clipTop ?? 0,
            clipBottom: (m as { clipBottom?: number }).clipBottom ?? 0,
            comment: m.comment,
            liked: m.liked,
          };
        }

        // Restore walls with migration from old format
        const restored: Wall[] = data.walls.map(w => {
          // MIGRATION: old format had corners + murals on wall, new format uses quads array
          let quads: QuadSurface[];
          const wAny = w as typeof w & { quads?: Array<{ id: string; corners: [Corner, Corner, Corner, Corner]; label?: string; linkId?: string; murals: typeof w.murals }> };
          if (wAny.quads && wAny.quads.length > 0) {
            // New format
            quads = wAny.quads.map(q => ({
              id: q.id,
              corners: q.corners,
              label: q.label,
              linkId: q.linkId,
              murals: (q.murals ?? []).map(m => restoreMural(m as any)),
            }));
          } else if (w.corners) {
            // Old format: single quad + murals on wall
            quads = [{
              id: crypto.randomUUID(),
              corners: w.corners,
              murals: (w.murals ?? []).map(m => restoreMural(m)),
            }];
          } else {
            quads = [];
          }

          return {
            id: w.id,
            file: new File([w.blob], `${w.id}.jpg`, { type: w.blob.type || 'image/jpeg' }),
            thumbUrl: '',
            blob: w.blob,
            quads,
          };
        });

        // Restore mural pool
        const restoredPool: MuralPoolEntry[] = (data.muralPool ?? []).map(p => ({
          id: p.id,
          file: new File([p.blob], `${p.id}.jpg`, { type: p.blob.type || 'image/jpeg' }),
          blob: p.blob,
          thumbUrl: '',
        }));

        setWalls(restored);
        setMuralPool(restoredPool);
        setSelectedIdx(0);

        // Generate thumbnails progressively (walls + murals in quads)
        for (let i = 0; i < restored.length; i++) {
          try {
            const url = await generateThumb(restored[i].blob);
            setWalls(prev =>
              prev.map((w, idx) => (idx === i ? { ...w, thumbUrl: url } : w)),
            );
            // Generate mural thumbs for this wall's quads
            for (let qi = 0; qi < restored[i].quads.length; qi++) {
              for (let mi = 0; mi < restored[i].quads[qi].murals.length; mi++) {
                const mUrl = await generateThumb(restored[i].quads[qi].murals[mi].file);
                setWalls(prev =>
                  prev.map((w, idx) => {
                    if (idx !== i) return w;
                    const quads = [...w.quads];
                    const quad = { ...quads[qi] };
                    const murals = [...quad.murals];
                    murals[mi] = { ...murals[mi], thumbUrl: mUrl };
                    quad.murals = murals;
                    quads[qi] = quad;
                    return { ...w, quads };
                  }),
                );
              }
            }
          } catch {
            // thumb generation failed — leave blank
          }
        }

        // Generate mural pool thumbnails
        for (let pi = 0; pi < restoredPool.length; pi++) {
          try {
            const url = await generateThumb(restoredPool[pi].blob);
            setMuralPool(prev =>
              prev.map((p, idx) => (idx === pi ? { ...p, thumbUrl: url } : p)),
            );
          } catch {
            // thumb generation failed
          }
        }
      } else {
        setWalls([]);
        setMuralPool([]);
        setSelectedIdx(0);
      }
    } catch (err) {
      console.warn('Failed to load project:', err);
      setWalls([]);
      setMuralPool([]);
      setSelectedIdx(0);
    }

    setActiveTab('gallery');
    setMode('workspace');
  }, []);

  /* ---- create new project ---- */
  const createProject = useCallback((name: string) => {
    setProjectName(name);
    setWalls([]);
    setMuralPool([]);
    setSelectedIdx(0);
    localStorage.setItem(LAST_PROJECT_KEY, name);
    setActiveTab('gallery');
    setMode('workspace');
  }, []);

  /* ---- back to project list ---- */
  const handleBackToProjects = useCallback(() => {
    setMode('select');
    setWalls([]);
    setMuralPool([]);
    setUndoStack([]);
    setRedoStack([]);
    setProjectName('');
    setSelectedIdx(0);
    setActiveTab('gallery');
  }, []);

  /* ---- sync murals across linked quads ---- */
  /**
   * When a quad's murals change, propagate to all other quads sharing the same linkId.
   * Mural files are shared by reference; per-quad placement is synced.
   * Preserves existing transforms for murals that already exist (match by muralPoolId).
   */
  const syncLinkedMurals = useCallback(
    (incoming: Wall[], changedIdx?: number): Wall[] => {
      if (changedIdx === undefined) return incoming;

      const changedWall = incoming[changedIdx];
      if (!changedWall) return incoming;

      // Find all quads in the changed wall that have a linkId
      const linkedQuads = changedWall.quads.filter(q => q.linkId);
      if (linkedQuads.length === 0) return incoming;

      const result = [...incoming];

      for (const sourceQuad of linkedQuads) {
        const linkId = sourceQuad.linkId!;
        // Find all other quads with the same linkId across all walls
        for (let wi = 0; wi < result.length; wi++) {
          const wall = result[wi];
          let wallChanged = false;
          const newQuads = wall.quads.map(q => {
            if (q.id === sourceQuad.id) return q; // skip source itself
            if (q.linkId !== linkId) return q;

            // Sync: copy mural list, preserving existing transforms per muralPoolId
            const existingByPoolId = new Map(q.murals.map(m => [m.muralPoolId, m]));
            const syncedMurals = sourceQuad.murals.map(sm => {
              const existing = existingByPoolId.get(sm.muralPoolId);
              if (existing) return existing; // preserve existing transforms
              return { ...sm, id: crypto.randomUUID().slice(0, 8) }; // new mural, copy from source
            });
            wallChanged = true;
            return { ...q, murals: syncedMurals };
          });
          if (wallChanged) {
            result[wi] = { ...wall, quads: newQuads };
          }
        }
      }

      return result;
    },
    [],
  );

  /* ---- walls change handler (for child tabs) ---- */
  const handleWallsChange = useCallback((newWalls: Wall[], changedIdx?: number) => {
    setUndoStack(prev => {
      const next = [...prev, walls];
      if (next.length > 50) next.shift();
      return next;
    });
    setRedoStack([]);
    setWalls(syncLinkedMurals(newWalls, changedIdx));
  }, [syncLinkedMurals, walls]);

  /* ---- undo / redo ---- */
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(s => s.slice(0, -1));
    setRedoStack(s => [...s, walls]);
    setWalls(prev);
  }, [undoStack, walls]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack(s => s.slice(0, -1));
    setUndoStack(s => [...s, walls]);
    setWalls(next);
  }, [redoStack, walls]);

  /* ---- project file export ---- */
  const handleExportProject = useCallback(async () => {
    try {
      const zipBytes = await exportProject(projectName, walls, muralPool);
      let filePath: string | null = null;
      try {
        filePath = await save({
          defaultPath: `${projectName || 'project'}.mmp`,
          filters: [{ name: 'Mural Mapper Project', extensions: ['mmp'] }],
        });
      } catch {
        // dialog not available — fallback to browser download
      }
      if (filePath) {
        await writeFile(filePath, zipBytes);
      } else {
        // Browser fallback
        const blob = new Blob([zipBytes as BlobPart], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${projectName || 'project'}.mmp`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Export failed:', err);
    }
  }, [projectName, walls, muralPool]);

  /* ---- global keyboard shortcuts for undo/redo/save ---- */
  useEffect(() => {
    if (mode !== 'workspace') return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        ((e.key === 'z' && e.shiftKey) || e.key === 'y')
      ) {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        handleExportProject();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, handleUndo, handleRedo, handleExportProject]);

  /* ---- project file import ---- */
  const handleImportProject = useCallback(async () => {
    try {
      let fileBytes: Uint8Array | null = null;
      try {
        const selected = await open({
          multiple: false,
          filters: [{ name: 'Mural Mapper Project', extensions: ['mmp'] }],
        });
        if (selected) {
          fileBytes = await readFile(selected as string);
        }
      } catch {
        // dialog not available — fallback to browser file input
        fileBytes = await new Promise<Uint8Array | null>((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.mmp';
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) { resolve(null); return; }
            const buf = await file.arrayBuffer();
            resolve(new Uint8Array(buf));
          };
          input.click();
        });
      }
      if (!fileBytes) return;

      const result = await importProject(fileBytes);
      setProjectName(result.name);
      setWalls(result.walls);
      setMuralPool(result.muralPool);
      setSelectedIdx(result.walls.length > 0 ? 0 : -1);
    } catch (err) {
      console.error('Import failed:', err);
    }
  }, []);

  /* ================================================================ */
  /*  Project select screen                                            */
  /* ================================================================ */

  if (mode === 'select') {
    return <ProjectSelectScreen onSelect={openProject} onCreate={createProject} />;
  }

  /* ================================================================ */
  /*  Workspace                                                        */
  /* ================================================================ */

  const hasWalls = walls.length > 0;

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-base)]">
      {/* Accent bar */}
      <div
        aria-hidden="true"
        className="h-[2px] shrink-0"
        style={{
          background:
            'linear-gradient(90deg, #4f46e5 0%, #7c3aed 50%, #a855f7 100%)',
        }}
      />

      {/* Header */}
      <header className="h-[52px] shrink-0 flex items-center justify-between px-6 border-b border-[var(--border-default)] shadow-xs glass">
        {/* Left: logo + name */}
        <div className="flex items-center gap-2.5 select-none">
          <LogoIcon />
          <span className="text-[15px] font-bold tracking-tight text-[var(--text-primary)]">
            Mural Mapper
          </span>
        </div>

        {/* Center: tab pills */}
        <nav className="flex items-center gap-1" onWheel={(e) => e.stopPropagation()}>
          {TABS.map(tab => {
            const disabled = tab.needsWalls && !hasWalls;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => !disabled && setActiveTab(tab.key)}
                disabled={disabled}
                className={`
                  px-4 py-1.5 rounded-full text-[13px] font-medium transition-all
                  ${active
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : disabled
                      ? 'text-slate-300 cursor-not-allowed'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                  }
                `}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Right: export/import + save indicator + project name + back */}
        <div className="flex items-center gap-3">
          {/* Export / Import */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleImportProject}
              className="flex items-center gap-1 px-2 py-1 text-[12px] text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
              title="Import project (.mmp)"
            >
              <Upload className="w-3.5 h-3.5" />
              Import
            </button>
            <button
              onClick={handleExportProject}
              className="flex items-center gap-1 px-2 py-1 text-[12px] text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
              title="Save project as .mmp file (Ctrl+Shift+S)"
            >
              <Download className="w-3.5 h-3.5" />
              Save As
            </button>
          </div>
          {/* Undo / Redo */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              className="p-1 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>
          {/* Save status */}
          <div className="w-5 flex items-center justify-center">
            {saveStatus === 'saving' && (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
            )}
            {saveStatus === 'saved' && (
              <Check className="w-3.5 h-3.5 text-emerald-500" />
            )}
          </div>
          <input
            type="text"
            value={projectName}
            onChange={e => setProjectName(e.target.value)}
            className="w-36 px-2 py-1 text-[13px] text-slate-600 border border-transparent hover:border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 rounded-md bg-transparent outline-none text-right"
            title="Project name"
          />
          <button
            onClick={handleBackToProjects}
            className="text-[13px] text-slate-400 hover:text-indigo-500 transition-colors whitespace-nowrap"
          >
            &larr; Projects
          </button>
        </div>
      </header>

      {/* Tab content — fills remaining viewport */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'gallery' && (
          <GalleryTab
            walls={walls}
            onWallsChange={handleWallsChange}
            selectedIdx={selectedIdx}
            onSelectIdx={setSelectedIdx}
            muralPool={muralPool}
            onMuralPoolChange={setMuralPool}
          />
        )}

        {/* Walls tab placeholder — uncomment when walls-tab.tsx is ready */}
        {activeTab === 'walls' && (
          <WallsTab
            walls={walls}
            onWallsChange={handleWallsChange}
            selectedIdx={selectedIdx}
            onSelectIdx={setSelectedIdx}
          />
        )}

        {activeTab === 'murals' && (
          <MuralsTab
            walls={walls}
            onWallsChange={handleWallsChange}
            selectedIdx={selectedIdx}
            onSelectIdx={setSelectedIdx}
            muralPool={muralPool}
            onMuralPoolChange={setMuralPool}
          />
        )}

        {activeTab === 'present' && (
          <PresentTab
            walls={walls}
            onWallsChange={handleWallsChange}
          />
        )}
      </div>
    </div>
  );
}
