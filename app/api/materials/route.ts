import { NextRequest, NextResponse } from 'next/server';
import { getMaterials, addMaterial, deleteMaterial, queryMaterials } from '@/lib/materials';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const kindRaw = searchParams.get('kind') || 'video';
  const kind = kindRaw === 'all' || kindRaw === 'image' || kindRaw === 'video' ? kindRaw : 'video';
  const linkedRaw = searchParams.get('linked') || 'all';
  const linked = linkedRaw === 'linked' || linkedRaw === 'unlinked' || linkedRaw === 'all' ? linkedRaw : 'all';
  const keyword = searchParams.get('q') || '';
  const pageRaw = searchParams.get('page');
  const pageSizeRaw = searchParams.get('pageSize');

  if (pageRaw || pageSizeRaw) {
    const page = Number.parseInt(pageRaw || '1', 10) || 1;
    const pageSize = Number.parseInt(pageSizeRaw || '20', 10) || 20;
    return NextResponse.json(queryMaterials({ kind, page, pageSize, keyword, linked }));
  }

  const materials = getMaterials();
  if (kind === 'all') return NextResponse.json(materials);
  if (kind === 'image') return NextResponse.json(materials.filter((m) => m.mediaType === 'image'));
  return NextResponse.json(materials.filter((m) => (m.mediaType ?? 'video') === 'video'));
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { platform, mediaType, title, videoUrl, ossUrl, coverUrl, sourceUrl, sourceNoteId, sourcePostUrl, watermark } = body;
  if (!ossUrl || !title) {
    return NextResponse.json({ error: '缺少必要字段' }, { status: 400 });
  }
  const item = addMaterial({
    platform,
    mediaType,
    title,
    videoUrl: videoUrl || '',
    ossUrl,
    coverUrl,
    sourceUrl,
    sourceNoteId,
    sourcePostUrl,
    watermark,
  });
  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });
  const ok = deleteMaterial(id);
  return NextResponse.json({ success: ok });
}
