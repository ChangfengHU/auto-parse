import { NextResponse } from 'next/server';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';

const COOKIE_FILE = path.join(process.cwd(), '.douyin-cookie.json');
const LOCK_FILE   = path.join(os.tmpdir(), 'douyin-publish.lock');
const UPLOAD_URL  = 'https://creator.douyin.com/creator-micro/content/upload';

function loadCookies(): Parameters<import('playwright').BrowserContext['addCookies']>[0] {
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      const data = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
      if (Array.isArray(data.cookies) && data.cookies.length > 0) return data.cookies;
    }
  } catch { /* ignore */ }
  return [];
}

function isPublishLocked(): boolean {
  if (!fs.existsSync(LOCK_FILE)) return false;
  try {
    const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf-8').trim(), 10);
    try { process.kill(pid, 0); return true; } catch { return false; }
  } catch { return false; }
}

// GET /api/login → 快速返回 Cookie 文件状态（不开浏览器）
export async function GET() {
  if (!fs.existsSync(COOKIE_FILE)) {
    return NextResponse.json({ loggedIn: false, reason: 'no_cookie_file' });
  }
  try {
    const stat = fs.statSync(COOKIE_FILE);
    const data = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
    const hasCookies = Array.isArray(data?.cookies) && data.cookies.length > 0;
    const ageHours = Math.round((Date.now() - stat.mtimeMs) / 3_600_000);
    return NextResponse.json({
      loggedIn: hasCookies,
      cookieAgeHours: ageHours,
      updatedAt: new Date(stat.mtimeMs).toLocaleString('zh-CN'),
    });
  } catch {
    return NextResponse.json({ loggedIn: false, reason: 'parse_error' });
  }
}

// POST /api/login → SSE：打开浏览器检测登录，未登录则推送二维码并等待扫码
export async function POST() {
  if (isPublishLocked()) {
    return NextResponse.json({ error: '发布任务进行中，暂无法检测登录' }, { status: 409 });
  }

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

        const cookies = loadCookies();
        if (cookies.length > 0) await context.addCookies(cookies);

        const page = await context.newPage();
        page.on('dialog', d => d.accept());

        send('log', '🔍 正在检测登录状态...');
        await page.goto(UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForTimeout(3000);

        const uploadInput = page.locator('input[accept*="video/mp4"]').first();
        const isLoggedIn = await uploadInput.waitFor({ state: 'visible', timeout: 12_000 })
          .then(() => true).catch(() => false);

        if (isLoggedIn) {
          send('log', '✅ 已登录，Cookie 有效');
          send('done', JSON.stringify({ loggedIn: true }));
          return;
        }

        // 未登录 → 获取二维码
        send('log', '⚠️ 未检测到登录状态，正在获取扫码二维码...');
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
          if (!buf) {
            buf = await page.screenshot({ fullPage: false }).catch(() => null);
          }
          if (buf) {
            send('qrcode', `data:image/png;base64,${buf.toString('base64')}`);
            send('log', '📱 请用抖音 App 扫描二维码登录（约 3 分钟有效）');
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
          await page.waitForURL(
            url => url.toString().includes('creator.douyin.com/creator-micro'),
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
          send('log', '✅ Cookie 已保存，下次发布无需扫码');
        }

        send('done', JSON.stringify({ loggedIn: true, message: '登录成功' }));

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
