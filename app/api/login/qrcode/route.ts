import { getPersistentContext, exportDouyinCookieStr } from '@/lib/persistent-browser';
import { randomUUID } from 'crypto';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function upsertSupabase(clientId: string, cookieStr: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/douyin_sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      client_id: clientId,
      cookie_str: cookieStr,
      updated_at: new Date().toISOString(),
    }),
  }).catch(() => {});
}

/**
 * GET /api/login/qrcode
 *
 * SSE 流：
 *   { type: 'qrcode',  payload: 'data:image/png;base64,...' }   — 二维码图片
 *   { type: 'log',     payload: '...' }                          — 进度文字
 *   { type: 'refresh', payload: 'data:image/png;base64,...' }   — 110s 后自动刷新的新二维码
 *   { type: 'done',    payload: JSON({ clientId, loggedIn }) }  — 登录成功并颁发凭证
 *   { type: 'error',   payload: '...' }                          — 失败
 */
export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, payload: string) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type, payload })}\n\n`)
          );
        } catch { /* client disconnected */ }
      };

      try {
        send('log', '🚀 正在启动持久化浏览器...');
        const ctx = await getPersistentContext();

        // 使用独立 page，登录完成后关闭，持久化浏览器继续运行
        const page = await ctx.newPage();
        page.on('dialog', d => d.accept());

        const captureQr = async (): Promise<boolean> => {
          const selectors = [
            '[class*="qrcode_img"]',
            '[class*="qrcode-img"]',
            'canvas[class*="qr"]',
            '[class*="scan_qrcode"] img',
            '[class*="login"] img[src*="qrcode"]',
          ];
          for (const sel of selectors) {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
              const buf = await el.screenshot().catch(() => null);
              if (buf) {
                send('qrcode', `data:image/png;base64,${buf.toString('base64')}`);
                return true;
              }
            }
          }
          // 兜底：整页截图
          const buf = await page.screenshot({ fullPage: false }).catch(() => null);
          if (buf) {
            send('qrcode', `data:image/png;base64,${buf.toString('base64')}`);
            return true;
          }
          return false;
        };

        send('log', '🔐 正在打开抖音登录页...');
        await page
          .goto('https://creator.douyin.com', { waitUntil: 'networkidle', timeout: 30_000 })
          .catch(() => {});
        await page.waitForTimeout(2000);

        // 若持久化浏览器已登录，直接颁发凭证，无需扫码
        const alreadyLoggedIn = await page
          .waitForURL(
            url => {
              const s = url.toString();
              return (
                s.includes('creator-micro') &&
                !s.includes('/login') &&
                !s.includes('qrcode') &&
                !s.includes('passport')
              );
            },
            { timeout: 3000 }
          )
          .then(() => true)
          .catch(() => false);

        if (alreadyLoggedIn) {
          send('log', '✅ 持久化浏览器已登录，无需扫码，直接颁发凭证');
          const cookieStr = await exportDouyinCookieStr();
          const clientId = `dy_${randomUUID().replace(/-/g, '')}`;
          if (cookieStr) await upsertSupabase(clientId, cookieStr);
          send('done', JSON.stringify({ clientId, loggedIn: true, skipped: true }));
          await page.close();
          return;
        }

        // 等待二维码元素出现
        await page
          .waitForSelector(
            '[class*="qrcode_img"], [class*="scan_qrcode"], [class*="login"]',
            { timeout: 10_000 }
          )
          .catch(() => {});

        const gotQr = await captureQr();
        if (gotQr) {
          send('log', '📱 请用抖音 App 扫描二维码（有效期约 3 分钟）');
        } else {
          send('log', '⚠️ 无法截取二维码，已发送整页截图');
        }

        // 每 110s 自动刷新二维码
        let loginDone = false;
        const refreshTimer = setInterval(async () => {
          if (loginDone) return;
          send('log', '🔄 二维码即将过期，正在刷新...');
          await page
            .reload({ waitUntil: 'domcontentloaded', timeout: 15_000 })
            .catch(() => {});
          await page.waitForTimeout(2000);
          const buf = await page.screenshot({ fullPage: false }).catch(() => null);
          if (buf)
            send('refresh', `data:image/png;base64,${buf.toString('base64')}`);
        }, 110_000);

        try {
          // 等待扫码后跳转到已登录页面
          await page.waitForURL(
            url => {
              const s = url.toString();
              return (
                s.includes('creator-micro') &&
                !s.includes('/login') &&
                !s.includes('qrcode') &&
                !s.includes('passport')
              );
            },
            { timeout: 300_000 } // 5 分钟等待
          );
          loginDone = true;
        } finally {
          clearInterval(refreshTimer);
        }

        send('log', '✅ 扫码成功！正在提取 Cookie 并颁发凭证...');
        await page.waitForTimeout(2000); // 等页面 Cookie 稳定

        const cookieStr = await exportDouyinCookieStr();
        let clientId = '';

        if (cookieStr) {
          clientId = `dy_${randomUUID().replace(/-/g, '')}`;
          await upsertSupabase(clientId, cookieStr);
          send('log', `🎉 凭证已颁发：${clientId}`);
          send('log', '💾 Cookie 已同步到发布平台，后续发布无需再次扫码');
        } else {
          send('log', '⚠️ 登录成功但未能提取 Cookie，请稍后重试');
        }

        send('done', JSON.stringify({ clientId, loggedIn: true, hasCookie: !!cookieStr }));

        // 关闭登录页，持久化浏览器保持运行
        await page.close();

      } catch (e: unknown) {
        send('error', e instanceof Error ? e.message : String(e));
      } finally {
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
