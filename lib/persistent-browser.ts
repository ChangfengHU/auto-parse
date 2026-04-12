/**
 * 持久化 Playwright 浏览器单例
 *
 * - 固定 userDataDir → 指纹永远一致、Cookie 自动持久化
 * - 环境变量 BROWSER_HEADLESS=false → 有头模式（本地调试）
 * - 通过 global 变量跨 Next.js 热重载复用实例
 * - 每个任务只开 / 关一个 Page，Context 永不关闭
 */

import { chromium, BrowserContext } from 'playwright';
import { getRuntimeBackendConfigSync } from '@/lib/runtime/backend-config';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { IdleSimulator } from './workflow/idle-simulator';

export const BROWSER_DATA_DIR =
  process.env.DOUYIN_BROWSER_DATA_DIR ??
  path.join(os.homedir(), '.douyin-browser-data');

export function getConfiguredBrowserHeadless(): boolean {
  try {
    return Boolean(getRuntimeBackendConfigSync().browser?.headless);
  } catch {
    return process.env.BROWSER_HEADLESS !== 'false';
  }
}
export const IS_IDLE_SIMULATION = process.env.BROWSER_IDLE_SIMULATION === 'true';

/**
 * 解析代理配置
 * 支持两种格式：
 *   - 标准 URL:  http://user:pass@host:port
 *   - 简写格式:  host:port:user:pass
 */
function parseBrowserProxy(raw: string): { server: string; username?: string; password?: string } | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  // 标准 URL 格式
  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('socks5://')) {
    try {
      const u = new URL(s);
      return {
        server: `${u.protocol}//${u.hostname}:${u.port}`,
        username: u.username || undefined,
        password: u.password || undefined,
      };
    } catch { return { server: s }; }
  }
  // 简写格式: host:port:user:pass
  const parts = s.split(':');
  if (parts.length >= 2) {
    const server = `http://${parts[0]}:${parts[1]}`;
    return {
      server,
      username: parts[2] || undefined,
      password: parts[3] || undefined,
    };
  }
  return { server: s };
}

export const BROWSER_PROXY = parseBrowserProxy(process.env.BROWSER_PROXY_SERVER ?? '');

const ANTI_BOT_SCRIPT = () => {
  // 隐藏 webdriver
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  
  // 模拟 Chrome 特色属性
  // @ts-expect-error injected for anti-bot compatibility
  window.chrome = {
    runtime: {},
    loadTimes: function() {},
    csi: function() {},
    app: {}
  };

  // 模拟插件列表
  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { description: "Portable Document Format", filename: "internal-pdf-viewer", name: "Chrome PDF Viewer" },
      { description: "", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", name: "Chrome PDF Viewer" }
    ]
  });

  // 模拟语言环境
  Object.defineProperty(navigator, 'languages', {
    get: () => ['zh-CN', 'zh', 'en-US', 'en'],
  });

  // 修复权限查询
  const oq = window.navigator.permissions.query.bind(window.navigator.permissions);
  window.navigator.permissions.query = (p: PermissionDescriptor) =>
    p.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
      : oq(p);

  // 隐藏 WebGL 指纹风险
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(parameter) {
    if (parameter === 37445) return 'Intel Inc.';
    if (parameter === 37446) return 'Intel(R) Iris(TM) Plus Graphics 640';
    return getParameter.apply(this, [parameter]);
  };
};

// 用 global 跨热重载保持实例
declare global {
  var __douyinBrowserCtx: BrowserContext | undefined;
  var __douyinBrowserHeadless: boolean | undefined;
  var __browserIdleSim: IdleSimulator | undefined;
  var __debugScratchPage: import('playwright').Page | undefined;
  // 单节点调试时，如发生 CDP 接管（AdsPower / connectOverCDP），需要保留 Browser 引用，
  // 否则连接可能在请求结束后被 GC/断开，导致下一节点看起来“没接力”。
  var __debugScratchBrowser: import('playwright').Browser | undefined;
}

