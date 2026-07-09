import { chromium } from 'playwright';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const COOKIE_FILE = path.join(process.cwd(), '.douyin-cookie.json');
const CHROME_CANDIDATES = [
  process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH,
  process.env.CHROME_EXECUTABLE_PATH,
  '/opt/google/chrome/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean) as string[];

function resolveChromeExecutablePath(): string | undefined {
  return CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
}

function parseCookies(cookieStr: string) {
  return cookieStr.split(';').map(c => {
    const idx = c.indexOf('=');
    return {
      name: c.slice(0, idx).trim(),
      value: c.slice(idx + 1).trim(),
      domain: '.douyin.com',
      path: '/',
      secure: true,
      sameSite: 'None' as const,
    };
  }).filter(c => c.name && c.value);
}

// 动态读取 Cookie：优先 override，再本地文件，降级 env
function loadDouyinCookies(cookieStrOverride?: string): ReturnType<typeof parseCookies> {
  if (cookieStrOverride?.trim()) return parseCookies(cookieStrOverride.trim());
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      const data = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
      if (Array.isArray(data.cookies) && data.cookies.length > 0) return data.cookies;
      if (data.cookie) return parseCookies(data.cookie);
    }
  } catch { /* ignore */ }
  const envCookie = process.env.DOUYIN_COOKIE || '';
  return envCookie ? parseCookies(envCookie) : [];
}

export function hasDouyinAuth(cookieStrOverride?: string): boolean {
  return loadDouyinCookies(cookieStrOverride).some(c => c.name === 'sessionid' || c.name === 'sessionid_ss');
}

interface DouyinShareImage {
  url: string;
  width?: number;
  height?: number;
}

interface PlaywrightDouyinResult {
  videoUrl: string;
  title: string;
  watermark: boolean;
  mediaType?: 'video' | 'image';
  images?: DouyinShareImage[];
  imageCount?: number;
  coverUrl?: string;
  music?: unknown;
  author?: unknown;
  statistics?: unknown;
  hashtags?: string[];
  mentions?: unknown[];
  videoMeta?: unknown;
  createTime?: number;
  shareUrl?: string;
  cover?: unknown;
  desc?: string;
}

function fileIdFromUrl(url: string): string | undefined {
  return url.match(/tos-cn-ve-15\/([^/?]+)/i)?.[1];
}

function normalizeImageFromSource(value: unknown): string {
  if (!value || typeof value !== 'string') return '';
  return value.trim();
}

function extractImagesFromUnknownList(value: unknown): DouyinShareImage[] {
  if (!Array.isArray(value)) return [];

  return value.reduce<DouyinShareImage[]>((list, item) => {
    if (!item || typeof item !== 'object') return list;
    const source = item as Record<string, unknown>;
    const candidates = [
      ...(Array.isArray(source.url_list) ? (source.url_list as unknown[]) : []),
      source.url,
      source.uri,
    ].filter((v) => typeof v === 'string') as string[];

    const url = normalizeImageFromSource(candidates[0]);
    if (!url) return list;

    const width = Number(source.width);
    const height = Number(source.height);

    list.push({
      url,
      width: Number.isFinite(width) ? width : undefined,
      height: Number.isFinite(height) ? height : undefined,
    });
    return list;
  }, []);
}

function extractSuffixLogoFileIds(video: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  const suffixList =
    (video.download_suffix_logo_addr as { url_list?: string[] } | undefined)?.url_list ?? [];
  for (const url of suffixList) {
    const id = fileIdFromUrl(url);
    if (id) ids.add(id);
  }
  return ids;
}

function isExplicitWatermarkedUrl(url: string, suffixIds: Set<string>): boolean {
  if (!url.startsWith('http')) return true;
  if (/playwm|watermark=1|logo_name=/i.test(url)) return true;
  const id = fileIdFromUrl(url);
  return !!(id && suffixIds.has(id));
}

/** 从 aweme_detail.video 里挑选最高码率、且非 download_suffix_logo 的 CDN 直链 */
function pickBestVideoUrl(video: Record<string, unknown>): string | null {
  const suffixIds = extractSuffixLogoFileIds(video);
  const candidates: Array<{ url: string; br: number }> = [];

  const pushUrls = (urls: string[] | undefined, br = 0) => {
    for (const url of urls ?? []) {
      if (!isExplicitWatermarkedUrl(url, suffixIds)) {
        candidates.push({ url, br });
      }
    }
  };

  for (const key of ['play_addr_h264', 'play_addr', 'play_addr_265']) {
    pushUrls((video[key] as { url_list?: string[] } | undefined)?.url_list);
  }
  for (const item of (video.bit_rate as Array<{ bit_rate?: number; play_addr?: { url_list?: string[] } }> | undefined) ?? []) {
    pushUrls(item.play_addr?.url_list, item.bit_rate ?? 0);
  }

  const byFile = new Map<string, { url: string; br: number }>();
  for (const c of candidates) {
    const id = fileIdFromUrl(c.url) ?? c.url;
    const prev = byFile.get(id);
    if (!prev || c.br > prev.br) byFile.set(id, c);
  }

  const sorted = [...byFile.values()].sort((a, b) => b.br - a.br);
  if (sorted[0]) return sorted[0].url;

  const uri = (video.play_addr as { uri?: string } | undefined)?.uri;
  if (uri) {
    return `https://www.douyin.com/aweme/v1/play/?video_id=${uri}&source=PackSourceEnum_AWEME_DETAIL&watermark=0`;
  }

  return null;
}

