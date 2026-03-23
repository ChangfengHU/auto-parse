/**
 * 条件表达式求值器
 * 
 * 评估 ConditionExpr 是否满足
 */

import { Page } from 'playwright';
import { ConditionExpr } from './types';
import { VariableResolver } from './variable-resolver';
import { SelectorResolver } from './selector-resolver';

export class ConditionEvaluator {
  private page: Page;
  private variableResolver: VariableResolver;
  private selectorResolver: SelectorResolver;

  constructor(
    page: Page,
    variableResolver: VariableResolver,
  ) {
    this.page = page;
    this.variableResolver = variableResolver;
    this.selectorResolver = new SelectorResolver(page, 3000);
  }

  /**
   * 评估条件表达式
   */
  async evaluate(condition: ConditionExpr): Promise<boolean> {
    // 处理逻辑组合
    if (condition.and) {
      for (const sub of condition.and) {
        if (!(await this.evaluate(sub))) {
          return false;
        }
      }
      return true;
    }

    if (condition.or) {
      for (const sub of condition.or) {
        if (await this.evaluate(sub)) {
          return true;
        }
      }
      return false;
    }

    if (condition.not) {
      return !(await this.evaluate(condition.not));
    }

    // 元素条件
    if (condition.selector) {
      return await this.evaluateSelector(condition);
    }

    // URL 条件
    if (condition.urlContains || condition.urlMatches || condition.urlEquals) {
      return this.evaluateUrl(condition);
    }

    // 变量条件
    if (condition.variable !== undefined) {
      return this.evaluateVariable(condition);
    }

    // 无条件默认为 true
    return true;
  }

  /**
   * 评估选择器条件
   */
  private async evaluateSelector(condition: ConditionExpr): Promise<boolean> {
    const selector = condition.selector!;
    const state = condition.state ?? 'visible';

    try {
      const locator = this.page.locator(selector).first();

      switch (state) {
        case 'visible':
          return await locator.isVisible({ timeout: 2000 }).catch(() => false);

        case 'hidden':
          return !(await locator.isVisible({ timeout: 500 }).catch(() => true));

        case 'attached':
          return (await locator.count()) > 0;

        case 'detached':
          return (await locator.count()) === 0;

        case 'enabled':
          return await locator.isEnabled({ timeout: 1000 }).catch(() => false);

        case 'disabled':
          return await locator.isDisabled({ timeout: 1000 }).catch(() => false);

        default:
          return false;
      }
    } catch {
      // 选择器不存在或超时
      return state === 'hidden' || state === 'detached';
    }
  }

  /**
   * 评估 URL 条件
   */
  private evaluateUrl(condition: ConditionExpr): boolean {
    const currentUrl = this.page.url();

    if (condition.urlEquals) {
      return currentUrl === condition.urlEquals;
    }

    if (condition.urlContains) {
      return currentUrl.includes(condition.urlContains);
    }

    if (condition.urlMatches) {
      try {
        const regex = new RegExp(condition.urlMatches);
        return regex.test(currentUrl);
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * 评估变量条件
   */
  private evaluateVariable(condition: ConditionExpr): boolean {
    const varName = condition.variable!;
    const value = this.variableResolver.get(varName);

    // 存在性检查
    if (condition.exists !== undefined) {
      return condition.exists ? (value !== undefined && value !== '') : (value === undefined || value === '');
    }

    // 空值检查
    if (condition.isEmpty !== undefined) {
      const empty = value === undefined || value === '' || value === 'null' || value === 'undefined';
      return condition.isEmpty ? empty : !empty;
    }

    // 如果变量不存在，后续比较都返回 false
    if (value === undefined) {
      return false;
    }

    // 等于
    if (condition.equals !== undefined) {
      return value === this.variableResolver.resolve(condition.equals);
    }

    // 不等于
    if (condition.notEquals !== undefined) {
      return value !== this.variableResolver.resolve(condition.notEquals);
    }

    // 包含
    if (condition.contains !== undefined) {
      return value.includes(this.variableResolver.resolve(condition.contains));
    }

    // 正则匹配
    if (condition.matches !== undefined) {
      try {
        const regex = new RegExp(condition.matches);
        return regex.test(value);
      } catch {
        return false;
      }
    }

    // 数值比较
    const numValue = parseFloat(value);
    if (!isNaN(numValue)) {
      if (condition.greaterThan !== undefined) {
        return numValue > condition.greaterThan;
      }
      if (condition.lessThan !== undefined) {
        return numValue < condition.lessThan;
      }
    }

    // 文本条件（用于带选择器的文本检查）
    // 这些需要异步处理，但当前方法是同步的
    // 如果有这些条件，需要使用 evaluateSelector
    if (condition.textContains || condition.textEquals || condition.textMatches) {
      // 这种情况下应该用 selector + 文本检查
      return false;
    }

    return true;
  }

  /**
   * 评估带文本检查的选择器条件
   */
  async evaluateWithText(selector: string, condition: ConditionExpr): Promise<boolean> {
    try {
      const locator = this.page.locator(selector).first();
      const text = await locator.textContent({ timeout: 2000 });

      if (!text) {
        return false;
      }

      if (condition.textContains) {
        return text.includes(condition.textContains);
      }

      if (condition.textEquals) {
        return text.trim() === condition.textEquals.trim();
      }

      if (condition.textMatches) {
        try {
          const regex = new RegExp(condition.textMatches);
          return regex.test(text);
        } catch {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }
}
