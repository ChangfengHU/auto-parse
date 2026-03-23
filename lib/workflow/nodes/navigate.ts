import type { Page } from 'playwright';
import type { NavigateParams, NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';

export async function executeNavigate(
  page: Page,
  params: NavigateParams,
  _ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  try {
    log.push(`🌐 导航到 ${params.url}`);
    await page.goto(params.url, {
      waitUntil: params.waitUntil ?? 'domcontentloaded',
      timeout: params.timeout ?? 30_000,
    });
    await page.waitForTimeout(2000);
    const screenshot = await captureScreenshot(page);
    log.push(`✅ 导航成功`);
    return { success: true, log, screenshot };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.push(`❌ 导航失败: ${error}`);
    const screenshot = await captureScreenshot(page).catch(() => undefined);
    return { success: false, log, error, screenshot };
  }
}
