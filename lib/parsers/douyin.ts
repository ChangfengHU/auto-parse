import axios from 'axios';
import { hasDouyinAuth, parseDouyinWithPlaywright } from './douyin-playwright';

const UA_MOBILE =
  'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

interface DouyinShareImage {
  url: string;
  width?: number;
  height?: number;
  uri?: string;
}

export interface ParseResult {
  platform: 'douyin';
  videoId: string;
  videoUrl: string;
  mediaType?: 'video' | 'image';
  title?: string;
  desc?: string;
  coverUrl?: string;
  createTime?: number;
  shareUrl?: string;
  cover?: unknown;
  author?: unknown;
  music?: unknown;
  statistics?: unknown;
  hashtags?: string[];
  mentions?: unknown[];
  videoMeta?: unknown;
  imageCount?: number;
  images?: DouyinShareImage[];
  watermark: boolean;
}

export interface ParseDouyinOptions {
  cookieStr?: string;
}

function normalizeShareImageSize(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function normalizeShareImageUrl(url: unknown): string {
  if (typeof url !== 'string') return '';
  return url.trim().replace(/\\+/g, '');
}

function extractArrayTextAfterKey(html: string, key: string): string | null {
  const keyIndex = html.indexOf(`\"${key}\"`);
  if (keyIndex < 0) return null;

  const openBracket = html.indexOf('[', keyIndex);
  if (openBracket < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openBracket; i < html.length; i += 1) {
    const ch = html[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === '\\\\') {
        escaped = true;
        continue;
      }

      if (ch === '"') {
        inString = false;
      }

      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '[') {
      depth += 1;
      continue;
    }

    if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        return html.slice(openBracket, i + 1);
      }
    }
  }

  return null;
}

function parseDouyinShareImages(html: string): DouyinShareImage[] {
  const raw = extractArrayTextAfterKey(html, 'images');
  if (!raw) return [];

  let imageArray: unknown;
  try {
    imageArray = JSON.parse(raw);
  } catch (err) {
    return [];
  }

  if (!Array.isArray(imageArray)) return [];

  return imageArray
    .reduce<DouyinShareImage[]>((list, item) => {
      if (!item || typeof item !== 'object') return list;

      const source = item as Record<string, unknown>;
      const urlCandidates = Array.isArray(source.url_list)
        ? (source.url_list as unknown[]).filter((itemCandidate) => typeof itemCandidate === 'string') as string[]
        : [];
      const firstUrl = normalizeShareImageUrl(urlCandidates[0] ?? source.url);

      if (!firstUrl) return list;

      list.push({
        url: firstUrl,
        uri: normalizeShareImageUrl(source.uri),
        width: normalizeShareImageSize(source.width),
        height: normalizeShareImageSize(source.height),
      });

      return list;
    }, []);
}

function buildImageResult(
  input: { videoId: string; title?: string; videoIdFallback?: string },
  images: DouyinShareImage[]
): ParseResult {
  const imageCount = images.length;
  const firstImage = images[0]?.url || '';
  return {
    platform: 'douyin',
    videoId: input.videoId || input.videoIdFallback || Date.now().toString(),
    videoUrl: '',
    mediaType: 'image',
    images,
    imageCount,
    title: input.title,
    coverUrl: firstImage,
    desc: input.title,
    watermark: false,
  };
}

