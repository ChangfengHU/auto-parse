/**
 * 截图执行器
 * 
 * 支持: screenshot, screenshotElement
 */

import { Page } from 'playwright';
import { ActionParams, ExecutionContext, StepExecutor } from '../types';
import { SelectorResolver } from '../selector-resolver';

export class ScreenshotExecutor implements StepExecutor {
  async execute(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    const name = params.screenshotPath ?? params.message ?? 'screenshot';
    
    context.log(`截图: ${name}`);

    // 如果有选择器，截取元素
    if (params.selector) {
      await this.screenshotElement(page, params, context);
      return;
    }

    // 全页截图
    const screenshotUrl = await context.screenshot(name);
    
    if (screenshotUrl && params.variableName) {
      context.variables.set(params.variableName, screenshotUrl);
    }
  }

  /**
   * 元素截图
   */
  private async screenshotElement(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    const resolver = new SelectorResolver(page);
    const selectors = Array.isArray(params.selector) 
      ? params.selector!.map(s => context.resolve(s))
      : [context.resolve(params.selector!)];

    const selector = await resolver.resolve(selectors, params.timeout);
    
    if (!selector) {
      context.log(`未找到截图元素，使用全页截图: ${JSON.stringify(params.selector)}`);
      await context.screenshot(params.screenshotPath ?? 'fallback');
      return;
    }

    const locator = page.locator(selector).first();
    const buffer = await locator.screenshot({ timeout: params.timeout ?? 10000 });

    // 发送截图或保存
    if (params.event === 'qrcode') {
      context.emit('qrcode', `data:image/png;base64,${buffer.toString('base64')}`);
    }

    if (params.variableName) {
      context.variables.set(params.variableName, `data:image/png;base64,${buffer.toString('base64')}`);
    }

    context.log(`元素截图完成: ${selector}`);
  }
}
