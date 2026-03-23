import { browserStatus, isPersistentContextLoggedIn, BROWSER_DATA_DIR, IS_HEADLESS } from '@/lib/persistent-browser';
import { NextResponse } from 'next/server';

/**
 * GET /api/browser/status
 *
 * 返回持久化浏览器的当前状态。
 */
export async function GET() {
  const status = browserStatus();
  const loggedIn = status.alive ? await isPersistentContextLoggedIn() : false;

  return NextResponse.json({
    alive: status.alive,
    headless: IS_HEADLESS,
    dataDir: BROWSER_DATA_DIR,
    openPages: status.openPages,
    douyinLoggedIn: loggedIn,
  });
}

/**
 * POST /api/browser/status
 * body: { action: 'start' | 'close' }
 *
 * start → 预热启动持久化浏览器
 * close → 关闭持久化浏览器（慎用）
 */
export async function POST(req: Request) {
  const { action } = await req.json().catch(() => ({}));

  if (action === 'start') {
    const { getPersistentContext } = await import('@/lib/persistent-browser');
    await getPersistentContext();
    const status = browserStatus();
    const loggedIn = await isPersistentContextLoggedIn();
    return NextResponse.json({ ok: true, ...status, douyinLoggedIn: loggedIn });
  }

  if (action === 'close') {
    const { closePersistentBrowser } = await import('@/lib/persistent-browser');
    await closePersistentBrowser();
    return NextResponse.json({ ok: true, alive: false });
  }

  return NextResponse.json({ error: 'action must be start or close' }, { status: 400 });
}
