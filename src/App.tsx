import { useState, useEffect, useCallback, useRef } from 'react';
import { FolderOpen, Plus, Trash2, Check, Loader2 } from 'lucide-react';
import { saveProject, loadProject, listProjects, deleteProject, type ProjectData } from '@/lib/db';
import { generateThumb } from '@/lib/image-cache';
import { GalleryTab } from '@/components/gallery-tab';
import { WallsTab } from '@/components/walls-tab';
import { MuralsTab } from '@/components/murals-tab';
import { PresentTab } from '@/components/present-tab';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Corner { x: number; y: number }

interface MuralPlacement {
  id: string;
  file: File;
  thumbUrl: string;
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation?: number;
  comment: string;
  liked?: boolean;
}

interface Wall {
  id: string;
  file: File;
  thumbUrl: string;
  blob: Blob;
  crop?: { x: number; y: number; w: number; h: number };
  quad?: [Corner, Corner, Corner, Corner];
  murals: MuralPlacement[];
}

export type { Wall, MuralPlacement, Corner };

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
  const [selectedIdx, setSelectedIdx] = useState(0);
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
    (name: string, w: Wall[]) => {
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
            corners: wall.quad,
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
    debouncedSave(projectName, walls);
  }, [projectName, walls, mode, debouncedSave]);

  /* ---- open existing project ---- */
  const openProject = useCallback(async (name: string) => {
    try {
      setProjectName(name);
      localStorage.setItem(LAST_PROJECT_KEY, name);

      const data = await loadProject(name);
      if (data && data.walls.length > 0) {
        // Restore walls with empty thumbs first, then generate progressively
        const restored: Wall[] = data.walls.map(w => ({
          id: w.id,
          file: new File([w.blob], `${w.id}.jpg`, { type: w.blob.type || 'image/jpeg' }),
          thumbUrl: '',
          blob: w.blob,
          quad: w.corners,
          murals: [],
        }));
        setWalls(restored);
        setSelectedIdx(0);

        // Generate thumbnails progressively
        for (let i = 0; i < restored.length; i++) {
          try {
            const url = await generateThumb(restored[i].blob);
            setWalls(prev =>
              prev.map((w, idx) => (idx === i ? { ...w, thumbUrl: url } : w)),
            );
          } catch {
            // thumb generation failed — leave blank
          }
        }
      } else {
        setWalls([]);
        setSelectedIdx(0);
      }
    } catch (err) {
      console.warn('Failed to load project:', err);
      setWalls([]);
      setSelectedIdx(0);
    }

    setActiveTab('gallery');
    setMode('workspace');
  }, []);

  /* ---- create new project ---- */
  const createProject = useCallback((name: string) => {
    setProjectName(name);
    setWalls([]);
    setSelectedIdx(0);
    localStorage.setItem(LAST_PROJECT_KEY, name);
    setActiveTab('gallery');
    setMode('workspace');
  }, []);

  /* ---- back to project list ---- */
  const handleBackToProjects = useCallback(() => {
    setMode('select');
    setWalls([]);
    setProjectName('');
    setSelectedIdx(0);
    setActiveTab('gallery');
  }, []);

  /* ---- walls change handler (for child tabs) ---- */
  const handleWallsChange = useCallback((newWalls: Wall[]) => {
    setWalls(newWalls);
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
        <nav className="flex items-center gap-1">
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

        {/* Right: save indicator + project name + back */}
        <div className="flex items-center gap-3">
          {/* Save status */}
          <div className="flex items-center gap-1.5 text-[12px]">
            {saveStatus === 'saving' && (
              <span className="flex items-center gap-1 text-slate-400">
                <Loader2 className="w-3 h-3 animate-spin" />
                Saving...
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="flex items-center gap-1 text-emerald-500">
                <Check className="w-3 h-3" />
                Saved
              </span>
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
