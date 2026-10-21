// Shared public page API and authenticated Cloudflare REST/MCP search policy.
export class AudioSourceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export interface SourceAsset {
  id: string; kind: string; title: string; creator: string;
  durationMs: number | null; previewUrl: string; source: string;
  sourceUrl: string; license: string; licenseUrl: string; attribution: string;
  tags: string[]; provider: 'openverse' | 'wikimedia'; fileNote: string;
}
export interface SourceQuery {
  q: string; kind: string; provider: string; page: number;
  pageSize?: number; length?: string; license?: string;
}
const aliases: Record<string, string> = {
  '钢琴': 'piano', '电影感': 'cinematic', '轻松': 'relaxing', '温暖': 'acoustic',
  '悬疑': 'suspense', '励志': 'inspiring', '科技': 'electronic',
  '脚步': 'footsteps', '敲门': 'knocking', '转场': 'whoosh',
  '掌声': 'applause', '雨声': 'rain', '键盘': 'typing',
};
type Obj = Record<string, unknown>;
const clean = (v: unknown) => typeof v === 'string' ? v.replace(/<[^>]*>/g, '').slice(0, 2000) : '';
export function wikimediaAsset(page: Obj, kind: string): SourceAsset | null {
  const info = (page.imageinfo as Obj[] | undefined)?.[0];
  if (!info || !clean(info.mime).startsWith('audio/')) return null;
  const ext = (info.extmetadata || {}) as Record<string, { value?: string }>;
  const license = clean(ext.LicenseShortName?.value);
  if (/\bNC\b|\bND\b/i.test(license)) return null;
  const title = clean(page.title);
  return {
    id: title, kind, provider: 'wikimedia', title: title.replace(/^File:/, ''),
    creator: clean(ext.Artist?.value) || '见来源页',
    durationMs: typeof info.duration === 'number' ? Math.round(info.duration * 1000) : null,
    previewUrl: clean(info.url), source: 'Wikimedia Commons', sourceUrl: clean(info.descriptionurl),
    license, licenseUrl: clean(ext.LicenseUrl?.value),
    attribution: `${title} · ${clean(ext.Artist?.value)} · ${license}`, tags: [],
    fileNote: 'Wikimedia 原始文件；分类与适用性需试听确认，授权以来源页为准',
  };
}
export function matchesSourceFilters(asset: SourceAsset, input: SourceQuery) {
  const license = input.license ?? 'commercial';
  if (license === 'cc0' && !/^(CC[ -]?0\b|Public domain)/i.test(asset.license)) return false;
  if (license === 'commercial' && !/^(CC[ -]?(?:0|BY(?:[ -]SA)?)\b|Public domain)/i.test(asset.license)) return false;
  if (input.length) {
    const d = asset.durationMs;
    if (d === null) return false;
    if (input.length === 'shortest' && d >= 30000) return false;
    if (input.length === 'short' && (d < 30000 || d >= 240000)) return false;
    if (input.length === 'medium' && (d < 240000 || d >= 600000)) return false;
    if (input.length === 'long' && d < 600000) return false;
  }
  return true;
}
export async function searchAudioSources(input: SourceQuery, fetcher: typeof fetch = fetch) {
  if (!input.q.trim() || input.q.length > 200 || !['music', 'sound_effect'].includes(input.kind) ||
      !['wikimedia', 'openverse'].includes(input.provider) || !Number.isInteger(input.page) || input.page < 1 || input.page > 20 ||
      (input.pageSize !== undefined && (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 24)) ||
      ![undefined, '', 'shortest', 'short', 'medium', 'long'].includes(input.length) ||
      ![undefined, '', 'commercial', 'cc0'].includes(input.license))
    throw new AudioSourceError(400, '搜索参数不合法');
  if (input.provider === 'openverse')
    throw new AudioSourceError(503, 'Openverse 搜索暂时停用：上游持续超时，请切换 Wikimedia。已有私有素材不受影响。');
  const pageSize = input.pageSize ?? 12;
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  u.search = new URLSearchParams({action: 'query', format: 'json', generator: 'search',
    gsrsearch: `${aliases[input.q.trim()] || input.q.trim()} filetype:audio`, gsrnamespace: '6',
    gsrlimit: String(pageSize), gsroffset: String((input.page - 1) * pageSize),
    prop: 'imageinfo', iiprop: 'url|mime|extmetadata|size', formatversion: '2'}).toString();
  try {
    const response = await fetcher(u, {headers: {Accept: 'application/json', 'User-Agent': 'AutoParseAudio/1.1 (https://auto-parse-v2.vyibc.com/audio-library)'}, signal: AbortSignal.timeout(8000)});
    if (!response.ok) { await response.body?.cancel(); throw new AudioSourceError(response.status === 429 ? 429 : 502, '素材来源暂时不可用，请稍后重试；此次搜索未扣费。'); }
    if (!response.body) throw new AudioSourceError(502, '素材来源返回了空响应，请重试');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new AudioSourceError(502, '素材来源响应过大，请缩小搜索范围'); } chunks.push(part.value); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
    const data = JSON.parse(new TextDecoder().decode(bytes)) as {error?: unknown; batchcomplete?: unknown; query?: {pages?: Obj[]}; continue?: {gsroffset?: number}};
    if (!data || data.error || (!data.query && data.batchcomplete === undefined) || (data.query?.pages !== undefined && !Array.isArray(data.query.pages)))
      throw new AudioSourceError(502, '素材来源返回异常，请稍后重试');
    const items = (data.query?.pages || []).sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
      .map(p => wikimediaAsset(p, input.kind)).filter((a): a is SourceAsset => !!a).filter(a => matchesSourceFilters(a, input));
    return {items, total: items.length, totalExact: false, page: input.page, pageSize,
      hasNext: typeof data.continue?.gsroffset === 'number' && input.page < 20,
      provider: 'wikimedia' as const, query: input.q,
      notice: 'Openverse 搜索暂时停用。当前使用 Wikimedia；数量为本页匹配数，分类和适用性需试听确认。'};
  } catch (error) {
    if (error instanceof AudioSourceError) throw error;
    if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
      throw new AudioSourceError(504, '搜索超过 8 秒未返回，请重试或更换关键词；此次搜索未扣费。');
    throw new AudioSourceError(502, '素材来源响应异常或连接失败，请稍后重试；此次搜索未扣费。');
  }
}
