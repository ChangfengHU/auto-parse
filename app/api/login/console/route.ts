import { NextRequest } from 'next/server';
import { chromium } from 'playwright';

export const dynamic = 'force-dynamic';

// 控制台扫码登录中继:把 84 上专用浏览器(CDP)里的登录二维码以 SSE 推给网页,
// 手机直接扫网页上的码,登录态落在服务器浏览器 profile 里。
const CDP_URL = process.env.LOGIN_BROWSER_CDP_URL || 'http://127.0.0.1:9224';

interface TargetSpec {
  label: string;
  url: string;
  match: string;
  qrSelectors: string[];
  prepare: (page: import('playwright').Page) => Promise<void>;
  loggedIn: (page: import('playwright').Page) => Promise<boolean>;
}

const TARGETS: Record<string, TargetSpec> = {
  yuanbao: {
    label: '腾讯元宝',
    url: 'https://yuanbao.tencent.com/',
    match: 'yuanbao.tencent.com',
    qrSelectors: [
      '[class*="login"] img[src^="data:image"]',
      'img[src^="data:image"]',
      '[class*="qrcode"] img',
      'canvas',
    ],
    prepare: async (page) => {
      const btn = page.locator('button:has-text("Log In"), button:has-text("登录"), text=Log In').first();
      if (await btn.count().catch(() => 0)) await btn.click().catch(() => {});
    },
    loggedIn: async (page) => {
      // 等页面真正渲染出侧栏文本再判定,避免加载骨架期误判
      let text = '';
      for (let i = 0; i < 10; i += 1) {
        text = await page.evaluate(() => document.body.innerText.slice(0, 800)).catch(() => '');
        if (text.replace(/\s/g, '').length > 60) break;
        await page.waitForTimeout(1000);
      }
      if (text.replace(/\s/g, '').length <= 60) return false;
      return !/Not logged in|未登录|请登录后输入内容|Log In/i.test(text);
    },
  },
  mp: {
    label: '微信公众平台',
    url: 'https://mp.weixin.qq.com/',
    match: 'mp.weixin.qq.com',
    qrSelectors: [
      '.login__type__container__scan img',
      'img[src*="qrcode"]',
      'img[src*="getqrcode"]',
    ],
    prepare: async () => {},
    loggedIn: async (page) => /token=\d+|\/cgi-bin\/home/.test(page.url()),
  },
};

// 同一 target 同时只允许一个登录流,避免互相刷新二维码
const activeStreams = new Set<string>();

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('target') || '';
  const spec = TARGETS[target];
  if (!spec) {
    return new Response(JSON.stringify({ error: '未知 target,支持: yuanbao | mp' }), { status: 400 });
  }
  if (activeStreams.has(target)) {
    return new Response(JSON.stringify({ error: '该目标已有登录会话进行中,请稍后再试' }), { status: 409 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      activeStreams.add(target);
      const send = (type: string, payload: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, payload })}\n\n`));
        } catch { /* client gone */ }
      };
      let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
      try {
        send('log', `连接服务器登录浏览器 (${spec.label})...`);
        browser = await chromium.connectOverCDP(CDP_URL, { timeout: 10_000 });
        const ctx = browser.contexts()[0];
        let page = ctx.pages().find((p) => p.url().includes(spec.match));
        if (!page) {
          page = await ctx.newPage();
        }
        await page.bringToFront().catch(() => {});
        await page.goto(spec.url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(2500);

        if (await spec.loggedIn(page)) {
          send('done', JSON.stringify({ target, loggedIn: true, message: '已是登录状态,无需扫码' }));
          return;
        }
        await spec.prepare(page);
        await page.waitForTimeout(1500);

        const captureQr = async (): Promise<string | null> => {
          for (const sel of spec.qrSelectors) {
            const el = page!.locator(sel).first();
            if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
              const buf = await el.screenshot().catch(() => null);
              if (buf && buf.length > 800) return buf.toString('base64');
            }
          }
          const buf = await page!.screenshot().catch(() => null);
          return buf ? buf.toString('base64') : null;
        };

        let lastQr = '';
        const first = await captureQr();
        if (!first) {
          send('error', '未捕获到二维码,请稍后重试');
          return;
        }
        lastQr = first;
        send('qrcode', `data:image/png;base64,${first}`);
        send('log', '请用微信扫描上方二维码;扫描后在手机上点「确认登录」');

        const deadline = Date.now() + 180_000;
        while (Date.now() < deadline) {
          await page.waitForTimeout(3000);
          if (await spec.loggedIn(page)) {
            send('done', JSON.stringify({ target, loggedIn: true, message: '登录成功,会话已保存在服务器浏览器' }));
            return;
          }
          const qr = await captureQr();
          if (qr && qr !== lastQr) {
            lastQr = qr;
            send('refresh', `data:image/png;base64,${qr}`);
          }
        }
        send('error', '3 分钟内未完成登录,请重新发起');
      } catch (err) {
        send('error', err instanceof Error ? err.message : '登录流程异常');
      } finally {
        activeStreams.delete(target);
        if (browser) await browser.close().catch(() => {});
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
