import { chromium } from 'playwright';

const DOUYIN_COOKIE = process.env.DOUYIN_COOKIE || '';

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

    if (DOUYIN_COOKIE) {
      await context.addCookies(parseCookies(DOUYIN_COOKIE));
    }

    const page = await context.newPage();

    // 用 Promise 提前返回，一旦拿到 detail API 结果立刻 resolve
    const result = await new Promise<{ videoUrl: string; title: string; watermark: boolean }>(
      async (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Playwright 超时（30s）')), 30000);

        page.on('response', async resp => {
          const url = resp.url();
          if (!url.includes('/aweme/v1/web/aweme/detail/')) return;
          try {
            const json = await resp.json();
            const detail = json?.aweme_detail;
            if (!detail?.video) return;

            const title: string = detail.desc ?? '';
            // download_addr = 无水印，play_addr = 有水印
            const dlUrls: string[] = detail.video?.download_addr?.url_list ?? [];
            const plUrls: string[] = detail.video?.play_addr?.url_list ?? [];
            const videoUrl = dlUrls[0] || plUrls[0];

            if (videoUrl) {
              clearTimeout(timer);
              resolve({ videoUrl, title, watermark: !dlUrls[0] });
            }
          } catch { /* ignore parse errors */ }
        });

        // 用 load（不用 networkidle，抖音页面永远不会 idle）
        try {
          await page.goto(`https://www.douyin.com/video/${videoId}`, {
            waitUntil: 'load',
            timeout: 25000,
          });
        } catch (e) {
          // load 超时也没关系，response 事件可能已经触发了
          console.warn('[playwright] goto timeout, checking if we already got the result...');
        }

        // 额外等 5s，给 API 响应一点时间
        await page.waitForTimeout(5000).catch(() => {});
        reject(new Error('Playwright 未捕获到视频地址'));
      }
    );

    return result;
  } finally {
    await browser.close();
  }
}
