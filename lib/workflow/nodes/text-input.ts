import type { Page } from 'playwright';
import type { TextInputParams, NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';

export async function executeTextInput(
  page: Page,
  params: TextInputParams,
  _ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  try {
    log.push(`✏️ 填入文本到 ${params.selector}`);
    const el = page.locator(params.selector).first();
    await el.waitFor({ state: 'visible', timeout: 10_000 });

    if (params.clear !== false) {
      await el.clear().catch(() => el.selectText().then(() => page.keyboard.press('Backspace')));
    }

    if (params.delay && params.delay > 0) {
      await el.pressSequentially(params.value, { delay: params.delay });
    } else {
      await el.fill(params.value);
    }

    log.push(`✅ 已填入：${params.value.slice(0, 30)}${params.value.length > 30 ? '...' : ''}`);
    const screenshot = await captureScreenshot(page);
    return { success: true, log, screenshot };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.push(`❌ 填入失败: ${error}`);
    const screenshot = await captureScreenshot(page).catch(() => undefined);
    return { success: false, log, error, screenshot };
  }
}
