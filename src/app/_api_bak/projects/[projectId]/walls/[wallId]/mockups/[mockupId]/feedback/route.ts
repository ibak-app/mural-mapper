import { NextRequest, NextResponse } from 'next/server';
import { getProject, saveProject } from '@/lib/storage';

type RouteParams = { params: Promise<{ projectId: string; wallId: string; mockupId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { projectId, wallId, mockupId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const wall = project.walls.find((w) => w.id === wallId);
  if (!wall) return NextResponse.json({ error: 'Wall not found' }, { status: 404 });

  const mockup = wall.mockups.find((m) => m.id === mockupId);
  if (!mockup) return NextResponse.json({ error: 'Mockup not found' }, { status: 404 });

  const body = await request.json();
  mockup.feedback = {
    status: body.status ?? mockup.feedback?.status ?? 'none',
    comment: body.comment ?? mockup.feedback?.comment ?? '',
    updatedAt: new Date().toISOString(),
  };
  project.updatedAt = new Date().toISOString();
  await saveProject(project);

  return NextResponse.json(mockup.feedback);
}
