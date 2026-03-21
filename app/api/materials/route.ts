import { NextRequest, NextResponse } from 'next/server';
import { getMaterials, addMaterial, deleteMaterial } from '@/lib/materials';

export async function GET() {
  return NextResponse.json(getMaterials());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { platform, title, videoUrl, ossUrl, coverUrl, watermark } = body;
  if (!ossUrl || !title) {
    return NextResponse.json({ error: '缺少必要字段' }, { status: 400 });
  }
  const item = addMaterial({ platform, title, videoUrl, ossUrl, coverUrl, watermark });
  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });
  const ok = deleteMaterial(id);
  return NextResponse.json({ success: ok });
}
