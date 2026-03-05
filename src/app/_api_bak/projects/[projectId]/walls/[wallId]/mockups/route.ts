import { NextRequest, NextResponse } from 'next/server';
import { getProject, saveProject } from '@/lib/storage';
import { generateId } from '@/lib/ids';
import type { Mockup } from '@/lib/types';

type RouteParams = { params: Promise<{ projectId: string; wallId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { projectId, wallId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const wall = project.walls.find((w) => w.id === wallId);
  if (!wall) return NextResponse.json({ error: 'Wall not found' }, { status: 404 });

  return NextResponse.json(wall.mockups);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { projectId, wallId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const wall = project.walls.find((w) => w.id === wallId);
  if (!wall) return NextResponse.json({ error: 'Wall not found' }, { status: 404 });

  const body = await request.json();
  const sourceMode = body.cloneFrom
    ? wall.mockups.find((m) => m.id === body.cloneFrom)?.mode ?? 'color'
    : 'color';

  const mockup: Mockup = {
    id: generateId(),
    name: body.name || `Option ${String.fromCharCode(65 + wall.mockups.length)}`,
    regions: body.cloneFrom
      ? (wall.mockups.find((m) => m.id === body.cloneFrom)?.regions || []).map((r) => ({
          ...r,
          id: generateId(),
        }))
      : [],
    mode: body.mode || sourceMode,
    feedback: { status: 'none', comment: '', updatedAt: new Date().toISOString() },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  wall.mockups.push(mockup);
  project.updatedAt = new Date().toISOString();
  await saveProject(project);

  return NextResponse.json(mockup, { status: 201 });
}
