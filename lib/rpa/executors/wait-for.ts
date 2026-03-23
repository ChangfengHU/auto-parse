/**
 * 等待执行器
 * 
 * 支持: waitFor, waitForHidden, waitForEnabled, waitForUrl, waitForNetwork
 */

import { Page } from 'playwright';
import { ActionParams, ExecutionContext, StepExecutor } from '../types';
import { SelectorResolver } from '../selector-resolver';

export class WaitForExecutor implements StepExecutor {
  async execute(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    const timeout = params.timeout ?? 30000;

    // 等待 URL
    if (params.urlPattern || params.urlContains) {
      await this.waitForUrl(page, params, context);
      return;
    }

    // 等待元素
    if (params.selector) {
      await this.waitForSelector(page, params, context);
      return;
    }

    throw new Error('等待操作缺少 selector 或 urlPattern 参数');
  }

  /**
   * 等待元素出现
   */
  private async waitForSelector(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    const resolver = new SelectorResolver(page);
    const selectors = Array.isArray(params.selector) 
      ? params.selector!.map(s => context.resolve(s))
      : [context.resolve(params.selector!)];

    const timeout = params.timeout ?? 30000;

    context.log(`等待元素: ${selectors.join(' | ')}`);

    // 等待任一选择器可见
    const result = await resolver.waitForAny(selectors, timeout);
    
    if (!result) {
      throw new Error(`等待元素超时: ${JSON.stringify(params.selector)}`);
    }

    context.log(`元素已出现: ${result.selector}`);
  }

  /**
   * 等待元素消失
   */
  async waitForHidden(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    if (!params.selector) {
      throw new Error('等待元素消失操作缺少 selector 参数');
    }

    const selector = context.resolve(
      Array.isArray(params.selector) ? params.selector[0] : params.selector
    );
    const timeout = params.timeout ?? 30000;

    context.log(`等待元素消失: ${selector}`);

    const locator = page.locator(selector).first();
    await locator.waitFor({ state: 'hidden', timeout });

    context.log('元素已消失');
  }

  /**
   * 等待元素可用
   */
  async waitForEnabled(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    if (!params.selector) {
      throw new Error('等待元素可用操作缺少 selector 参数');
    }

    const selector = context.resolve(
      Array.isArray(params.selector) ? params.selector[0] : params.selector
    );
    const timeout = params.timeout ?? 30000;

    context.log(`等待元素可用: ${selector}`);

    const locator = page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout });
    
    // 等待元素可用
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await locator.isEnabled().catch(() => false)) {
        context.log('元素已可用');
        return;
      }
      await page.waitForTimeout(200);
    }

    throw new Error(`等待元素可用超时: ${selector}`);
  }

  /**
   * 等待 URL 变化
   */
  private async waitForUrl(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    const timeout = params.timeout ?? 30000;
    const urlPattern = params.urlPattern ? context.resolve(params.urlPattern) : null;
    const urlContains = params.urlContains ? context.resolve(params.urlContains) : null;
    const excludePatterns = params.excludePatterns ?? [];

    context.log(`等待 URL 变化: ${urlPattern || urlContains}`);

    await page.waitForURL(
      url => {
        const urlStr = url.toString();

        // 检查排除模式
        for (const pattern of excludePatterns) {
          if (urlStr.includes(pattern)) {
            return false;
          }
        }

        // 检查匹配
        if (urlPattern) {
          return urlStr.includes(urlPattern.replace('*', ''));
        }

        if (urlContains) {
          return urlStr.includes(urlContains);
        }

        return false;
      },
      { timeout }
    );

    context.log(`URL 已变化: ${page.url()}`);
  }

  /**
   * 等待网络空闲
   */
  async waitForNetwork(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    const timeout = params.timeout ?? 30000;
    context.log('等待网络空闲');
    
    await page.waitForLoadState('networkidle', { timeout });
    
    context.log('网络已空闲');
  }
}
