import axios from 'axios';

const UA_MOBILE =
  'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const UA_PC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

  // 尝试用 Cookie 调用 Web API 获取无水印地址
  const cookie = process.env.DOUYIN_COOKIE;
  if (cookie && videoId) {
    try {
      const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${videoId}&aid=6383&cookie_enabled=true&platform=PC&downlink=10`;
      const apiResp = await axios.get(apiUrl, {
        headers: {
          'User-Agent': UA_PC,
          Referer: 'https://www.douyin.com/',
          Cookie: cookie,
        },
        timeout: 15000,
      });

      const detail = apiResp.data?.aweme_detail;
      if (detail) {
        const title: string = detail.desc ?? '';
        // download_addr 为无水印，play_addr 为有水印，优先取无水印
        const downloadUrls: string[] = detail.video?.download_addr?.url_list ?? [];
        const playUrls: string[] = detail.video?.play_addr?.url_list ?? [];
        const videoUrl = downloadUrls[0] || playUrls[0];
        if (videoUrl) {
          return {
            platform: 'douyin',
            videoId,
            videoUrl,
            title,
            watermark: !downloadUrls[0],
          };
        }
      }
    } catch {
      // API 失败，降级走 playwm
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
