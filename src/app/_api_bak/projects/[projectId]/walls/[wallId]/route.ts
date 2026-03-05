import { NextRequest, NextResponse } from 'next/server';
import { getProject, saveProject } from '@/lib/storage';

type RouteParams = { params: Promise<{ projectId: string; wallId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { projectId, wallId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const wall = project.walls.find((w) => w.id === wallId);
  if (!wall) return NextResponse.json({ error: 'Wall not found' }, { status: 404 });

  return NextResponse.json(wall);
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { projectId, wallId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const wall = project.walls.find((w) => w.id === wallId);
  if (!wall) return NextResponse.json({ error: 'Wall not found' }, { status: 404 });

  const body = await request.json();
  if (body.name !== undefined) wall.name = body.name;
  if (body.transform !== undefined) wall.transform = body.transform;
  if (body.order !== undefined) wall.order = body.order;
  project.updatedAt = new Date().toISOString();
  await saveProject(project);

  return NextResponse.json(wall);
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { projectId, wallId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  project.walls = project.walls.filter((w) => w.id !== wallId);
  project.updatedAt = new Date().toISOString();
  await saveProject(project);

  return new NextResponse(null, { status: 204 });
}
