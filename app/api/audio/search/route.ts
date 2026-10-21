import { NextRequest, NextResponse } from 'next/server';
import { AudioSourceError, searchAudioSources } from '@/lib/audio-source-search';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  try {
    const result = await searchAudioSources({
      q: p.get('q')?.trim() || (p.get('kind') === 'sound_effect' ? 'footsteps' : 'piano'),
      kind: p.get('kind') || 'music', provider: p.get('provider') || 'wikimedia',
      page: Number(p.get('page') || 1), pageSize: Number(p.get('pageSize') || 12),
      length: p.get('length') || '', license: p.get('license') ?? 'commercial',
    }, (url, init) => fetch(url, { ...init, next: { revalidate: 300 } }));
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof AudioSourceError ? error.message : '搜索服务暂时不可用，请重试' },
      { status: error instanceof AudioSourceError ? error.status : 502 });
  }
}
