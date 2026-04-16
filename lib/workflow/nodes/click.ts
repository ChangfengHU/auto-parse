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

  const targets = params.elements && params.elements.length > 0
    ? params.elements
    : [{ text: params.text, selector: params.selector, useSelector: params.useSelector }];

  let finalSuccess = false;
  let lastError = '';

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const isMulti = targets.length > 1;
    const prefix = isMulti ? `[候选 ${i + 1}] ` : '';

    try {
      const useSelector = target.useSelector || (!target.text && !!target.selector);
      let locator;

      if (useSelector) {
        if (!target.selector) {
          if (isMulti) { log.push(`${prefix}跳过：缺少选择器`); continue; }
          throw new Error('选择器模式下缺少 selector');
        }
        log.push(`${prefix}尝试点击元素：${target.selector}`);
        locator = page.locator(target.selector);
      } else {
        if (!target.text) {
          if (isMulti) { log.push(`${prefix}跳过：缺少按钮文字`); continue; }
          throw new Error('文字模式下缺少 text');
        }
        log.push(`${prefix}尝试点击按钮文字：${target.text}`);
        locator = page.getByRole('button', { name: target.text });
      }

      locator = params.nth !== undefined ? locator.nth(params.nth) : locator.last();

      // 执行前置等待
      if (params.waitFor !== false) {
        await locator.waitFor({ state: 'visible', timeout: params.timeout ?? 5_000 });
      }

      if (useHumanMouse) {
        const box = await locator.boundingBox().catch(() => null);
        if (box) {
          const cx = Math.round(box.x + box.width / 2);
          const cy = Math.round(box.y + box.height / 2);
          await humanMouseMove(page, cx, cy);
          await page.waitForTimeout(80 + Math.random() * 120);
          await page.mouse.click(cx, cy);
          log.push(`${prefix}🐭 人工鼠标点击成功 (${cx}, ${cy})`);
        } else {
          await locator.click({ timeout: params.timeout ?? 5_000 });
        }
      } else {
        await locator.click({ timeout: params.timeout ?? 5_000 });
      }

      log.push(`${prefix}✅ 点击成功`);
      finalSuccess = true;
      break; // 成功一个即退出循环
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      log.push(`${prefix}❌ 尝试失败: ${lastError}`);
      if (!isMulti) break; // 单目标模式直接退出并报错
    }
  }

  const screenshot = await captureScreenshot(page).catch(() => undefined);
  if (finalSuccess) {
    await page.waitForTimeout(1000);
    return { success: true, log, screenshot };
  } else {
    return { success: false, log, error: lastError || '所有候选目标均点击失败', screenshot };
  }
}
