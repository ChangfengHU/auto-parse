/**
 * 条件分支执行器
 * 
 * 支持: condition
 * 
 * 注意：condition 的特殊之处在于它通过返回不同的 nextStepId 来控制流程
 * 实际的条件判断在 RPAEngine 中处理
 */

import { Page } from 'playwright';
import { ActionParams, ExecutionContext, StepExecutor } from '../types';
import { ConditionEvaluator } from '../condition-evaluator';
import { VariableResolver } from '../variable-resolver';

export class ConditionExecutor implements StepExecutor {
  async execute(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    // condition 的实际逻辑在 RPAEngine 中处理
    // 这里只做日志记录
    context.log('执行条件判断');
  }

  /**
   * 评估条件（供 RPAEngine 调用）
   */
  async evaluate(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<boolean> {
    if (!params.condition) {
      // 没有条件，默认为 true
      return true;
    }

    const variableResolver = new VariableResolver(Object.fromEntries(context.variables));
    const evaluator = new ConditionEvaluator(page, variableResolver);

    return await evaluator.evaluate(params.condition);
  }
}
