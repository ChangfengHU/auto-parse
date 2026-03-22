import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const COOKIE_FILE = path.join(process.cwd(), '.douyin-cookie.json');

// GET /api/login/qrcode → SSE：直接跳到抖音二维码登录页，不做已登录预检
// 适合前端主动发起扫码时调用，用户扫码后 Cookie 自动保存
export async function GET() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, payload: string) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, payload })}\n\n`)); }
        catch { /* client disconnected */ }
      };

      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          locale: 'zh-CN',
          viewport: { width: 1280, height: 800 },
        });
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        const page = await context.newPage();
        page.on('dialog', d => d.accept());

        send('log', '🔐 正在打开抖音登录页...');
        await page.goto('https://creator.douyin.com', { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(2000);

        const sendQr = async () => {
          await page.waitForSelector('[class*="qrcode_img"]', { timeout: 15_000 }).catch(() => {});
          let buf: Buffer | null = null;
          const qrImg = page.locator('[class*="qrcode_img"]').first();
          if (await qrImg.isVisible().catch(() => false)) {
            buf = await qrImg.screenshot().catch(() => null);
          }
          if (!buf) {
            const qrPanel = page.locator('[class*="scan_qrcode_login"]').first();
            if (await qrPanel.isVisible().catch(() => false)) {
              buf = await qrPanel.screenshot().catch(() => null);
            }
          }
          if (!buf) buf = await page.screenshot({ fullPage: false }).catch(() => null);
          if (buf) {
            send('qrcode', `data:image/png;base64,${buf.toString('base64')}`);
            send('log', '📱 请用抖音 App 扫描二维码（约 3 分钟有效）');
          } else {
            send('log', '⚠️ 无法获取二维码，请稍后重试');
          }
        };

        await sendQr();

        let loginDone = false;
        const refreshTimer = setInterval(async () => {
          if (loginDone) return;
          send('log', '🔄 二维码即将过期，正在刷新...');
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
          await page.waitForTimeout(2000);
          await sendQr();
        }, 50_000);

        try {
          // 等跳转到已登录页面（排除 login/qrcode/passport 等未登录页）
          await page.waitForURL(
            url => {
              const s = url.toString();
              return s.includes('creator-micro') &&
                     !s.includes('/login') &&
                     !s.includes('qrcode') &&
                     !s.includes('passport');
            },
            { timeout: 180_000 }
          );
          loginDone = true;
        } finally {
          clearInterval(refreshTimer);
        }

        send('log', '✅ 扫码登录成功，保存 Cookie...');
        const newCookies = await context.cookies();
        const douyinCookies = newCookies.filter(c => c.domain.includes('douyin.com'));
        if (douyinCookies.length > 0) {
          fs.writeFileSync(COOKIE_FILE,
            JSON.stringify({ cookies: douyinCookies, updatedAt: Date.now() }, null, 2));
          send('log', '✅ Cookie 已保存，发布时将自动跳过登录检测');
        }
        send('done', JSON.stringify({ loggedIn: true }));

      } catch (e: unknown) {
        send('error', e instanceof Error ? e.message : String(e));
      } finally {
        await browser.close();
        try { controller.close(); } catch { /* ignore */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
