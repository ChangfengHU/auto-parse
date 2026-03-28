import type { Page } from 'playwright';
import type { TextInputParams, NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';

export async function executeTextInput(
  page: Page,
  params: TextInputParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  const useHumanType = ctx.humanOptions?.humanType ?? false;

  try {
    log.push(`✏️ 填入文本到 ${params.selector}`);
    const el = page.locator(params.selector).first();
    await el.waitFor({ state: 'visible', timeout: 10_000 });

    if (params.clear !== false) {
      await el.clear().catch(() =>
        el.selectText().then(() => page.keyboard.press('Backspace'))
      );
    }

    if (useHumanType) {
      // 逐字符输入，每个字符延迟随机波动（模拟真人打字节奏）
      const baseDelay = params.delay ?? 80;
      for (let i = 0; i < params.value.length; i++) {
        const char = params.value[i];
        await el.pressSequentially(char, { delay: 0 });
        // 随机延迟：基础 ± 40%，中文字符后偶尔多停顿
        const variance = baseDelay * 0.4;
        let delay = baseDelay + (Math.random() * 2 - 1) * variance;
        // 标点/空格后偶尔短暂停顿（像在想下一个词）
        if (/[，。！？\s]/.test(char) && Math.random() < 0.3) {
          delay += 200 + Math.random() * 400;
        }
        await page.waitForTimeout(delay);
      }
      log.push(`⌨️ 人工逐键输入完成（${params.value.length} 字）`);
    } else if (params.delay && params.delay > 0) {
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
