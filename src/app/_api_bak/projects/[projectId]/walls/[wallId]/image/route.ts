import { NextRequest, NextResponse } from 'next/server';
import { getWallImage } from '@/lib/storage';

type RouteParams = { params: Promise<{ projectId: string; wallId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { projectId, wallId } = await params;
  const type = request.nextUrl.searchParams.get('type') || 'original';
  const fileName = type === 'thumbnail' ? 'thumbnail.jpg' : 'original.jpg';

  const buffer = await getWallImage(projectId, wallId, fileName);
  if (!buffer) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
