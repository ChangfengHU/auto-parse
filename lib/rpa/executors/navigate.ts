/**
 * 导航执行器
 * 
 * 支持: navigate, reload, goBack, goForward
 */

import { Page } from 'playwright';
import { ActionParams, ExecutionContext, StepExecutor } from '../types';

export class NavigateExecutor implements StepExecutor {
  async execute(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    const timeout = params.timeout ?? 30000;

    // navigate
    if (params.url) {
      const url = context.resolve(params.url);
      context.log(`导航到: ${url}`);
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout,
      });
      return;
    }

    // reload
    if (params.fullPage === undefined && !params.url) {
      // 这是一个 reload 操作的标识
      // 实际上我们通过 action type 来区分
      // 这里作为 fallback
    }
  }

  /**
   * 执行页面刷新
   */
  async reload(page: Page, params: ActionParams, context: ExecutionContext): Promise<void> {
    const timeout = params.timeout ?? 30000;
    context.log('刷新页面');
    await page.reload({ waitUntil: 'domcontentloaded', timeout });
  }

  /**
   * 后退
   */
  async goBack(page: Page, params: ActionParams, context: ExecutionContext): Promise<void> {
    const timeout = params.timeout ?? 30000;
    context.log('后退');
    await page.goBack({ waitUntil: 'domcontentloaded', timeout });
  }

  /**
   * 前进
   */
  async goForward(page: Page, params: ActionParams, context: ExecutionContext): Promise<void> {
    const timeout = params.timeout ?? 30000;
    context.log('前进');
    await page.goForward({ waitUntil: 'domcontentloaded', timeout });
  }
}
