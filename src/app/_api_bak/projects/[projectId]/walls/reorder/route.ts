import { NextRequest, NextResponse } from 'next/server';
import { getProject, saveProject } from '@/lib/storage';

type RouteParams = { params: Promise<{ projectId: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { wallIds } = await request.json() as { wallIds: string[] };

  for (const wall of project.walls) {
    const idx = wallIds.indexOf(wall.id);
    if (idx !== -1) wall.order = idx;
  }

  project.updatedAt = new Date().toISOString();
  await saveProject(project);

  return NextResponse.json({ ok: true });
}
