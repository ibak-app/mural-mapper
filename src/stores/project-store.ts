import { create } from 'zustand';
import type { Project, Wall, Mockup, Region, Mural, WallTransform, FeedbackStatus } from '@/lib/types';

interface ProjectStore {
  project: Project | null;
  loading: boolean;
  error: string | null;
  saving: boolean;

  loadProject: (projectId: string) => Promise<void>;
  updateProject: (updates: Partial<Project>) => Promise<void>;

  addWall: (file: File, name: string) => Promise<Wall>;
  removeWall: (wallId: string) => Promise<void>;
  updateWall: (wallId: string, updates: { name?: string }) => Promise<void>;
  reorderWalls: (wallIds: string[]) => Promise<void>;
  updateWallTransform: (wallId: string, transform: WallTransform) => void;

  addMockup: (wallId: string, name?: string, cloneFrom?: string) => Promise<Mockup>;
  removeMockup: (wallId: string, mockupId: string) => Promise<void>;
  updateMockupRegions: (wallId: string, mockupId: string, regions: Region[]) => void;
  updateFeedback: (wallId: string, mockupId: string, status: FeedbackStatus, comment: string) => void;

  addMural: (file: File) => Promise<Mural>;
  removeMural: (muralId: string) => Promise<void>;
}

// Debounce timers
const debounceTimers: Record<string, NodeJS.Timeout> = {};

function debouncedSave(key: string, delayMs: number, fn: () => Promise<void>) {
  if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
  debounceTimers[key] = setTimeout(() => {
    fn();
    delete debounceTimers[key];
  }, delayMs);
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  loading: false,
  error: null,
  saving: false,

  loadProject: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error('Failed to load project');
      const project = await res.json();
      set({ project, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  updateProject: async (updates) => {
    const { project } = get();
    if (!project) return;
    const optimistic = { ...project, ...updates };
    set({ project: optimistic });
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update');
      const updated = await res.json();
      set({ project: updated });
    } catch {
      set({ project });
    }
  },

  addWall: async (file, name) => {
    const { project } = get();
    if (!project) throw new Error('No project loaded');
    const formData = new FormData();
    formData.append('image', file);
    formData.append('name', name);
    const res = await fetch(`/api/projects/${project.id}/walls`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('Failed to upload wall');
    const wall: Wall = await res.json();
    set({ project: { ...project, walls: [...project.walls, wall] } });
    return wall;
  },

  removeWall: async (wallId) => {
    const { project } = get();
    if (!project) return;
    set({
      project: { ...project, walls: project.walls.filter((w) => w.id !== wallId) },
    });
    await fetch(`/api/projects/${project.id}/walls/${wallId}`, { method: 'DELETE' });
  },

  updateWall: async (wallId, updates) => {
    const { project } = get();
    if (!project) return;
    set({
      project: {
        ...project,
        walls: project.walls.map((w) => (w.id === wallId ? { ...w, ...updates } : w)),
      },
    });
    await fetch(`/api/projects/${project.id}/walls/${wallId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
  },

  reorderWalls: async (wallIds) => {
    const { project } = get();
    if (!project) return;
    const reordered = wallIds.map((id, idx) => {
      const wall = project.walls.find((w) => w.id === id)!;
      return { ...wall, order: idx };
    });
    set({ project: { ...project, walls: reordered } });
    await fetch(`/api/projects/${project.id}/walls/reorder`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallIds }),
    });
  },

  updateWallTransform: (wallId, transform) => {
    const { project } = get();
    if (!project) return;
    set({
      project: {
        ...project,
        walls: project.walls.map((w) => (w.id === wallId ? { ...w, transform } : w)),
      },
    });
    debouncedSave(`transform-${wallId}`, 800, async () => {
      set({ saving: true });
      await fetch(`/api/projects/${project.id}/walls/${wallId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transform }),
      });
      set({ saving: false });
    });
  },

  addMockup: async (wallId, name, cloneFrom) => {
    const { project } = get();
    if (!project) throw new Error('No project loaded');
    const res = await fetch(`/api/projects/${project.id}/walls/${wallId}/mockups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, cloneFrom }),
    });
    if (!res.ok) throw new Error('Failed to create mockup');
    const mockup: Mockup = await res.json();
    set({
      project: {
        ...project,
        walls: project.walls.map((w) =>
          w.id === wallId ? { ...w, mockups: [...w.mockups, mockup] } : w
        ),
      },
    });
    return mockup;
  },

  removeMockup: async (wallId, mockupId) => {
    const { project } = get();
    if (!project) return;
    set({
      project: {
        ...project,
        walls: project.walls.map((w) =>
          w.id === wallId
            ? { ...w, mockups: w.mockups.filter((m) => m.id !== mockupId) }
            : w
        ),
      },
    });
    await fetch(`/api/projects/${project.id}/walls/${wallId}/mockups/${mockupId}`, {
      method: 'DELETE',
    });
  },

  updateMockupRegions: (wallId, mockupId, regions) => {
    const { project } = get();
    if (!project) return;
    set({
      project: {
        ...project,
        walls: project.walls.map((w) =>
          w.id === wallId
            ? {
                ...w,
                mockups: w.mockups.map((m) =>
                  m.id === mockupId ? { ...m, regions, updatedAt: new Date().toISOString() } : m
                ),
              }
            : w
        ),
      },
    });
    debouncedSave(`regions-${wallId}-${mockupId}`, 500, async () => {
      set({ saving: true });
      await fetch(`/api/projects/${project.id}/walls/${wallId}/mockups/${mockupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regions }),
      });
      set({ saving: false });
    });
  },

  updateFeedback: (wallId, mockupId, status, comment) => {
    const { project } = get();
    if (!project) return;
    const feedback = { status, comment, updatedAt: new Date().toISOString() };
    set({
      project: {
        ...project,
        walls: project.walls.map((w) =>
          w.id === wallId
            ? {
                ...w,
                mockups: w.mockups.map((m) =>
                  m.id === mockupId ? { ...m, feedback } : m
                ),
              }
            : w
        ),
      },
    });
    debouncedSave(`feedback-${wallId}-${mockupId}`, 1000, async () => {
      await fetch(`/api/projects/${project.id}/walls/${wallId}/mockups/${mockupId}/feedback`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(feedback),
      });
    });
  },

  addMural: async (file) => {
    const { project } = get();
    if (!project) throw new Error('No project loaded');
    const formData = new FormData();
    formData.append('image', file);
    const res = await fetch(`/api/projects/${project.id}/murals`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('Failed to upload mural');
    const mural: Mural = await res.json();
    set({ project: { ...project, murals: [...project.murals, mural] } });
    return mural;
  },

  removeMural: async (muralId) => {
    const { project } = get();
    if (!project) return;
    set({
      project: { ...project, murals: project.murals.filter((m) => m.id !== muralId) },
    });
    await fetch(`/api/projects/${project.id}/murals/${muralId}`, { method: 'DELETE' });
  },
}));
