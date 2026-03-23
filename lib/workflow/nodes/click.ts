import type { Page } from 'playwright';
import type { ClickParams, NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';

export async function executeClick(
  page: Page,
  params: ClickParams,
  _ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  try {
    let locator;

    if (params.text) {
      log.push(`🖱️ 点击按钮文字：${params.text}`);
      locator = page.getByRole('button', { name: params.text });
      if (params.nth !== undefined) {
        locator = locator.nth(params.nth);
      } else {
        locator = locator.last();
      }
    } else {
      log.push(`🖱️ 点击元素：${params.selector}`);
      locator = page.locator(params.selector);
      if (params.nth !== undefined) {
        locator = locator.nth(params.nth);
      } else {
        locator = locator.last();
      }
    }

    if (params.waitFor !== false) {
      await locator.waitFor({ state: 'visible', timeout: params.timeout ?? 10_000 });
      await locator.click({ timeout: params.timeout ?? 10_000 });
    } else {
      // waitFor: false → 不等待元素，直接尝试点击，超时短（3s）快速失败
      await locator.click({ timeout: params.timeout ?? 3_000 });
    }
    await page.waitForTimeout(1000);

    log.push(`✅ 点击成功`);
    const screenshot = await captureScreenshot(page);
    return { success: true, log, screenshot };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.push(`❌ 点击失败: ${error}`);
    const screenshot = await captureScreenshot(page).catch(() => undefined);
    return { success: false, log, error, screenshot };
  }
}
