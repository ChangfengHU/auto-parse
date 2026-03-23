/**
 * Debug 发布步骤执行 API
 *
 * 仅用于“逐步执行”模式，不再提供浏览器预览流。
 */

import { NextRequest } from 'next/server';
import { getPersistentContext } from '@/lib/persistent-browser';

type DebugContext = {
  videoUrl?: string;
  title?: string;
  description?: string;
  tags?: string;
  clientId?: string;
};

type StepPayload = {
  id?: string;
  type?: string;
  selector?: string;
  params?: Record<string, unknown>;
  context?: DebugContext;
};

function firstSelector(raw: unknown): string | null {
  if (Array.isArray(raw)) {
    const first = raw.find((item) => typeof item === 'string' && item.trim());
    return typeof first === 'string' ? first : null;
  }
  if (typeof raw === 'string' && raw.trim()) return raw;
  return null;
}

async function ensurePage() {
  const context = await getPersistentContext();
  const existing = context.pages()[0];
  if (existing) return existing;
  return context.newPage();
}

async function detectLoggedIn(page: import('playwright').Page): Promise<boolean> {
  const uploadInput = page.locator('input[accept*="video/mp4"]').first();
  if (await uploadInput.isVisible().catch(() => false)) return true;
  const loginMarkers = page.locator('text=扫码登录, text=登录抖音');
  const needLogin = await loginMarkers.first().isVisible().catch(() => false);
  return !needLogin;
}

async function uploadFromUrl(
  page: import('playwright').Page,
  selector: string,
  videoUrl: string
): Promise<{ tempPath: string }> {
  const axios = (await import('axios')).default;
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');

  const tempPath = path.join(os.tmpdir(), `debug-publish-${Date.now()}.mp4`);
  const response = await axios.get(videoUrl, {
    responseType: 'arraybuffer',
    timeout: 180000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  });
  fs.writeFileSync(tempPath, Buffer.from(response.data));
  await page.setInputFiles(selector, tempPath);
  return { tempPath };
}

function resolveType(step: StepPayload): string {
  return step.type ?? '';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, payload } = body as { action?: string; payload?: StepPayload };

    if (action !== 'execute-step') {
      return Response.json({ error: 'Invalid action' }, { status: 400 });
    }
    if (!payload) {
      return Response.json({ error: 'Missing payload' }, { status: 400 });
    }

    const page = await ensurePage();
    const stepType = resolveType(payload);
    const params = payload.params ?? {};
    const stepSelector = firstSelector(params.selector ?? payload.selector);
    const context = payload.context ?? {};
    let tempPathToCleanup: string | null = null;

    try {
      switch (stepType) {
        case 'navigate': {
          const url = typeof params.url === 'string' ? params.url : 'https://creator.douyin.com/creator-micro/content/upload';
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          return Response.json({ success: true, message: `已打开页面：${url}` });
        }

        case 'condition': {
          const loggedIn = await detectLoggedIn(page);
          return Response.json({
            success: loggedIn,
            message: loggedIn ? '检测到已登录状态' : '未登录，请先扫码登录',
          });
        }

        case 'upload': {
          const selector = stepSelector ?? 'input[accept*="video/mp4"]';
          const input = page.locator(selector).first();
          await input.waitFor({ timeout: 30000 });
          if (context.videoUrl?.trim()) {
            const { tempPath } = await uploadFromUrl(page, selector, context.videoUrl.trim());
            tempPathToCleanup = tempPath;
          } else {
            return Response.json({ error: '未提供视频地址（videoUrl）' }, { status: 400 });
          }
          return Response.json({ success: true, message: '视频已注入上传框，等待平台处理' });
        }

        case 'wait': {
          const timeout = typeof params.timeout === 'number' ? params.timeout : 3000;
          await page.waitForTimeout(timeout);
          return Response.json({ success: true, message: `等待完成（${timeout}ms）` });
        }

        case 'type': {
          const selector = stepSelector;
          if (!selector) {
            return Response.json({ error: '缺少输入框选择器' }, { status: 400 });
          }
          const valueRaw =
            typeof params.value === 'string'
              ? params.value
              : payload.id === 'fillTitle'
              ? context.title ?? ''
              : payload.id === 'fillDesc'
              ? context.description ?? ''
              : '';

          await page.fill(selector, valueRaw);
          return Response.json({ success: true, message: `已填写内容（${payload.id ?? stepType}）` });
        }

        case 'click': {
          const selector = stepSelector;
          if (!selector) {
            return Response.json({ error: '缺少点击目标选择器' }, { status: 400 });
          }
          await page.click(selector, { timeout: 10000 });
          return Response.json({ success: true, message: `已点击：${selector}` });
        }

        case 'emit': {
          return Response.json({ success: true, message: '提示类步骤，无需浏览器操作' });
        }

        default:
          return Response.json({ error: `不支持的步骤类型: ${stepType || 'undefined'}` }, { status: 400 });
      }
    } finally {
      if (tempPathToCleanup) {
        const fs = await import('fs');
        fs.unlink(tempPathToCleanup, () => {});
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return Response.json({
    ok: true,
    mode: 'debug-step',
    message: 'Debug 发布步骤执行 API 已就绪',
  });
}
