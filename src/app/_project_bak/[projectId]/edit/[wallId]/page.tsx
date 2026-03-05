'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Columns2, Loader2, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/stores/project-store';
import { useEditorStore } from '@/stores/editor-store';
import { loadOpenCV } from '@/lib/cv/opencv-loader';
import { Toolbar } from '@/components/editor/toolbar';
import { WallCanvas } from '@/components/editor/wall-canvas';
import type { WallCanvasHandle } from '@/components/editor/wall-canvas';
import { FillPanel } from '@/components/editor/fill-panel';
import { LayersPanel } from '@/components/editor/layers-panel';
import { MockupSwitcher } from '@/components/editor/mockup-switcher';
import { CropPanel } from '@/components/editor/crop-panel';
import type { Region, RegionFill, BlendMode, WallTransform } from '@/lib/types';

type EditorTab = 'crop' | 'edit';

export default function EditWallPage() {
  const { projectId, wallId } = useParams<{ projectId: string; wallId: string }>();
  const router = useRouter();
  const {
    project,
    loading,
    saving,
    loadProject,
    updateMockupRegions,
    addMockup,
    addMural,
    updateWallTransform,
  } = useProjectStore();
  const { selectedRegionId, selectRegion, pushUndo, undo, redo, setTool, editorMode, setEditorMode, setOpencvLoaded } =
    useEditorStore();
  const [activeMockupId, setActiveMockupId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EditorTab>('edit');
  const canvasRef = useRef<WallCanvasHandle>(null);
  const [zoom, setZoom] = useState(1);
  const [showPreview, setShowPreview] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  const wall = project?.walls.find((w) => w.id === wallId);
  const mockup = wall?.mockups.find((m) => m.id === activeMockupId) || wall?.mockups[0];

  useEffect(() => {
    loadProject(projectId);
  }, [projectId, loadProject]);

  useEffect(() => {
    if (wall && !activeMockupId && wall.mockups.length > 0) {
      setActiveMockupId(wall.mockups[0].id);
    }
  }, [wall, activeMockupId]);

  // Lazy-load OpenCV.js WASM
  useEffect(() => {
    loadOpenCV()
      .then(() => setOpencvLoaded(true))
      .catch(() => {/* fallback to floodFill */});
  }, [setOpencvLoaded]);

  // Refresh preview after save completes
  const prevSaving = useRef(saving);
  useEffect(() => {
    if (prevSaving.current && !saving && showPreview) {
      // saving just finished — bump preview key to reload render
      setPreviewKey((k) => k + 1);
    }
    prevSaving.current = saving;
  }, [saving, showPreview]);

  // Sync editor mode from mockup
  useEffect(() => {
    if (mockup?.mode && mockup.mode !== editorMode) {
      setEditorMode(mockup.mode);
    }
  }, [mockup?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (activeTab !== 'edit') return;

      if (e.key === 'v' || e.key === 'V') setTool('select');
      if (e.key === 'r' || e.key === 'R') setTool('rectangle');
      if (e.key === 'p' || e.key === 'P') setTool('polygon');
      if (e.key === 'b' || e.key === 'B') setTool('brush');
      if (e.key === 'm' || e.key === 'M') setTool('magic-wand');
      if (e.key === 'w' || e.key === 'W') setTool('whole-wall');
      if (e.key === 'h' || e.key === 'H') setTool('pan');
      if (e.key === 'q' || e.key === 'Q') setTool('quad');

      if (e.key === '+' || e.key === '=') {
        canvasRef.current?.zoomIn();
        setZoom(canvasRef.current?.getZoom() ?? 1);
        return;
      }
      if (e.key === '-') {
        canvasRef.current?.zoomOut();
        setZoom(canvasRef.current?.getZoom() ?? 1);
        return;
      }
      if (e.key === '0' && !e.metaKey && !e.ctrlKey) {
        canvasRef.current?.resetZoom();
        setZoom(1);
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRegionId) {
        handleDeleteRegion(selectedRegionId);
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const snapshot = undo();
        if (snapshot && wall && mockup) {
          updateMockupRegions(wallId, mockup.id, snapshot.regions);
        }
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        const snapshot = redo();
        if (snapshot && wall && mockup) {
          updateMockupRegions(wallId, mockup.id, snapshot.regions);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedRegionId, wall, mockup, wallId, setTool, undo, redo, updateMockupRegions, activeTab]);

  const regions = mockup?.regions || [];

  const handleRegionsChange = useCallback(
    (newRegions: Region[]) => {
      if (!wall || !mockup) return;
      pushUndo({ regions });
      updateMockupRegions(wallId, mockup.id, newRegions);
    },
    [regions, pushUndo, wall, mockup, wallId, updateMockupRegions]
  );

  const selectedRegion = regions.find((r) => r.id === selectedRegionId) || null;

  const handleFillChange = (fill: RegionFill) => {
    if (!selectedRegion) return;
    const updated = regions.map((r) => (r.id === selectedRegion.id ? { ...r, fill } : r));
    handleRegionsChange(updated);
  };

  const handleOpacityChange = (opacity: number) => {
    if (!selectedRegion) return;
    const updated = regions.map((r) => (r.id === selectedRegion.id ? { ...r, opacity } : r));
    handleRegionsChange(updated);
  };

  const handleBlendModeChange = (blendMode: BlendMode) => {
    if (!selectedRegion) return;
    const updated = regions.map((r) => (r.id === selectedRegion.id ? { ...r, blendMode } : r));
    handleRegionsChange(updated);
  };

  const handleToggleVisibility = (id: string) => {
    const updated = regions.map((r) => (r.id === id ? { ...r, visible: !r.visible } : r));
    handleRegionsChange(updated);
  };

  const handleToggleLock = (id: string) => {
    const updated = regions.map((r) => (r.id === id ? { ...r, locked: !r.locked } : r));
    handleRegionsChange(updated);
  };

  const handleDeleteRegion = (id: string) => {
    const updated = regions.filter((r) => r.id !== id);
    handleRegionsChange(updated);
    if (selectedRegionId === id) selectRegion(null);
  };

  const handleReorder = (id: string, direction: 'up' | 'down') => {
    const sorted = [...regions].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((r) => r.id === id);
    if (direction === 'up' && idx < sorted.length - 1) {
      const temp = sorted[idx].order;
      sorted[idx].order = sorted[idx + 1].order;
      sorted[idx + 1].order = temp;
    } else if (direction === 'down' && idx > 0) {
      const temp = sorted[idx].order;
      sorted[idx].order = sorted[idx - 1].order;
      sorted[idx - 1].order = temp;
    }
    handleRegionsChange(sorted);
  };

  const handleRename = (id: string, name: string) => {
    if (!wall || !mockup) return;
    const updated = regions.map((r) => (r.id === id ? { ...r, name } : r));
    updateMockupRegions(wallId, mockup.id, updated);
  };

  const handleCreateMockup = async () => {
    if (!wall) return;
    const m = await addMockup(wallId);
    setActiveMockupId(m.id);
  };

  const handleCloneMockup = async (id: string) => {
    if (!wall) return;
    const m = await addMockup(wallId, undefined, id);
    setActiveMockupId(m.id);
  };

  const handleUploadMural = async (file: File) => {
    await addMural(file);
  };

  const handleTransformChange = (transform: WallTransform) => {
    updateWallTransform(wallId, transform);
  };

  if (loading || !project || !wall) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[var(--editor-surface)]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          <span className="text-sm font-medium text-white/50">
            Loading editor...
          </span>
        </div>
      </div>
    );
  }

  const imageUrl = `/api/projects/${projectId}/walls/${wallId}/image`;

  return (
    <div className="fixed inset-0 flex flex-col bg-[var(--editor-surface)]">

      {/* Top bar */}
      <header className="flex items-center justify-between px-4 shrink-0 z-20 h-12 bg-[#0f0f1a] border-b border-white/[0.07]">
        {/* Left: back + title */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => router.push(`/project/${projectId}`)}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-white/45 hover:bg-white/[0.07] transition-colors"
            title="Back to project"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold truncate text-white/90">
              {wall.name}
            </span>
            <span className="text-white/20">/</span>
            <span className="text-xs truncate text-white/40">
              {project.name}
            </span>
          </div>
        </div>

        {/* Center: tab toggle */}
        <div className="flex items-center rounded-full p-0.5 bg-white/[0.07]">
          {(['crop', 'edit'] as EditorTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-1 rounded-full text-xs font-medium capitalize transition-all',
                activeTab === tab
                  ? 'bg-indigo-600 text-white shadow-[0_0_12px_rgba(79,70,229,0.5)]'
                  : 'text-white/45 hover:text-white/70',
              )}
            >
              {tab === 'crop' ? 'Crop' : 'Edit'}
            </button>
          ))}
        </div>

        {/* Right: saving + compare */}
        <div className="flex items-center gap-3">
          {saving && (
            <span className="flex items-center gap-1.5 text-xs text-white/40">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse" />
              Saving
            </span>
          )}
          <button
            onClick={() => setShowPreview((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
              showPreview
                ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500/30'
                : 'bg-white/[0.07] text-white/70 border-white/10 hover:bg-white/[0.12] hover:text-white',
            )}
            title="Toggle live preview"
          >
            {showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            Preview
          </button>
          <button
            onClick={() => router.push(`/project/${projectId}/wall/${wallId}/compare`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.07] text-white/70 border border-white/10 hover:bg-white/[0.12] hover:text-white transition-all"
          >
            <Columns2 className="w-3 h-3" />
            Compare
          </button>
        </div>
      </header>

      {/* Body */}
      {activeTab === 'crop' ? (
        <CropPanel
          imageUrl={imageUrl}
          transform={wall.transform || { cropX: 0, cropY: 0, cropW: 1, cropH: 1, rotation: 0 }}
          onTransformChange={handleTransformChange}
          onDone={() => setActiveTab('edit')}
        />
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Mockup switcher strip */}
          <MockupSwitcher
            mockups={wall.mockups.map((m) => ({ id: m.id, name: m.name }))}
            activeId={activeMockupId || wall.mockups[0]?.id || ''}
            onSelect={setActiveMockupId}
            onCreate={handleCreateMockup}
            onClone={handleCloneMockup}
          />

          {/* Editor body */}
          <div className="flex-1 flex overflow-hidden relative">

            {/* Left sidebar */}
            <FillPanel
              fill={selectedRegion?.fill || null}
              opacity={selectedRegion?.opacity ?? 1}
              blendMode={selectedRegion?.blendMode || 'normal'}
              murals={project.murals}
              projectId={projectId}
              onFillChange={handleFillChange}
              onOpacityChange={handleOpacityChange}
              onBlendModeChange={handleBlendModeChange}
              onUploadMural={handleUploadMural}
            />

            {/* Canvas area with floating toolbar */}
            <div className="flex-1 relative overflow-hidden flex flex-col">
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
                <Toolbar
                  zoom={zoom}
                  mode={editorMode}
                  onModeChange={(mode) => {
                    setEditorMode(mode);
                  }}
                  onZoomIn={() => {
                    canvasRef.current?.zoomIn();
                    setZoom(canvasRef.current?.getZoom() ?? 1);
                  }}
                  onZoomOut={() => {
                    canvasRef.current?.zoomOut();
                    setZoom(canvasRef.current?.getZoom() ?? 1);
                  }}
                  onResetZoom={() => {
                    canvasRef.current?.resetZoom();
                    setZoom(1);
                  }}
                />
              </div>

              <WallCanvas
                ref={canvasRef}
                imageUrl={imageUrl}
                regions={regions}
                onRegionsChange={handleRegionsChange}
                projectId={projectId}
              />
            </div>

            {/* Live preview thumbnail */}
            {showPreview && mockup && (
              <div className="absolute bottom-4 right-[260px] z-20 w-48 rounded-xl overflow-hidden shadow-2xl border border-white/10 bg-black/60 backdrop-blur">
                <div className="px-2.5 py-1.5 flex items-center justify-between border-b border-white/10">
                  <span className="text-[10px] text-white/50 font-medium uppercase tracking-wider">Preview</span>
                  {saving && <Loader2 className="w-3 h-3 text-indigo-400 animate-spin" />}
                </div>
                <img
                  key={previewKey}
                  src={`/api/projects/${projectId}/walls/${wallId}/mockups/${mockup.id}/render?t=${previewKey}`}
                  alt="Live preview"
                  className="w-full aspect-[4/3] object-contain bg-black/40"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = imageUrl;
                  }}
                />
              </div>
            )}

            {/* Right sidebar */}
            <LayersPanel
              regions={regions}
              selectedId={selectedRegionId}
              onSelect={selectRegion}
              onToggleVisibility={handleToggleVisibility}
              onToggleLock={handleToggleLock}
              onDelete={handleDeleteRegion}
              onReorder={handleReorder}
              onRename={handleRename}
            />
          </div>
        </div>
      )}
    </div>
  );
}
