import type { Page } from 'playwright';
import type { ScrollParams, NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';

export async function executeScroll(
  page: Page,
  params: ScrollParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];

  try {
    if (params.selector) {
      // 滚动到指定元素
      const el = page.locator(params.selector).first();
      await el.scrollIntoViewIfNeeded({ timeout: 10_000 });
      log.push(`✅ 已滚动到元素：${params.selector}`);
      ctx.emit?.('log', log[log.length - 1]);
    } else {
      // 滚动固定像素
      const x = params.x ?? 0;
      const y = params.y ?? 0;
      const behavior = params.behavior ?? 'auto';
      await page.evaluate(
        ({ x, y, behavior }: { x: number; y: number; behavior: string }) => {
          window.scrollBy({ left: x, top: y, behavior: behavior as ScrollBehavior });
        },
        { x, y, behavior }
      );
      log.push(`✅ 已滚动 x=${x} y=${y}（behavior=${behavior}）`);
      ctx.emit?.('log', log[log.length - 1]);
    }

    // 平滑滚动需要额外等待动画完成
    if (params.behavior === 'smooth') {
      await page.waitForTimeout(600);
    }

    const screenshot = await captureScreenshot(page);
    return { success: true, log, screenshot };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.push(`❌ 滚动失败：${error}`);
    const screenshot = await captureScreenshot(page).catch(() => undefined);
    return { success: false, log, error, screenshot };
  }
}
