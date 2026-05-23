import { chromium } from 'playwright';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

const COOKIE_FILE = path.join(process.cwd(), '.douyin-cookie.json');

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

function fileIdFromUrl(url: string): string | undefined {
  return url.match(/tos-cn-ve-15\/([^/?]+)/i)?.[1];
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

export async function parseDouyinWithPlaywright(videoId: string, cookieStrOverride?: string): Promise<{
  videoUrl: string;
  title: string;
  watermark: boolean;
}> {
  const browser = await chromium.launch({ headless: true });
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

    const result = await new Promise<{ videoUrl: string; title: string; watermark: boolean }>(
      async (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Playwright 超时（60s）')), 60000);

        page.on('response', async resp => {
          if (!resp.url().includes('/aweme/v1/web/aweme/detail/')) return;
          try {
            const json = await resp.json();
            const detail = json?.aweme_detail;
            const video = detail?.video;
            if (!video) return;

            const title: string = detail.desc ?? '';
            const suffixIds = extractSuffixLogoFileIds(video);
            let videoUrl = pickBestVideoUrl(video);

            if (!videoUrl) return;

            clearTimeout(timer);
            videoUrl = await resolveDouyinPlayUrl(videoUrl, cookieStrOverride);

            const hasPlatformWatermark = !!video.has_watermark;
            const usedExplicitWm = isExplicitWatermarkedUrl(videoUrl, suffixIds);
            const watermark = hasPlatformWatermark || usedExplicitWm;

            resolve({ videoUrl, title, watermark });
          } catch { /* ignore */ }
        });

        try {
          await page.goto(`https://www.douyin.com/video/${videoId}`, {
            waitUntil: 'load',
            timeout: 50000,
          });
        } catch { /* load timeout ok */ }

        await page.waitForTimeout(5000).catch(() => {});
        reject(new Error('Playwright 未捕获到视频地址'));
      }
    );

    return result;
  } finally {
    if (process.env.KEEP_BROWSER_OPEN !== 'true') {
      await browser.close();
    }
  }
}
