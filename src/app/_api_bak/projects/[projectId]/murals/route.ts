import { NextRequest, NextResponse } from 'next/server';
import { getProject, saveProject, saveMuralImage } from '@/lib/storage';
import { generateId } from '@/lib/ids';
import sharp from 'sharp';
import path from 'path';
import type { Mural } from '@/lib/types';

type RouteParams = { params: Promise<{ projectId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(project.murals);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const formData = await request.formData();
  const file = formData.get('image') as File;

  if (!file) {
    return NextResponse.json({ error: 'No image provided' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const metadata = await sharp(buffer).metadata();
  const ext = path.extname(file.name) || '.png';
  const muralId = generateId();

  await saveMuralImage(projectId, muralId, ext, buffer);

  const mural: Mural = {
    id: muralId,
    name: file.name.replace(/\.[^.]+$/, ''),
    originalFileName: file.name,
    width: metadata.width || 0,
    height: metadata.height || 0,
  };

  project.murals.push(mural);
  project.updatedAt = new Date().toISOString();
  await saveProject(project);

  return NextResponse.json(mural, { status: 201 });
}