/**
 * 启动前修复 Chrome Preferences，将 exit_type 重置为 Normal
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
    // 静默失败
  }
}

let launching = false;

export async function getPersistentContext(): Promise<BrowserContext> {
  if (global.__douyinBrowserCtx) {
    try {
      global.__douyinBrowserCtx.pages();
      return global.__douyinBrowserCtx;
    } catch {
      global.__douyinBrowserCtx = undefined;
    }
  }

  if (launching) {
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (global.__douyinBrowserCtx) return global.__douyinBrowserCtx;
    }
    throw new Error('持久化浏览器启动超时');
  }

  launching = true;
  try {
    patchChromePreferences(BROWSER_DATA_DIR);
    const configuredHeadless = getConfiguredBrowserHeadless();
    console.log(`[Browser] 启动持久化浏览器  headless=${configuredHeadless}  dataDir=${BROWSER_DATA_DIR}`);

    const channel = process.env.BROWSER_CHANNEL as 'chrome' | 'msedge' | undefined;

    if (BROWSER_PROXY) {
      console.log(`[Browser] 代理已启用: ${BROWSER_PROXY.server}${BROWSER_PROXY.username ? ` (用户: ${BROWSER_PROXY.username})` : ''}`);
    }

    const ctx = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
      channel,
      headless: configuredHeadless,
      ...(BROWSER_PROXY ? { proxy: BROWSER_PROXY } : {}),
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ':99',
      },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
      locale: 'zh-CN',
      viewport: { width: 1280, height: 800 },
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-position=0,0',
        '--enable-webgl',
        '--ignore-certificate-errors',
        '--deny-permission-prompts',
        '--disable-notifications',
        // 启用远程调试端口
        '--remote-debugging-port=1009',
        '--remote-debugging-address=0.0.0.0',
      ],
    });

    await ctx.clearPermissions();
    await ctx.addInitScript(ANTI_BOT_SCRIPT);

    ctx.on('close', () => {
      console.log('[Browser] 持久化浏览器已关闭');
      global.__douyinBrowserCtx = undefined;
      global.__browserIdleSim?.stop();
    });

    global.__douyinBrowserCtx = ctx;
    global.__douyinBrowserHeadless = configuredHeadless;

    if (IS_IDLE_SIMULATION) {
      const pages = ctx.pages();
      const page = pages.length > 0 ? pages[0] : await ctx.newPage();
      const sim = new IdleSimulator();
      sim.start(page);
      global.__browserIdleSim = sim;
    }

    return ctx;
  } finally {
    launching = false;
  }
}

export async function isPersistentContextLoggedIn(): Promise<boolean> {
  try {
    const ctx = await getPersistentContext();
    const cookies = await ctx.cookies(['https://creator.douyin.com']);
    return !!cookies.find(c => c.name === 'sessionid')?.value;
  } catch {
    return false;
  }
}

/** 检查持久化浏览器当前是否已登录小红书 */
export async function isXhsLoggedIn(): Promise<boolean> {
  try {
    const ctx = await getPersistentContext();
    const cookies = await ctx.cookies(['https://www.xiaohongshu.com']);
    return !!cookies.find(c => c.name === 'web_session')?.value;
  } catch {
    return false;
  }
}

/** 导出小红书 Cookie 字符串（供 HTTP 请求使用） */
export async function exportXhsCookieStr(): Promise<string | null> {
  try {
    const ctx = await getPersistentContext();
    const cookies = await ctx.cookies(['https://www.xiaohongshu.com']);
    const relevant = cookies.filter(c => c.domain.includes('xiaohongshu.com'));
    if (relevant.length === 0) return null;
    return relevant.map(c => `${c.name}=${c.value}`).join('; ');
  } catch {
    return null;
  }
}

export async function exportDouyinCookieStr(): Promise<string | null> {
  try {
    const ctx = await getPersistentContext();
    const cookies = await ctx.cookies(['https://www.douyin.com', 'https://creator.douyin.com']);
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  } catch {
    return null;
  }
}

export async function getDebugScratchPage(): Promise<import('playwright').Page> {
  const ctx = await getPersistentContext();
  if (global.__debugScratchPage) {
    try {
      await global.__debugScratchPage.title();
      return global.__debugScratchPage;
    } catch {
      global.__debugScratchPage = undefined;
      global.__debugScratchBrowser = undefined;
    }
  }
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  page.on('close', () => {
    global.__debugScratchPage = undefined;
    global.__debugScratchBrowser = undefined;
  });
  global.__debugScratchPage = page;
  global.__debugScratchBrowser = undefined;
  return page;
}

export function setDebugScratchPage(
  page: import('playwright').Page,
  browser?: import('playwright').Browser
): void {
  const prevBrowser = global.__debugScratchBrowser;
  global.__debugScratchPage = page;
  global.__debugScratchBrowser = browser;

  // 避免 CDP 连接泄漏：切换到新 Browser 时，尽量断开旧连接（不会关闭远端浏览器）
  if (prevBrowser && browser && prevBrowser !== browser) {
    void prevBrowser.close().catch(() => {});
  }

  page.on('close', () => {
    if (global.__debugScratchPage === page) {
      global.__debugScratchPage = undefined;
    }
    if (global.__debugScratchBrowser === browser) {
      global.__debugScratchBrowser = undefined;
    }
  });

  browser?.on('disconnected', () => {
    if (global.__debugScratchBrowser === browser) {
      global.__debugScratchBrowser = undefined;
      // 连接断开时，page 往往也会失效，避免下次误复用
      if (global.__debugScratchPage === page) {
        global.__debugScratchPage = undefined;
      }
    }
  });
}

export async function resetDebugScratchPage(): Promise<void> {
  if (global.__debugScratchPage) {
    await global.__debugScratchPage.close().catch(() => {});
    global.__debugScratchPage = undefined;
  }
  if (global.__debugScratchBrowser) {
    await global.__debugScratchBrowser.close().catch(() => {});
    global.__debugScratchBrowser = undefined;
  }
}

export async function closePersistentBrowser(): Promise<void> {
  if (global.__douyinBrowserCtx) {
    await global.__douyinBrowserCtx.close().catch(() => {});
    global.__douyinBrowserCtx = undefined;
    global.__douyinBrowserHeadless = undefined;
  }
}

export function browserStatus() {
  const alive = !!global.__douyinBrowserCtx;
  const pageCount = alive ? global.__douyinBrowserCtx!.pages().length : 0;
  return {
    alive,
    configuredHeadless: getConfiguredBrowserHeadless(),
    runningHeadless: global.__douyinBrowserHeadless,
    dataDir: BROWSER_DATA_DIR,
    openPages: pageCount,
  };
}
