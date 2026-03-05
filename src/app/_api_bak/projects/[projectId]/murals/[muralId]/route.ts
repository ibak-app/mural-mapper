import { NextRequest, NextResponse } from 'next/server';
import { getProject, saveProject, getMuralImage } from '@/lib/storage';
import path from 'path';

type RouteParams = { params: Promise<{ projectId: string; muralId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { projectId, muralId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const mural = project.murals.find((m) => m.id === muralId);
  if (!mural) return NextResponse.json({ error: 'Mural not found' }, { status: 404 });

  const ext = path.extname(mural.originalFileName) || '.png';
  const buffer = await getMuralImage(projectId, muralId, ext);
  if (!buffer) return NextResponse.json({ error: 'Image not found' }, { status: 404 });

  const contentType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { projectId, muralId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  project.murals = project.murals.filter((m) => m.id !== muralId);
  project.updatedAt = new Date().toISOString();
  await saveProject(project);

  return new NextResponse(null, { status: 204 });
}
