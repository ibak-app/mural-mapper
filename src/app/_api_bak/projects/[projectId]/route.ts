import { NextRequest, NextResponse } from 'next/server';
import { getProject, saveProject, deleteProject } from '@/lib/storage';

type RouteParams = { params: Promise<{ projectId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(project);
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json();
  if (body.name !== undefined) project.name = body.name;
  if (body.client !== undefined) project.client = body.client;
  if (body.notes !== undefined) project.notes = body.notes;
  if (body.rooms !== undefined) project.rooms = body.rooms;
  project.updatedAt = new Date().toISOString();

  await saveProject(project);
  return NextResponse.json(project);
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { projectId } = await params;
  await deleteProject(projectId);
  return new NextResponse(null, { status: 204 });
}