async function resolveDouyinPlayUrl(url: string, cookieStrOverride?: string): Promise<string> {
  if (!url.includes('douyin.com/aweme/v1/play')) return url;
  const cookieHeader = loadDouyinCookies(cookieStrOverride).map(c => `${c.name}=${c.value}`).join('; ');
  const res = await axios.get(url, {
    maxRedirects: 0,
    validateStatus: (s) => s >= 200 && s < 400,
    timeout: 15000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: 'https://www.douyin.com/',
      Cookie: cookieHeader,
    },
  });
  return res.headers.location || url;
}

function firstUrl(value: unknown): string {
  const item = value as { url_list?: string[]; uri?: string } | undefined;
  return item?.url_list?.find((url) => typeof url === 'string' && url.startsWith('http')) || item?.uri || '';
}

function normalizeCount(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function normalizeTextExtras(value: unknown) {
  return ((Array.isArray(value) ? value : []) as Array<Record<string, unknown>>)
    .map((item) => ({
      hashtagName: String(item.hashtag_name || '').trim(),
      userId: String(item.user_id || '').trim(),
      secUid: String(item.sec_uid || '').trim(),
      type: Number(item.type ?? 0),
      start: Number(item.start ?? 0),
      end: Number(item.end ?? 0),
    }))
    .filter((item) => item.hashtagName || item.userId || item.secUid);
}

function normalizeAwemeDetail(detail: Record<string, unknown>, selectedVideoUrl: string, watermark: boolean) {
  const video = (detail.video || {}) as Record<string, unknown>;
  const author = (detail.author || {}) as Record<string, unknown>;
  const music = (detail.music || {}) as Record<string, unknown>;
  const statistics = (detail.statistics || {}) as Record<string, unknown>;
  const textExtra = normalizeTextExtras(detail.text_extra);
  const bitRate = ((Array.isArray(video.bit_rate) ? video.bit_rate : []) as Array<Record<string, unknown>>)[0] || {};

  return {
    desc: String(detail.desc || ''),
    createTime: Number(detail.create_time ?? 0) || undefined,
    shareUrl: String(detail.share_url || ''),
    coverUrl: firstUrl(video.cover) || firstUrl(video.origin_cover) || firstUrl(video.dynamic_cover),
    cover: {
      url: firstUrl(video.cover),
      originUrl: firstUrl(video.origin_cover),
      dynamicUrl: firstUrl(video.dynamic_cover),
    },
    author: {
      id: String(author.uid || ''),
      secUid: String(author.sec_uid || ''),
      shortId: String(author.short_id || ''),
      uniqueId: String(author.unique_id || ''),
      nickname: String(author.nickname || ''),
      signature: String(author.signature || ''),
      avatarUrl: firstUrl(author.avatar_medium) || firstUrl(author.avatar_thumb) || firstUrl(author.avatar_larger),
      profileUrl: author.sec_uid ? 'https://www.douyin.com/user/' + String(author.sec_uid) : '',
      followerCount: normalizeCount(author.follower_count),
      totalFavorited: normalizeCount(author.total_favorited),
    },
    music: {
      id: String(music.id_str || music.mid || ''),
      title: String(music.title || ''),
      author: String(music.author || ''),
      ownerNickname: String(music.owner_nickname || ''),
      duration: normalizeCount(music.duration),
      coverUrl: firstUrl(music.cover_medium) || firstUrl(music.cover_thumb) || firstUrl(music.cover_large),
      playUrl: firstUrl(music.play_url),
    },
    statistics: {
      diggCount: normalizeCount(statistics.digg_count),
      commentCount: normalizeCount(statistics.comment_count),
      collectCount: normalizeCount(statistics.collect_count),
      shareCount: normalizeCount(statistics.share_count),
      playCount: normalizeCount(statistics.play_count),
    },
    hashtags: textExtra.map((item) => item.hashtagName).filter(Boolean),
    mentions: textExtra.filter((item) => item.userId || item.secUid).map((item) => ({
      userId: item.userId,
      secUid: item.secUid,
    })),
    videoMeta: {
      duration: normalizeCount(video.duration) || normalizeCount(detail.duration),
      width: normalizeCount(video.width),
      height: normalizeCount(video.height),
      ratio: String(video.ratio || ''),
      bitrate: normalizeCount(bitRate.bit_rate),
      qualityType: normalizeCount(bitRate.quality_type),
      format: selectedVideoUrl.includes('mime_type=video_mp4') || selectedVideoUrl.includes('.mp4') ? 'mp4' : '',
      selectedUrlWatermark: watermark,
    },
    rawAwemeId: String(detail.aweme_id || ''),
  };
}

export async function parseDouyinWithPlaywright(
  videoId: string,
  target: 'video' | 'note',
  cookieStrOverride?: string
): Promise<PlaywrightDouyinResult> {
  const executablePath = resolveChromeExecutablePath();
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'zh-CN',
    });

    const cookies = loadDouyinCookies(cookieStrOverride);
    if (cookies.length > 0) {
      await context.addCookies(cookies);
    }

    const page = await context.newPage();

        const result = await new Promise<PlaywrightDouyinResult>(
      async (resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error('Playwright 超时（60s）'));
          }
        }, 60000);

        const finishFromDetail = async (detail: Record<string, unknown>) => {
          if (settled) return;
          const video = detail.video as Record<string, unknown> | undefined;
          if (!video) return;

          const title = String(detail.desc ?? '');
          const suffixIds = extractSuffixLogoFileIds(video);
          let videoUrl = pickBestVideoUrl(video);
          if (!videoUrl) return;

          videoUrl = await resolveDouyinPlayUrl(videoUrl, cookieStrOverride);
          const usedExplicitWm = isExplicitWatermarkedUrl(videoUrl, suffixIds);
          // video.has_watermark describes Douyin's video metadata, not the specific CDN URL we selected.
          // Treat the selected direct URL as no-watermark unless it is an explicit watermark/suffix-logo URL.
          const watermark = usedExplicitWm;

          settled = true;
          clearTimeout(timer);
          resolve({ videoUrl, title, watermark, ...normalizeAwemeDetail(detail, videoUrl, watermark) });
        };

        const finishFromNote = async (note: Record<string, unknown>) => {
          if (settled) return;
          const typedNote = note as {
            images?: unknown;
            image_list?: unknown;
            cover?: { images?: unknown } | unknown;
            desc?: unknown;
            title?: unknown;
          };
          const cover = typedNote.cover && typeof typedNote.cover === 'object' ? (typedNote.cover as Record<string, unknown>) : {};
          const images = extractImagesFromUnknownList(
            typedNote.images ?? typedNote.image_list ?? cover?.images
          );
          if (!images.length) return;

          const title: string = String(note?.desc || note?.title || '');
          const first = images[0]?.url || '';
          settled = true;
          clearTimeout(timer);
          resolve({
            videoUrl: '',
            title,
            desc: title,
            watermark: false,
            mediaType: 'image',
            images,
            imageCount: images.length,
            coverUrl: first,
          });
        };

        page.on('response', async resp => {
          const url = resp.url();
          if (!url.includes('/aweme/v1/web/aweme/detail/') && !url.includes('/aweme/v1/web/note/detail/')) return;
          try {
            const json = await resp.json();
            await finishFromDetail(json?.aweme_detail);
            if (!settled && json?.note) {
              await finishFromNote(json.note);
            }
            if (!settled && json?.note_detail) {
              await finishFromNote(json.note_detail);
            }
          } catch { /* ignore */ }
        });

        try {
          const targetUrl = target === 'note' ? `https://www.douyin.com/note/${videoId}` : `https://www.douyin.com/video/${videoId}`;
          await page.goto(targetUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 50000,
          });
        } catch { /* load timeout ok */ }

        await page.waitForTimeout(3000).catch(() => {});

        try {
          const fallbackUrl =
            target === 'note'
              ? `/aweme/v1/web/aweme/detail/?aweme_id=${videoId}&aid=6383&device_platform=webapp`
              : `/aweme/v1/web/aweme/detail/?aweme_id=${videoId}&aid=6383&device_platform=webapp`;
          const json = await page.evaluate(async (path) => {
            const res = await fetch(path, {
              credentials: 'include',
            });
            return await res.json();
          }, fallbackUrl);
          await finishFromDetail(json?.aweme_detail);
          if (!settled && json?.note) {
            await finishFromNote(json.note);
          }
          if (!settled && json?.note_detail) {
            await finishFromNote(json.note_detail);
          }
        } catch { /* active fetch fallback failed; keep waiting for network response */ }

        await page.waitForTimeout(20000).catch(() => {});
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('Playwright 未捕获到视频地址'));
        }
      }
    );

    return result;
  } finally {
    if (process.env.KEEP_BROWSER_OPEN !== 'true') {
      await browser.close();
    }
  }
}
