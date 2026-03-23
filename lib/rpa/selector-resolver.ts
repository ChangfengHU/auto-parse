/**
 * 选择器解析器
 * 
 * 支持多路降级选择器，自动选择第一个可见的元素
 */

import { Page, Locator } from 'playwright';

export interface SelectorHints {
  id?: string;
  className?: string;
  text?: string;
  placeholder?: string;
  role?: string;
  testId?: string;
  name?: string;
  tag?: string;
}

export class SelectorResolver {
  private page: Page;
  private defaultTimeout: number;

  constructor(page: Page, defaultTimeout: number = 5000) {
    this.page = page;
    this.defaultTimeout = defaultTimeout;
  }

  /**
   * 解析选择器，支持多路降级
   * 
   * @param selectors 单个选择器或选择器数组
   * @param timeout 超时时间（毫秒）
   * @returns 第一个可见的选择器，或 null
   * 
   * @example
   * // 单选择器
   * await resolver.resolve('#submit-btn');
   * 
   * // 多选择器降级
   * await resolver.resolve([
   *   '#submit-btn',
   *   'button[type="submit"]',
   *   'button:has-text("提交")'
   * ]);
   */
  async resolve(
    selectors: string | string[],
    timeout?: number,
  ): Promise<string | null> {
    const selectorList = Array.isArray(selectors) ? selectors : [selectors];
    const checkTimeout = Math.min(timeout ?? this.defaultTimeout, 3000) / selectorList.length;

    for (const selector of selectorList) {
      try {
        const locator = this.page.locator(selector).first();
        const isVisible = await locator.isVisible({ timeout: checkTimeout }).catch(() => false);
        
        if (isVisible) {
          return selector;
        }
      } catch {
        // 继续尝试下一个选择器
      }
    }

    return null;
  }

  /**
   * 解析选择器并返回 Locator
   */
  async resolveLocator(
    selectors: string | string[],
    timeout?: number,
  ): Promise<Locator | null> {
    const selector = await this.resolve(selectors, timeout);
    if (!selector) return null;
    return this.page.locator(selector).first();
  }

  /**
   * 等待任一选择器可见
   */
  async waitForAny(
    selectors: string[],
    timeout?: number,
  ): Promise<{ selector: string; locator: Locator } | null> {
    const effectiveTimeout = timeout ?? this.defaultTimeout;
    const startTime = Date.now();

    while (Date.now() - startTime < effectiveTimeout) {
      for (const selector of selectors) {
        try {
          const locator = this.page.locator(selector).first();
          if (await locator.isVisible({ timeout: 500 }).catch(() => false)) {
            return { selector, locator };
          }
        } catch {
          // 继续
        }
      }
      await this.page.waitForTimeout(200);
    }

    return null;
  }

  /**
   * 智能选择器：根据提示信息生成多种选择器并尝试匹配
   */
  async smartResolve(hints: SelectorHints, timeout?: number): Promise<string | null> {
    const candidates: string[] = [];

    // 根据提示生成候选选择器
    if (hints.id) {
      candidates.push(`#${hints.id}`);
      candidates.push(`[id="${hints.id}"]`);
    }

    if (hints.testId) {
      candidates.push(`[data-testid="${hints.testId}"]`);
      candidates.push(`[data-test-id="${hints.testId}"]`);
    }

    if (hints.role) {
      if (hints.name) {
        candidates.push(`role=${hints.role}[name="${hints.name}"]`);
      } else {
        candidates.push(`role=${hints.role}`);
      }
    }

    if (hints.text) {
      candidates.push(`:text("${hints.text}")`);
      candidates.push(`*:has-text("${hints.text}")`);
    }

    if (hints.placeholder) {
      candidates.push(`[placeholder="${hints.placeholder}"]`);
      candidates.push(`[placeholder*="${hints.placeholder}"]`);
    }

    if (hints.className) {
      const classes = hints.className.split(' ').filter(Boolean);
      if (classes.length > 0) {
        candidates.push(`.${classes.join('.')}`);
        candidates.push(`[class*="${classes[0]}"]`);
      }
    }

    if (hints.name && hints.tag) {
      candidates.push(`${hints.tag}[name="${hints.name}"]`);
    }

    if (candidates.length === 0) {
      return null;
    }

    return this.resolve(candidates, timeout);
  }

  /**
   * 检查选择器是否可见
   */
  async isVisible(selector: string, timeout?: number): Promise<boolean> {
    try {
      const locator = this.page.locator(selector).first();
      return await locator.isVisible({ timeout: timeout ?? 1000 });
    } catch {
      return false;
    }
  }

  /**
   * 检查选择器是否存在于 DOM 中
   */
  async exists(selector: string, timeout?: number): Promise<boolean> {
    try {
      const locator = this.page.locator(selector).first();
      const count = await locator.count();
      return count > 0;
    } catch {
      return false;
    }
  }

  /**
   * 获取元素文本
   */
  async getText(selector: string): Promise<string | null> {
    try {
      const locator = this.page.locator(selector).first();
      return await locator.textContent({ timeout: 2000 });
    } catch {
      return null;
    }
  }

  /**
   * 获取元素属性
   */
  async getAttribute(selector: string, attribute: string): Promise<string | null> {
    try {
      const locator = this.page.locator(selector).first();
      return await locator.getAttribute(attribute, { timeout: 2000 });
    } catch {
      return null;
    }
  }
}
