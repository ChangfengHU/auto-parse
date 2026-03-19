import axios from 'axios';
import { parseDouyinWithPlaywright } from './douyin-playwright';

const UA_MOBILE =
  'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

export interface ParseResult {
  platform: 'douyin';
  videoId: string;
  videoUrl: string;
  title?: string;
  watermark: boolean;
}

export async function parseDouyin(input: string): Promise<ParseResult> {
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
  const videoId = videoIdMatch?.[1] ?? '';

  // 优先：用 Playwright 打开页面，注入 Cookie，拦截真实视频地址（无水印）
  if (videoId && process.env.DOUYIN_COOKIE) {
    try {
      const { videoUrl, title, watermark } = await parseDouyinWithPlaywright(videoId);
      return { platform: 'douyin', videoId, videoUrl, title, watermark };
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

  const vidMatch = html.match(/video_id=(v[a-z0-9]+)/);
  if (!vidMatch) throw new Error('页面中未找到视频地址，可能需要登录或页面结构已变更');
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

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/);
  const title = titleMatch?.[1]?.replace(/ - 抖音$/, '').trim();

  return { platform: 'douyin', videoId: videoId || Date.now().toString(), videoUrl: cdnUrl, title, watermark: true };
}
