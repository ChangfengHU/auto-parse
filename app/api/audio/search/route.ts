import { NextRequest, NextResponse } from 'next/server';
import type { AudioAsset, AudioAssetKind, AudioSearchResponse } from '@/lib/audio-assets';

export const runtime = 'nodejs';

const OPENVERSE_AUDIO_API = 'https://api.openverse.org/v1/audio/';
const MAX_PAGE_SIZE = 24;

const QUERY_ALIASES: Record<string, string> = {
  '电影感': 'cinematic',
  '轻松': 'relaxing',
  '温暖': 'warm acoustic',
  '悬疑': 'suspense',
  '励志': 'inspiring',
  '科技': 'technology electronic',
  '脚步': 'footsteps',
  '敲门': 'knocking door',
  '转场': 'transition whoosh',
  '掌声': 'applause',
  '雨声': 'rain ambience',
  '键盘': 'keyboard typing',
};

interface OpenverseTag {
  name?: string;
}
interface OpenverseAudio {
  id?: string;
  title?: string;
  creator?: string;
  duration?: number;
  url?: string;
  waveform?: string;
  thumbnail?: string;
  source?: string;
  provider?: string;
  category?: string;
  foreign_landing_url?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  attribution?: string;
  filetype?: string;
  tags?: OpenverseTag[];
}

interface OpenverseResponse {
  result_count?: number;
  page_count?: number;
  page_size?: number;
  page?: number;
  results?: OpenverseAudio[];
  detail?: string;
}

function normalizeQuery(query: string) {
  const trimmed = query.trim().slice(0, 200);
  return QUERY_ALIASES[trimmed] ?? trimmed;
}

function normalizeLicense(item: OpenverseAudio) {
  const code = item.license?.toUpperCase() || 'UNKNOWN';
  return item.license_version ? `${code} ${item.license_version}` : code;
}

function normalizeAsset(item: OpenverseAudio, kind: AudioAssetKind): AudioAsset | null {
  if (!item.id || !item.url) return null;

  return {
    id: item.id,
    kind,
    title: item.title?.trim() || '未命名音频',
    creator: item.creator?.trim() || '未知作者',
    durationMs: typeof item.duration === 'number' ? item.duration : null,
    previewUrl: item.url,
    waveformUrl: item.waveform || null,
    thumbnailUrl: item.thumbnail || null,
    source: item.source || item.provider || 'Openverse',
    sourceUrl: item.foreign_landing_url || item.url,
    license: normalizeLicense(item),
    licenseUrl: item.license_url || null,
    attribution: item.attribution || `${item.title || '音频'} — ${item.creator || '未知作者'}`,
    tags: (item.tags || []).flatMap((tag) => tag.name ? [tag.name] : []).slice(0, 6),
    fileType: item.filetype || null,
  };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const kind: AudioAssetKind = params.get('kind') === 'sound_effect' ? 'sound_effect' : 'music';
  const fallbackQuery = kind === 'music' ? 'cinematic' : 'footsteps';
  const originalQuery = params.get('q')?.trim() || fallbackQuery;
  const query = normalizeQuery(originalQuery);
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(params.get('pageSize') || '12', 10) || 12));
  const length = params.get('length');
  const license = params.get('license');

  const upstream = new URL(OPENVERSE_AUDIO_API);
  upstream.searchParams.set('q', query);
  upstream.searchParams.set('page', String(page));
  upstream.searchParams.set('page_size', String(pageSize));
  upstream.searchParams.set('mature', 'false');
  if (kind === 'music') upstream.searchParams.set('category', 'music');
  if (kind === 'sound_effect') upstream.searchParams.set('source', 'freesound');
  if (length && ['shortest', 'short', 'medium', 'long'].includes(length)) {
    upstream.searchParams.set('length', length);
  }
  if (license === 'commercial') upstream.searchParams.set('license_type', 'commercial');
  if (license === 'cc0') upstream.searchParams.set('license', 'cc0,pdm');

  try {
    const response = await fetch(upstream, {
      headers: { Accept: 'application/json', 'User-Agent': 'auto-parse-audio/1.0' },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(12_000),
    });
    const data = await response.json() as OpenverseResponse;

    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail || '音频素材服务暂时不可用' },
        { status: response.status === 429 ? 429 : 502 },
      );
    }

    const items = (data.results || []).flatMap((item) => {
      const normalized = normalizeAsset(item, kind);
      return normalized ? [normalized] : [];
    });
    const result: AudioSearchResponse = {
      items,
      total: data.result_count || items.length,
      page,
      pageSize,
      hasNext: page < (data.page_count || 1),
      provider: 'openverse',
      query: originalQuery,
    };

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error && error.name === 'TimeoutError'
      ? '音频素材服务响应超时，请稍后重试'
      : '无法连接音频素材服务';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
