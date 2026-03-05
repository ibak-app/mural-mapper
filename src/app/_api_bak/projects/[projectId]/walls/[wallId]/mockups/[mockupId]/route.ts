import { NextRequest, NextResponse } from 'next/server';
import { getProject, saveProject, mockupDir } from '@/lib/storage';
import fs from 'fs/promises';
import path from 'path';

type RouteParams = { params: Promise<{ projectId: string; wallId: string; mockupId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { projectId, wallId, mockupId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const wall = project.walls.find((w) => w.id === wallId);
  if (!wall) return NextResponse.json({ error: 'Wall not found' }, { status: 404 });

  const mockup = wall.mockups.find((m) => m.id === mockupId);
  if (!mockup) return NextResponse.json({ error: 'Mockup not found' }, { status: 404 });

  return NextResponse.json(mockup);
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { projectId, wallId, mockupId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const wall = project.walls.find((w) => w.id === wallId);
  if (!wall) return NextResponse.json({ error: 'Wall not found' }, { status: 404 });

  const mockup = wall.mockups.find((m) => m.id === mockupId);
  if (!mockup) return NextResponse.json({ error: 'Mockup not found' }, { status: 404 });

  const body = await request.json();
  if (body.name !== undefined) mockup.name = body.name;
  const regionsChanged = body.regions !== undefined;
  if (body.regions !== undefined) mockup.regions = body.regions;
  if (body.mode !== undefined) mockup.mode = body.mode;
  if (body.feedback !== undefined) mockup.feedback = body.feedback;
  mockup.updatedAt = new Date().toISOString();
  project.updatedAt = new Date().toISOString();
  await saveProject(project);

  // Invalidate cached render when regions change
  if (regionsChanged) {
    const renderPath = path.join(mockupDir(projectId, wallId, mockupId), 'render.png');
    fs.rm(renderPath, { force: true }).catch(() => {});
  }

  return NextResponse.json(mockup);
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { projectId, wallId, mockupId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const wall = project.walls.find((w) => w.id === wallId);
  if (!wall) return NextResponse.json({ error: 'Wall not found' }, { status: 404 });

  wall.mockups = wall.mockups.filter((m) => m.id !== mockupId);
  project.updatedAt = new Date().toISOString();
  await saveProject(project);

  return new NextResponse(null, { status: 204 });
}
