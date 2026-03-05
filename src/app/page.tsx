'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ProjectStep, type WallItem } from '@/components/project-step';
import { MapStep } from '@/components/map-step';
import { RefineStep } from '@/components/refine-step';
import { saveProject, loadProject, type ProjectData } from '@/lib/db';

type Step = 'project' | 'map' | 'refine';

interface Corner { x: number; y: number }

const LAST_PROJECT_KEY = 'mural-mapper-last-project';

export default function MuralMapper() {
  const [step, setStep] = useState<Step>('project');
  const [projectName, setProjectName] = useState('Untitled Project');
  const [walls, setWalls] = useState<WallItem[]>([]);
  const [artImage, setArtImage] = useState<HTMLImageElement | null>(null);
  const [artSrc, setArtSrc] = useState<string | null>(null);
  const [artBlob, setArtBlob] = useState<Blob | null>(null);
  const [currentWallIdx, setCurrentWallIdx] = useState(0);
  const [corners, setCorners] = useState<[Corner, Corner, Corner, Corner] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Load last project from IndexedDB on mount
  useEffect(() => {
    const name = localStorage.getItem(LAST_PROJECT_KEY) || 'Untitled Project';
    setProjectName(name);
    loadProject(name).then(async (data) => {
      if (!data) { setLoaded(true); return; }
      try {
        // Restore walls with object URLs only — no full image decode
        const restoredWalls: WallItem[] = data.walls.map(w => ({
          id: w.id,
          img: null,
          src: URL.createObjectURL(w.blob),
          blob: w.blob,
          corners: w.corners,
        }));
        setWalls(restoredWalls);
        if (data.artBlob) {
          const src = URL.createObjectURL(data.artBlob);
          const img = new Image();
          img.onload = () => {
            setArtImage(img);
            setArtSrc(src);
            setArtBlob(data.artBlob!);
          };
          img.src = src;
        }
      } catch (e) {
        console.warn('Failed to restore project:', e);
      }
      setLoaded(true);
    });
  }, []);

  // Debounced auto-save
  const debouncedSave = useCallback((name: string, w: WallItem[], ab: Blob | null) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      localStorage.setItem(LAST_PROJECT_KEY, name);
      const data: ProjectData = {
        name,
        walls: w.map(wall => ({ id: wall.id, blob: wall.blob, corners: wall.corners })),
        artBlob: ab ?? undefined,
      };
      saveProject(data).catch(e => console.warn('Save failed:', e));
    }, 800);
  }, []);

  // Save on changes
  useEffect(() => {
    if (!loaded) return;
    debouncedSave(projectName, walls, artBlob);
  }, [projectName, walls, artBlob, loaded, debouncedSave]);

  const handleSelectWall = (idx: number) => {
    setCurrentWallIdx(idx);
    setCorners(walls[idx]?.corners ?? null);
    setStep('map');
  };

  const handleMapComplete = (c: [Corner, Corner, Corner, Corner]) => {
    setCorners(c);
    setWalls(prev => prev.map((w, i) => i === currentWallIdx ? { ...w, corners: c } : w));
    setStep('refine');
  };

  const handleArtChange = (img: HTMLImageElement | null, src: string | null, blob: Blob | null) => {
    setArtImage(img);
    setArtSrc(src);
    setArtBlob(blob);
  };

  if (!loaded) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400">Loading project...</p>
        </div>
      </div>
    );
  }

  if (step === 'project') {
    return (
      <ProjectStep
        projectName={projectName}
        onProjectNameChange={setProjectName}
        walls={walls}
        onWallsChange={setWalls}
        artImage={artImage}
        artSrc={artSrc}
        onArtChange={handleArtChange}
        onSelectWall={handleSelectWall}
        onBackToProjects={() => {}}
      />
    );
  }

  const currentWall = walls[currentWallIdx];
  if (!currentWall || !currentWall.img || !artImage) {
    setStep('project');
    return null;
  }

  if (step === 'map' || !corners) {
    return (
      <MapStep
        wallImage={currentWall.img}
        artImage={artImage}
        initialCorners={currentWall.corners}
        onComplete={handleMapComplete}
        onBack={() => setStep('project')}
      />
    );
  }

  return (
    <RefineStep
      wallImage={currentWall.img}
      artImage={artImage}
      corners={corners}
      onBack={() => {
        setCorners(null);
        setStep('map');
      }}
    />
  );
}
