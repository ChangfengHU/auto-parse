import type { Page } from 'playwright';
import type { QRCodeParams, NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';

const QR_SELECTORS = [
  '[class*="qrcode_img"]',
  '[class*="qrcode-img"]',
  'canvas[class*="qr"]',
  '[class*="scan_qrcode"] img',
  '[class*="login"] img[src*="qrcode"]',
];

async function captureQRCode(page: Page, selector?: string): Promise<string | null> {
  const selectors = selector ? [selector, ...QR_SELECTORS] : QR_SELECTORS;
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      const buf = await el.screenshot().catch(() => null);
      if (buf) return `data:image/png;base64,${buf.toString('base64')}`;
    }
  }
  const buf = await page.screenshot({ fullPage: false }).catch(() => null);
  return buf ? `data:image/png;base64,${buf.toString('base64')}` : null;
}

function isLoggedIn(url: string, successContains: string, excludeUrls: string[]): boolean {
  return url.includes(successContains) && !excludeUrls.some(u => url.includes(u));
}

export async function executeQRCode(
  page: Page,
  params: QRCodeParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  const timeout = params.timeout ?? 300_000;
  const refreshInterval = params.refreshInterval ?? 110_000;
  const excludeUrls = params.excludeUrls ?? [];

  try {
    // ── 快速检查：当前页面是否已登录 ────────────────────────────────────
    // 等待 3s 让页面稳定，检查 URL
    await page.waitForTimeout(2000);
    const currentUrl = page.url();
    if (isLoggedIn(currentUrl, params.successUrlContains, excludeUrls)) {
      log.push(`✅ 已登录（当前页面 URL 符合条件），跳过扫码`);
      const screenshot = await captureScreenshot(page);
      return { success: true, log, screenshot, output: { skipped: true } };
    }

    // ── 页面包含登录关键词 → 需要扫码 ──────────────────────────────────
    log.push(`🔐 检测到未登录，等待二维码出现...`);
    ctx.emit?.('log', `🔐 检测到未登录，等待二维码出现...`);

    await page
      .waitForSelector(
        (params.selector ? [params.selector] : QR_SELECTORS).join(', '),
        { timeout: 10_000 }
      )
      .catch(() => {});

    const qrData = await captureQRCode(page, params.selector);
    if (qrData) {
      ctx.emit?.('qrcode', qrData);
      log.push(`📱 已发送二维码，请用 App 扫描（有效期约 3 分钟）`);
    } else {
      log.push(`⚠️ 未找到二维码，已发送整页截图`);
    }

    // ── 自动刷新二维码 ──────────────────────────────────────────────────
    let done = false;
    const refreshTimer = setInterval(async () => {
      if (done) return;
      log.push(`🔄 二维码即将过期，正在刷新...`);
      ctx.emit?.('log', `🔄 二维码即将过期，正在刷新...`);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const fresh = await captureQRCode(page, params.selector);
      if (fresh) ctx.emit?.('qrcode', fresh);
    }, refreshInterval);

    // ── 等待 URL 跳转（扫码成功标志）───────────────────────────────────
    try {
      await page.waitForURL(
        url => isLoggedIn(url.toString(), params.successUrlContains, excludeUrls),
        { timeout }
      );
      done = true;
    } finally {
      clearInterval(refreshTimer);
    }

    log.push(`✅ 扫码成功，已跳转到目标页面`);
    await page.waitForTimeout(2000);

    const cookies = await page.context().cookies();
    const filteredCookies = params.cookieDomain
      ? cookies.filter(c => c.domain.includes(params.cookieDomain as string))
      : cookies;
    const cookieStr = filteredCookies.map(c => `${c.name}=${c.value}`).join('; ');

    const screenshot = await captureScreenshot(page);
    return {
      success: true,
      log,
      screenshot,
      output: { cookieStr, cookieCount: filteredCookies.length },
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.push(`❌ 扫码失败: ${error}`);
    const screenshot = await captureScreenshot(page).catch(() => undefined);
    return { success: false, log, error, screenshot };
  }
}
