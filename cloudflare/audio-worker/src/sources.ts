import { AudioError, allowedAudioUrl } from "./schema";

export interface SourceAsset {
  id: string;
  kind: string;
  title: string;
  creator: string;
  durationMs: number | null;
  previewUrl: string;
  source: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  attribution: string;
  tags: string[];
  provider: "openverse" | "wikimedia";
  fileNote: string;
}
type RecordValue = Record<string, unknown>;
function text(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/<[^>]*>/g, "").slice(0, 2000)
    : "";
}
async function json(url: URL) {
  // Only public source metadata is cached. No credentials, private library or paid requests.
  const cache = typeof caches === "undefined" ? undefined : caches.default;
  const key = new Request(url);
  const cached = await cache?.match(key);
  if (cached) return (await cached.json()) as RecordValue;
  try {
    const r = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "AutoParseAudio/1.0 (https://auto-parse-v2.vyibc.com/audio-library)" },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new AudioError(r.status === 429 ? 429 : 502, `素材服务返回 ${r.status}，请稍后重试或切换素材来源`);
    const data = await r.json() as RecordValue;
    if (cache) await cache.put(key, Response.json(data, {headers:{"Cache-Control":"public, max-age=300"}})).catch(()=>{});
    return data;
  } catch (error) {
    if (error instanceof AudioError) throw error;
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))
      throw new AudioError(504, "素材来源响应超时；请换短关键词、稍后重试，或切换 Wikimedia。此次检索未生成、未扣费。");
    throw new AudioError(502, "素材来源暂不可用；可切换其他来源。此次检索未生成、未扣费。");
  }
}
function openverse(item: RecordValue, kind: string): SourceAsset {
  const license =
    `${text(item.license).toUpperCase()} ${text(item.license_version)}`.trim();
  return {
    id: text(item.id),
    provider: "openverse",
    kind,
    title: text(item.title) || "未命名音频",
    creator: text(item.creator) || "未知作者",
    durationMs: typeof item.duration === "number" ? item.duration : null,
    previewUrl: text(item.url),
    source: text(item.source),
    sourceUrl: text(item.foreign_landing_url),
    license,
    licenseUrl: text(item.license_url),
    attribution: text(item.attribution),
    tags: ((item.tags || []) as RecordValue[])
      .map((t) => text(t.name))
      .filter(Boolean)
      .slice(0, 20),
    fileNote:
      "保存来源提供的试听文件，可能是转码版本，不宣称原始 WAV；下载及使用前需核对原页授权",
  };
}
function wikimedia(page: RecordValue, kind: string): SourceAsset | null {
  const info = (page.imageinfo as RecordValue[] | undefined)?.[0];
  if (!info || !text(info.mime).startsWith("audio/")) return null;
  const ext = (info.extmetadata || {}) as Record<string, { value?: string }>;
  const license = text(ext.LicenseShortName?.value);
  if (/\bNC\b|\bND\b/i.test(license)) return null;
  const title = text(page.title);
  return {
    id: title,
    kind,
    provider: "wikimedia",
    title: title.replace(/^File:/, ""),
    creator: text(ext.Artist?.value) || "见来源页",
    durationMs: null,
    previewUrl: text(info.url),
    source: "Wikimedia Commons",
    sourceUrl: text(info.descriptionurl),
    license,
    licenseUrl: text(ext.LicenseUrl?.value),
    attribution: `${title} · ${text(ext.Artist?.value)} · ${license}`,
    tags: [],
    fileNote: "Wikimedia 提供的原始文件；授权以来源页为准",
  };
}
export async function searchSources(input: {
  q: string;
  kind: string;
  provider: string;
  page: number;
}) {
  if (input.provider === "openverse") {
    const u = new URL("https://api.openverse.org/v1/audio/");
    u.search = new URLSearchParams({
      q: input.q,
      page: String(input.page),
      page_size: "12",
      license: "cc0,pdm,by,by-sa",
      mature: "false",
      ...(input.kind === "music"
        ? { category: "music" }
        : { source: "freesound" }),
    }).toString();
    const data = await json(u);
    const items = ((data.results || []) as RecordValue[])
      .map((x) => openverse(x, input.kind))
      .filter((x) => x.id && x.previewUrl && !/\bNC\b|\bND\b/i.test(x.license));
    return {
      items,
      total: Number(data.result_count) || items.length,
      page: input.page,
      provider: input.provider,
    };
  }
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  u.search = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${input.q} filetype:audio`,
    gsrnamespace: "6",
    gsrlimit: "12",
    gsroffset: String((input.page - 1) * 12),
    prop: "imageinfo",
    iiprop: "url|mime|extmetadata",
    formatversion: "2",
  }).toString();
  const data = await json(u);
  const pages = ((data.query as RecordValue | undefined)?.pages ||
    []) as RecordValue[];
  return {
    items: pages.map((x) => wikimedia(x, input.kind)).filter(Boolean),
    page: input.page,
    provider: input.provider,
  };
}
export async function sourceById(
  provider: string,
  id: string,
  kind: string,
): Promise<SourceAsset> {
  let asset: SourceAsset | null;
  if (provider === "openverse") {
    if (!/^[a-f0-9-]{36}$/i.test(id))
      throw new AudioError(400, "无效的 Openverse ID");
    asset = openverse(
      await json(
        new URL(
          `https://api.openverse.org/v1/audio/${encodeURIComponent(id)}/`,
        ),
      ),
      kind,
    );
  } else {
    if (!id.startsWith("File:"))
      throw new AudioError(400, "无效的 Wikimedia 文件名");
    const u = new URL("https://commons.wikimedia.org/w/api.php");
    u.search = new URLSearchParams({
      action: "query",
      format: "json",
      titles: id,
      prop: "imageinfo",
      iiprop: "url|mime|extmetadata",
      formatversion: "2",
    }).toString();
    const data = await json(u);
    const pages = ((data.query as RecordValue | undefined)?.pages ||
      []) as RecordValue[];
    asset = pages[0] ? wikimedia(pages[0], kind) : null;
  }
  if (
    !asset ||
    !asset.previewUrl ||
    !asset.license ||
    /\bNC\b|\bND\b|UNKNOWN/i.test(asset.license) ||
    (provider === "openverse"
      ? !/^(CC0|PDM|BY|BY-SA)(?:\s|$)/i.test(asset.license)
      : !/^(CC[ -]?(?:0|BY(?:[ -]SA)?)\b|Public domain)/i.test(asset.license))
  )
    throw new AudioError(
      422,
      "未找到可确认授权的音频；不导入未知授权或 NC/ND 素材",
    );
  allowedAudioUrl(asset.previewUrl);
  return asset;
}
export async function readBounded(
  response: Response,
  max = 30 * 1024 * 1024,
): Promise<Uint8Array> {
  if (!response.ok || !response.body)
    throw new AudioError(502, `媒体下载失败 (${response.status})`);
  if (Number(response.headers.get("content-length")) > max) {
    await response.body.cancel();
    throw new AudioError(413, "文件超过 30 MiB 上限");
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.length;
    if (size > max) {
      await reader.cancel();
      throw new AudioError(413, "文件超过 30 MiB 上限");
    }
    parts.push(r.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
export async function downloadAudio(raw: string) {
  let url = allowedAudioUrl(raw);
  for (let redirects = 0; redirects < 4; redirects++) {
    const r = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(45000),
    });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const location = r.headers.get("location");
      await r.body?.cancel();
      if (!location) throw new AudioError(502, "媒体重定向缺少地址");
      url = allowedAudioUrl(new URL(location, url).href);
      continue;
    }
    return {
      bytes: await readBounded(r),
      mime: (r.headers.get("content-type") || "").split(";")[0],
    };
  }
  throw new AudioError(502, "媒体重定向过多");
}