export async function parseDouyin(input: string, options: ParseDouyinOptions = {}): Promise<ParseResult> {
  // 从分享文本中提取短链
  const urlMatch = input.match(/https?:\/\/v\.douyin\.com\/[A-Za-z0-9_\-]+\/?/);
  if (!urlMatch) throw new Error('未找到有效的抖音分享链接');
  const shortUrl = urlMatch[0];

  // 第1跳：短链 → iesdouyin 重定向，拿到数字 videoId
  const step1 = await axios.get(shortUrl, {
    maxRedirects: 0,
    validateStatus: (s) => s >= 200 && s < 400,
    headers: { 'User-Agent': UA_MOBILE },
    timeout: 10000,
  });
  const iesdouyinUrl: string = step1.headers['location'];
  if (!iesdouyinUrl) throw new Error('短链解析失败，未获取到重定向地址');

  const videoIdMatch = iesdouyinUrl.match(/\/video\/(\d+)/);
  const noteIdMatch = iesdouyinUrl.match(/\/note\/(\d+)/);
  const contentId = videoIdMatch?.[1] || noteIdMatch?.[1] || '';

  const cookieStr = options.cookieStr?.trim() || undefined;

  // 优先：用 Playwright 打开页面，注入 Cookie，拦截真实视频地址（无水印）
  if (videoIdMatch && hasDouyinAuth(cookieStr)) {
    try {
      const detail = await parseDouyinWithPlaywright(contentId, cookieStr);
      if ((detail as { mediaType?: 'video' | 'image' }).mediaType === 'image') {
        return {
          platform: 'douyin',
          videoId: contentId || Date.now().toString(),
          ...detail,
        } as ParseResult;
      }
      return { platform: 'douyin', videoId: contentId || Date.now().toString(), ...detail } as ParseResult;
    } catch (e) {
      console.warn('[douyin] Playwright 失败，降级走 playwm:', e instanceof Error ? e.message : e);
    }
  }

  // 降级：抓分享页 HTML → playwm → CDN（带水印）
  const step2 = await axios.get(iesdouyinUrl, {
    headers: { 'User-Agent': UA_MOBILE, Referer: 'https://www.douyin.com/' },
    timeout: 15000,
  });
  const html: string = step2.data;
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/);
  const title = titleMatch?.[1]?.replace(/ - 抖音$/, '').trim();
  const images = parseDouyinShareImages(html);

  if (images.length) {
    return buildImageResult({ videoId: contentId, title }, images);
  }

  const vidMatch = html.match(/video_id=(v[a-z0-9]+)/);
  if (!vidMatch) throw new Error('页面中未找到视频或图片地址，可能内容过期或页面结构已变更');
  const internalVideoId = vidMatch[1];

  const playwmUrl = `https://aweme.snssdk.com/aweme/v1/playwm/?video_id=${internalVideoId}&ratio=720p&line=0`;
  const step3 = await axios.get(playwmUrl, {
    maxRedirects: 0,
    validateStatus: (s) => s >= 200 && s < 400,
    headers: { 'User-Agent': UA_MOBILE, Referer: 'https://www.douyin.com/' },
    timeout: 10000,
  });
  const cdnUrl: string = step3.headers['location'];
  if (!cdnUrl) throw new Error('无法获取视频 CDN 地址');

  return { platform: 'douyin', videoId: contentId || Date.now().toString(), videoUrl: cdnUrl, title, watermark: true };
}

// 快速模式：不用 Playwright，直接走 playwm（带水印，约 3s）
export async function parseDouyinFast(input: string): Promise<ParseResult> {
  const urlMatch = input.match(/https?:\/\/v\.douyin\.com\/[A-Za-z0-9_\-]+\/?/);
  if (!urlMatch) throw new Error('未找到有效的抖音分享链接');
  const shortUrl = urlMatch[0];

  const step1 = await axios.get(shortUrl, {
    maxRedirects: 0,
    validateStatus: (s) => s >= 200 && s < 400,
    headers: { 'User-Agent': UA_MOBILE },
    timeout: 10000,
  });
  const iesdouyinUrl: string = step1.headers['location'];
  if (!iesdouyinUrl) throw new Error('短链解析失败');

  const videoIdMatch = iesdouyinUrl.match(/\/video\/(\d+)/);
  const noteIdMatch = iesdouyinUrl.match(/\/note\/(\d+)/);
  const contentId = videoIdMatch?.[1] || noteIdMatch?.[1] || '';

  const step2 = await axios.get(iesdouyinUrl, {
    headers: { 'User-Agent': UA_MOBILE, Referer: 'https://www.douyin.com/' },
    timeout: 15000,
  });
  const html: string = step2.data;
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/);
  const title = titleMatch?.[1]?.replace(/ - 抖音$/, '').trim();

  const images = parseDouyinShareImages(html);
  if (images.length) {
    return buildImageResult({ videoId: contentId, title }, images);
  }

  const vidMatch = html.match(/video_id=(v[a-z0-9]+)/);
  if (!vidMatch) throw new Error('页面中未找到视频或图片地址');
  const internalVideoId = vidMatch[1];

  const playwmUrl = `https://aweme.snssdk.com/aweme/v1/playwm/?video_id=${internalVideoId}&ratio=720p&line=0`;
  const step3 = await axios.get(playwmUrl, {
    maxRedirects: 0,
    validateStatus: (s) => s >= 200 && s < 400,
    headers: { 'User-Agent': UA_MOBILE, Referer: 'https://www.douyin.com/' },
    timeout: 10000,
  });
  const cdnUrl: string = step3.headers['location'];
  if (!cdnUrl) throw new Error('无法获取视频 CDN 地址');

  return { platform: 'douyin', videoId: videoIdMatch?.[1] || contentId || Date.now().toString(), videoUrl: cdnUrl, title, watermark: true };
}
