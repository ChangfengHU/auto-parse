/**
 * 持久化 Playwright 浏览器单例
 *
 * - 固定 userDataDir → 指纹永远一致、Cookie 自动持久化
 * - 环境变量 BROWSER_HEADLESS=false → 有头模式（本地调试）
 * - 通过 global 变量跨 Next.js 热重载复用实例
 * - 每个任务只开 / 关一个 Page，Context 永不关闭
 */

import { chromium, BrowserContext } from 'playwright';
import path from 'path';
import os from 'os';
import fs from 'fs';

export const BROWSER_DATA_DIR =
  process.env.DOUYIN_BROWSER_DATA_DIR ??
  path.join(os.homedir(), '.douyin-browser-data');

export const IS_HEADLESS = process.env.BROWSER_HEADLESS !== 'false';

const ANTI_BOT_SCRIPT = () => {
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  Object.defineProperty(navigator, 'languages', {
    get: () => ['zh-CN', 'zh', 'en-US', 'en'],
  });
  // @ts-ignore
  window.chrome = { runtime: {} };
  const oq = window.navigator.permissions.query.bind(window.navigator.permissions);
  // @ts-ignore
  window.navigator.permissions.query = (p: PermissionDescriptor) =>
    p.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
      : oq(p);
};

// 用 global 跨热重载保持实例
declare global {
  // eslint-disable-next-line no-var
  var __douyinBrowserCtx: BrowserContext | undefined;
}

/**
 * 启动前修复 Chrome Preferences，将 exit_type 重置为 Normal
 * 防止每次启动弹出「Chromium 未正确关闭，要恢复页面吗？」
 */
function patchChromePreferences(dataDir: string) {
  const prefFile = path.join(dataDir, 'Default', 'Preferences');
  try {
    if (!fs.existsSync(prefFile)) return;
    const raw = fs.readFileSync(prefFile, 'utf-8');
    const prefs = JSON.parse(raw);
    let changed = false;
    if (prefs?.profile?.exit_type !== 'Normal') {
      prefs.profile = prefs.profile ?? {};
      prefs.profile.exit_type = 'Normal';
      changed = true;
    }
    if (prefs?.profile?.crashed_session_version !== undefined) {
      delete prefs.profile.crashed_session_version;
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(prefFile, JSON.stringify(prefs), 'utf-8');
    }
  } catch {
    // 静默失败，不影响启动
  }
}

let launching = false;

export async function getPersistentContext(): Promise<BrowserContext> {
  // 已有实例且存活 → 直接返回
  if (global.__douyinBrowserCtx) {
    try {
      global.__douyinBrowserCtx.pages(); // 若已关闭会 throw
      return global.__douyinBrowserCtx;
    } catch {
      global.__douyinBrowserCtx = undefined;
    }
  }

  // 防止并发重复启动
  if (launching) {
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (global.__douyinBrowserCtx) return global.__douyinBrowserCtx;
    }
    throw new Error('持久化浏览器启动超时');
  }

  launching = true;
  try {
    // 启动前把 Preferences 里的 exit_type 改成 Normal，防止「恢复页面」弹窗
    patchChromePreferences(BROWSER_DATA_DIR);

    console.log(
      `[Browser] 启动持久化浏览器  headless=${IS_HEADLESS}  dataDir=${BROWSER_DATA_DIR}`
    );

    const ctx = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
      headless: IS_HEADLESS,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'zh-CN',
      viewport: { width: 1280, height: 800 },
      // 明确不授予任何权限（清除历史授权）
      permissions: [],
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        // 自动拒绝所有权限弹窗（地理位置、通知、麦克风等）
        '--deny-permission-prompts',
        '--disable-notifications',
        // 禁止「未正确关闭」恢复弹窗
        '--no-session-crashed-bubble',
        '--disable-session-restore-from-crash',
      ],
    });

    // 清除持久化 userDataDir 中残留的权限授权
    await ctx.clearPermissions();

    await ctx.addInitScript(ANTI_BOT_SCRIPT);

    ctx.on('close', () => {
      console.log('[Browser] 持久化浏览器已关闭，下次请求时将自动重启');
      global.__douyinBrowserCtx = undefined;
    });

    global.__douyinBrowserCtx = ctx;
    return ctx;
  } finally {
    launching = false;
  }
}

/** 检查持久化浏览器当前是否已登录抖音（通过 Cookie 判断） */
export async function isPersistentContextLoggedIn(): Promise<boolean> {
  try {
    const ctx = await getPersistentContext();
    const cookies = await ctx.cookies(['https://creator.douyin.com']);
    const sessionid = cookies.find(c => c.name === 'sessionid');
    const uid_tt = cookies.find(c => c.name === 'uid_tt');
    return !!(sessionid?.value && uid_tt?.value);
  } catch {
    return false;
  }
}

/** 将持久化浏览器当前的抖音 Cookie 导出为字符串（供 Supabase 同步） */
export async function exportDouyinCookieStr(): Promise<string | null> {
  try {
    const ctx = await getPersistentContext();
    const cookies = await ctx.cookies([
      'https://www.douyin.com',
      'https://creator.douyin.com',
    ]);
    const relevant = cookies.filter(c => c.domain.includes('douyin.com'));
    if (relevant.length === 0) return null;
    return relevant.map(c => `${c.name}=${c.value}`).join('; ');
  } catch {
    return null;
  }
}

/** 关闭持久化浏览器（一般不需要调用） */
export async function closePersistentBrowser(): Promise<void> {
  if (global.__douyinBrowserCtx) {
    await global.__douyinBrowserCtx.close().catch(() => {});
    global.__douyinBrowserCtx = undefined;
  }
}

/** 浏览器状态快照（供 /api/browser/status 使用） */
export function browserStatus() {
  const alive = (() => {
    try {
      if (!global.__douyinBrowserCtx) return false;
      global.__douyinBrowserCtx.pages();
      return true;
    } catch {
      return false;
    }
  })();

  const pageCount = alive
    ? (() => {
        try {
          return global.__douyinBrowserCtx!.pages().length;
        } catch {
          return 0;
        }
      })()
    : 0;

  return {
    alive,
    headless: IS_HEADLESS,
    dataDir: BROWSER_DATA_DIR,
    openPages: pageCount,
  };
}
