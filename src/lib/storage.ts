import fs from 'fs/promises';
import path from 'path';
import type { Project } from './types';

const DATA_DIR = path.join(process.cwd(), 'data', 'projects');

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function projectDir(projectId: string) {
  return path.join(DATA_DIR, projectId);
}

function projectJsonPath(projectId: string) {
  return path.join(projectDir(projectId), 'project.json');
}

export function wallDir(projectId: string, wallId: string) {
  return path.join(projectDir(projectId), 'walls', wallId);
}

export function mockupDir(projectId: string, wallId: string, mockupId: string) {
  return path.join(wallDir(projectId, wallId), 'mockups', mockupId);
}

export function muralPath(projectId: string, muralId: string, ext: string) {
  return path.join(projectDir(projectId), 'murals', `${muralId}${ext}`);
}

export async function listProjects(): Promise<Project[]> {
  await ensureDir(DATA_DIR);
  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  const projects: Project[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      try {
        const data = await fs.readFile(
          path.join(DATA_DIR, entry.name, 'project.json'),
          'utf-8'
        );
        projects.push(JSON.parse(data));
      } catch {
        // skip corrupt/incomplete projects
      }
    }
  }
  return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getProject(projectId: string): Promise<Project | null> {
  try {
    const data = await fs.readFile(projectJsonPath(projectId), 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function saveProject(project: Project): Promise<void> {
  const dir = projectDir(project.id);
  await ensureDir(dir);
  await fs.writeFile(projectJsonPath(project.id), JSON.stringify(project, null, 2));
}

export async function deleteProject(projectId: string): Promise<void> {
  const dir = projectDir(projectId);
  await fs.rm(dir, { recursive: true, force: true });
}

export async function saveWallImage(
  projectId: string,
  wallId: string,
  fileName: string,
  buffer: Buffer
): Promise<void> {
  const dir = wallDir(projectId, wallId);
  await ensureDir(dir);
  await fs.writeFile(path.join(dir, fileName), buffer);
}

export async function getWallImage(
  projectId: string,
  wallId: string,
  fileName: string
): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(wallDir(projectId, wallId), fileName));
  } catch {
    return null;
  }
}

export async function saveMockupRender(
  projectId: string,
  wallId: string,
  mockupId: string,
  buffer: Buffer
): Promise<void> {
  const dir = mockupDir(projectId, wallId, mockupId);
  await ensureDir(dir);
  await fs.writeFile(path.join(dir, 'render.png'), buffer);
}

export async function getMockupRender(
  projectId: string,
  wallId: string,
  mockupId: string
): Promise<Buffer | null> {
  try {
    return await fs.readFile(
      path.join(mockupDir(projectId, wallId, mockupId), 'render.png')
    );
  } catch {
    return null;
  }
}

export async function saveMuralImage(
  projectId: string,
  muralId: string,
  ext: string,
  buffer: Buffer
): Promise<void> {
  const dir = path.join(projectDir(projectId), 'murals');
  await ensureDir(dir);
  await fs.writeFile(path.join(dir, `${muralId}${ext}`), buffer);
}

export async function getMuralImage(
  projectId: string,
  muralId: string,
  ext: string
): Promise<Buffer | null> {
  try {
    return await fs.readFile(muralPath(projectId, muralId, ext));
  } catch {
    return null;
  }
}
