// Simple IndexedDB persistence for projects

const DB_NAME = 'mural-mapper';
const DB_VERSION = 3;
const STORE = 'projects';

interface Corner { x: number; y: number }

export interface MuralEntry {
  id: string;
  muralPoolId: string;
  blob: Blob;
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  rotationLocked: boolean;
  opacity: number;
  blendMode: string;
  clipLeft: number;
  clipRight: number;
  clipTop: number;
  clipBottom: number;
  comment: string;
  liked: boolean;
  // OLD fields kept for migration
  clipMode?: string;
  clipInset?: number;
}

export interface QuadEntry {
  id: string;
  corners: [Corner, Corner, Corner, Corner];
  label?: string;
  linkId?: string;
  murals: MuralEntry[];
}

export interface MuralPoolDbEntry {
  id: string;
  blob: Blob;
}

export interface WallEntry {
  id: string;
  blob: Blob;
  quads: QuadEntry[];
  // OLD fields kept for migration
  corners?: [Corner, Corner, Corner, Corner];
  murals?: MuralEntry[];
  linkGroup?: string;
}

export interface ProjectData {
  name: string;
  walls: WallEntry[];
  muralPool?: MuralPoolDbEntry[];
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProject(data: ProjectData): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(data);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadProject(name: string): Promise<ProjectData | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(name);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function listProjects(): Promise<string[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteProject(name: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
