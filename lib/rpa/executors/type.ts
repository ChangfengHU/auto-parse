/**
 * 输入执行器
 * 
 * 支持: type, fill, clear, press
 */

import { Page } from 'playwright';
import { ActionParams, ExecutionContext, StepExecutor } from '../types';
import { SelectorResolver } from '../selector-resolver';

export class TypeExecutor implements StepExecutor {
  async execute(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    if (!params.selector) {
      throw new Error('输入操作缺少 selector 参数');
    }

    const resolver = new SelectorResolver(page);
    const selectors = Array.isArray(params.selector) 
      ? params.selector.map(s => context.resolve(s))
      : [context.resolve(params.selector)];

    const selector = await resolver.resolve(selectors, params.timeout);
    
    if (!selector) {
      throw new Error(`未找到输入元素: ${JSON.stringify(params.selector)}`);
    }

    const locator = page.locator(selector).first();
    const timeout = params.timeout ?? 10000;
    const value = context.resolve(params.value ?? '');

    // 默认使用 fill（先清空再输入）
    context.log(`输入文本: "${value.slice(0, 30)}${value.length > 30 ? '...' : ''}" → ${selector}`);
    await locator.fill(value, { timeout });
  }

  /**
   * 逐字输入（模拟真实打字）
   */
  async type(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    if (!params.selector) {
      throw new Error('输入操作缺少 selector 参数');
    }

    const resolver = new SelectorResolver(page);
    const selectors = Array.isArray(params.selector) 
      ? params.selector.map(s => context.resolve(s))
      : [context.resolve(params.selector)];

    const selector = await resolver.resolve(selectors, params.timeout);
    
    if (!selector) {
      throw new Error(`未找到输入元素: ${JSON.stringify(params.selector)}`);
    }

    const locator = page.locator(selector).first();
    const value = context.resolve(params.value ?? '');
    const delay = params.delay ?? 50;

    context.log(`逐字输入: "${value.slice(0, 30)}${value.length > 30 ? '...' : ''}"`);
    
    // 先聚焦
    await locator.focus();
    
    // 逐字输入
    await page.keyboard.type(value, { delay });
  }

  /**
   * 清空输入框
   */
  async clear(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    if (!params.selector) {
      throw new Error('清空操作缺少 selector 参数');
    }

    const resolver = new SelectorResolver(page);
    const selectors = Array.isArray(params.selector) 
      ? params.selector.map(s => context.resolve(s))
      : [context.resolve(params.selector)];

    const selector = await resolver.resolve(selectors, params.timeout);
    
    if (!selector) {
      throw new Error(`未找到输入元素: ${JSON.stringify(params.selector)}`);
    }

    const locator = page.locator(selector).first();
    context.log(`清空输入框: ${selector}`);
    await locator.clear({ timeout: params.timeout ?? 10000 });
  }

  /**
   * 按键
   */
  async press(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    const key = params.key ?? params.value;
    
    if (!key) {
      throw new Error('按键操作缺少 key 参数');
    }

    // 构建按键组合
    let keyCombo = context.resolve(key);
    
    if (params.modifiers && params.modifiers.length > 0) {
      keyCombo = params.modifiers.join('+') + '+' + keyCombo;
    }

    context.log(`按键: ${keyCombo}`);

    if (params.selector) {
      const resolver = new SelectorResolver(page);
      const selectors = Array.isArray(params.selector) 
        ? params.selector.map(s => context.resolve(s))
        : [context.resolve(params.selector)];

      const selector = await resolver.resolve(selectors, params.timeout);
      
      if (selector) {
        const locator = page.locator(selector).first();
        await locator.press(keyCombo, { timeout: params.timeout ?? 10000 });
        return;
      }
    }

    // 全局按键
    await page.keyboard.press(keyCombo);
  }
}
