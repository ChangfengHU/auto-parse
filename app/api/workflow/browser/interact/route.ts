/**
 * POST /api/workflow/browser/interact
 *
 * 远程操控浏览器页面（点击、输入、滚动、按键）。
 * 用于无法直接看到浏览器窗口时的远程遥控。
 *
 * body: {
 *   sessionId?: string   — 指定 session 页（不传则用草稿页）
 *   action: 'click' | 'type' | 'scroll' | 'key' | 'screenshot'
 *   x?: number           — 点击/滚动的 X 坐标（相对视口，0-1280）
 *   y?: number           — 点击/滚动的 Y 坐标（相对视口，0-800）
 *   text?: string        — 输入文字（action=type）
 *   key?: string         — 按键名（action=key，如 'Enter', 'Escape', 'Tab'）
 *   deltaY?: number      — 滚动量（action=scroll，正数向下）
 * }
 */

import { NextResponse } from 'next/server';
import type { Page } from 'playwright';
import { getDebugScratchPage } from '@/lib/persistent-browser';
import { getSession } from '@/lib/workflow/session-store';

type InteractAction = 'click' | 'type' | 'scroll' | 'key' | 'screenshot';

async function getPage(sessionId?: string): Promise<Page | null> {
  if (sessionId) {
    const session = getSession(sessionId);
    return session?._page ?? null;
  }
  return getDebugScratchPage();
}

export async function POST(req: Request) {
  const body = await req.json() as {
    sessionId?: string;
    action: InteractAction;
    x?: number;
    y?: number;
    text?: string;
    key?: string;
    deltaY?: number;
  };

  const { sessionId, action, x, y, text, key, deltaY } = body;

  try {
    const page = await getPage(sessionId);
    if (!page) {
      return NextResponse.json({ error: '页面未初始化，请先执行一个节点' }, { status: 404 });
    }

    switch (action) {
      case 'click': {
        if (x == null || y == null) return NextResponse.json({ error: 'x, y required' }, { status: 400 });
        
        // 拟人化：先移动鼠标。Cloudflare 会检测鼠标移动路径。
        // 从当前（或随机位置）移动到目标位置，增加一些随机延迟。
        await page.mouse.move(x + (Math.random() * 10 - 5), y + (Math.random() * 10 - 5), { steps: 5 });
        await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
        await page.mouse.click(x, y, { delay: 50 + Math.random() * 50 });
        break;
      }
      case 'type': {
        if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });
        await page.keyboard.type(text, { delay: 60 });
        break;
      }
      case 'key': {
        if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });
        await page.keyboard.press(key);
        break;
      }
      case 'scroll': {
        if (x == null || y == null) return NextResponse.json({ error: 'x, y required' }, { status: 400 });
        await page.mouse.wheel(0, deltaY ?? 300);
        break;
      }
      case 'screenshot': {
        // 仅截图，不操作
        break;
      }
    }

    // 操作后截图返回最新状态
    const buf = await page.screenshot({ type: 'jpeg', quality: 80 }).catch(() => null);
    const screenshot = buf ? `data:image/jpeg;base64,${buf.toString('base64')}` : null;
    const currentUrl = page.url();

    return NextResponse.json({ ok: true, screenshot, url: currentUrl });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
