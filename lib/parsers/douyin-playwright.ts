import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const COOKIE_FILE = path.join(process.cwd(), '.douyin-cookie.json');

// 动态读取 Cookie：优先用插件写入的文件，降级用 env（热重载，无需重启）
function getDouyinCookie(): string {
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      const data = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
      if (data.cookie) return data.cookie;
    }
  } catch { /* ignore */ }
  return process.env.DOUYIN_COOKIE || '';
}

function parseCookies(cookieStr: string) {
  return cookieStr.split(';').map(c => {
    const idx = c.indexOf('=');
    return {
      name: c.slice(0, idx).trim(),
      value: c.slice(idx + 1).trim(),
      domain: '.douyin.com',
      path: '/',
    };
  }).filter(c => c.name && c.value);
}

export async function parseDouyinWithPlaywright(videoId: string): Promise<{
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

    const cookie = getDouyinCookie();
    if (cookie) {
      await context.addCookies(parseCookies(cookie));
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
            if (!detail?.video) return;

            const title: string = detail.desc ?? '';

            // play_addr = 播放流，无嵌入水印（download_addr 才有水印）
            // 优先 play_addr_h264 > play_addr > download_addr
            const h264Urls: string[] = detail.video?.play_addr_h264?.url_list ?? [];
            const playUrls: string[] = detail.video?.play_addr?.url_list ?? [];
            const dlUrls: string[] = detail.video?.download_addr?.url_list ?? [];

            const videoUrl = h264Urls[0] || playUrls[0] || dlUrls[0];

            if (videoUrl) {
              clearTimeout(timer);
              // play_addr / play_addr_h264 均无水印；download_addr 有水印
              const watermark = !h264Urls[0] && !playUrls[0];
              resolve({ videoUrl, title, watermark });
            }
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
    await browser.close();
  }
}
