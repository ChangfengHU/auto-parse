import type { Page } from 'playwright';
import type { ClickParams, NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';
import { humanMouseMove } from '../human-mouse';

export async function executeClick(
  page: Page,
  params: ClickParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  const useHumanMouse = ctx.humanOptions?.humanMouse ?? false;

  try {
    let locator;

    if (params.text) {
      log.push(`🖱️ 点击按钮文字：${params.text}`);
      locator = page.getByRole('button', { name: params.text });
      locator = params.nth !== undefined ? locator.nth(params.nth) : locator.last();
    } else {
      log.push(`🖱️ 点击元素：${params.selector}`);
      locator = page.locator(params.selector!);
      locator = params.nth !== undefined ? locator.nth(params.nth) : locator.last();
    }

    if (params.waitFor !== false) {
      await locator.waitFor({ state: 'visible', timeout: params.timeout ?? 10_000 });
    }

    if (useHumanMouse) {
      // 获取元素中心坐标，贝塞尔曲线移过去再点击
      const box = await locator.boundingBox().catch(() => null);
      if (box) {
        const cx = Math.round(box.x + box.width / 2);
        const cy = Math.round(box.y + box.height / 2);
        await humanMouseMove(page, cx, cy);
        // 点击前短暂停顿（模拟视线确认）
        await page.waitForTimeout(80 + Math.random() * 120);
        await page.mouse.click(cx, cy);
        log.push(`🐭 人工鼠标移动并点击 (${cx}, ${cy})`);
      } else {
        await locator.click({ timeout: params.timeout ?? (params.waitFor === false ? 3_000 : 10_000) });
      }
    } else {
      await locator.click({ timeout: params.timeout ?? (params.waitFor === false ? 3_000 : 10_000) });
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
