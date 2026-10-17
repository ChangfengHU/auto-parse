import type { Page } from 'playwright';
import type { WaitAfterConfig } from './types';

/** Positive conditions are alternatives, as in the existing editor. Failure wins. */
export async function checkWaitAfter(page: Page, config: WaitAfterConfig, emit?: (message: string) => void) {
  const delay = Math.max(0, Number(config.delaySeconds) || 0) * 1000;
  const timeout = Math.max(0, Number(config.timeout ?? 15000) || 0);
  const action = config.action ?? 'appeared';
  const positive = Boolean(config.urlContains || config.selector || config.successKeywords?.length);
  if (delay) await page.waitForTimeout(delay);
  const start = Date.now();
  do {
    const text = config.failKeywords?.length || config.successKeywords?.length
      ? await page.locator('body').innerText() : '';
    const failure = config.failKeywords?.find(word => word && text.includes(word));
    if (failure) return { success: false, error: `后置检测失败：页面含“${failure}”` };
    let matched = Boolean(config.urlContains && page.url().includes(config.urlContains));
    if (config.selector) {
      // Invalid selectors must not masquerade as a disappeared element.
      const visible = await page.locator(config.selector).first().isVisible();
      matched ||= action === 'disappeared' ? !visible : visible;
    }
    matched ||= Boolean(config.successKeywords?.some(word => word && text.includes(word)));
    if (matched || (!positive && !config.failKeywords?.length)) {
      emit?.('✅ 后置条件满足');
      return { success: true };
    }
    if (Date.now() - start >= timeout) break;
    await page.waitForTimeout(Math.min(500, timeout - (Date.now() - start)));
  } while (true);
  // A fail-keywords-only guard observes the entire configured interval.
  return positive ? { success: false, error: `后置条件等待超时（${timeout}ms）` } : { success: true };
}
