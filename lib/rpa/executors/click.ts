/**
 * 点击执行器
 * 
 * 支持: click, dblclick, rightClick
 */

import { Page } from 'playwright';
import { ActionParams, ExecutionContext, StepExecutor } from '../types';
import { SelectorResolver } from '../selector-resolver';

export class ClickExecutor implements StepExecutor {
  async execute(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    if (!params.selector) {
      throw new Error('点击操作缺少 selector 参数');
    }

    const resolver = new SelectorResolver(page);
    const selectors = Array.isArray(params.selector) 
      ? params.selector.map(s => context.resolve(s))
      : [context.resolve(params.selector)];

    const selector = await resolver.resolve(selectors, params.timeout);
    
    if (!selector) {
      throw new Error(`未找到可点击的元素: ${JSON.stringify(params.selector)}`);
    }

    const locator = page.locator(selector).first();
    const timeout = params.timeout ?? 10000;

    // 点击选项
    const clickOptions: Parameters<typeof locator.click>[0] = {
      timeout,
      force: params.force,
      position: params.position,
      delay: params.delay,
      clickCount: params.clickCount ?? 1,
    };

    context.log(`点击元素: ${selector}`);
    await locator.click(clickOptions);
  }

  /**
   * 双击
   */
  async dblclick(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    if (!params.selector) {
      throw new Error('双击操作缺少 selector 参数');
    }

    const resolver = new SelectorResolver(page);
    const selectors = Array.isArray(params.selector) 
      ? params.selector.map(s => context.resolve(s))
      : [context.resolve(params.selector)];

    const selector = await resolver.resolve(selectors, params.timeout);
    
    if (!selector) {
      throw new Error(`未找到可双击的元素: ${JSON.stringify(params.selector)}`);
    }

    const locator = page.locator(selector).first();
    context.log(`双击元素: ${selector}`);
    await locator.dblclick({ timeout: params.timeout ?? 10000 });
  }

  /**
   * 右键点击
   */
  async rightClick(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    if (!params.selector) {
      throw new Error('右键点击操作缺少 selector 参数');
    }

    const resolver = new SelectorResolver(page);
    const selectors = Array.isArray(params.selector) 
      ? params.selector.map(s => context.resolve(s))
      : [context.resolve(params.selector)];

    const selector = await resolver.resolve(selectors, params.timeout);
    
    if (!selector) {
      throw new Error(`未找到可右键点击的元素: ${JSON.stringify(params.selector)}`);
    }

    const locator = page.locator(selector).first();
    context.log(`右键点击元素: ${selector}`);
    await locator.click({ button: 'right', timeout: params.timeout ?? 10000 });
  }
}
