import { NextRequest, NextResponse } from 'next/server';
import { getProject, saveProject, saveWallImage } from '@/lib/storage';
import { generateId } from '@/lib/ids';
import sharp from 'sharp';
import type { Wall, Mockup } from '@/lib/types';

type RouteParams = { params: Promise<{ projectId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(project.walls);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const formData = await request.formData();
  const name = (formData.get('name') as string) || 'Untitled Wall';
  const file = formData.get('image') as File;

  if (!file) {
    return NextResponse.json({ error: 'No image provided' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  const wallId = generateId();

  // Save original
  await saveWallImage(projectId, wallId, 'original.jpg', buffer);

  // Generate and save thumbnail
  const thumbnail = await sharp(buffer)
    .resize(400, 300, { fit: 'cover' })
    .jpeg({ quality: 80 })
    .toBuffer();
  await saveWallImage(projectId, wallId, 'thumbnail.jpg', thumbnail);

  const mockupId = generateId();
  const initialMockup: Mockup = {
    id: mockupId,
    name: 'Option A',
    regions: [],
    mode: 'color',
    feedback: { status: 'none', comment: '', updatedAt: new Date().toISOString() },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const wall: Wall = {
    id: wallId,
    name,
    roomId: '',
    originalFileName: file.name,
    width,
    height,
    order: project.walls.length,
    transform: { cropX: 0, cropY: 0, cropW: 1, cropH: 1, rotation: 0 },
    mockups: [initialMockup],
    createdAt: new Date().toISOString(),
  };

  project.walls.push(wall);
  project.updatedAt = new Date().toISOString();
  await saveProject(project);

  return NextResponse.json(wall, { status: 201 });
}
