import { NextRequest, NextResponse } from 'next/server';
import { listProjects, saveProject } from '@/lib/storage';
import { generateId } from '@/lib/ids';
import type { Project } from '@/lib/types';

export async function GET() {
  const projects = await listProjects();
  return NextResponse.json(projects);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, client, notes } = body;

  const project: Project = {
    id: generateId(),
    name: name || 'Untitled Project',
    client: client || '',
    notes: notes || '',
    rooms: [],
    walls: [],
    murals: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saveProject(project);
  return NextResponse.json(project, { status: 201 });
}
