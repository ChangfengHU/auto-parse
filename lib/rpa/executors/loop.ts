/**
 * 循环执行器
 * 
 * 支持: loop, while
 */

import { Page } from 'playwright';
import { ActionParams, ExecutionContext, StepExecutor } from '../types';
import { ConditionEvaluator } from '../condition-evaluator';
import { VariableResolver } from '../variable-resolver';

export class LoopExecutor implements StepExecutor {
  async execute(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    if (!params.condition) {
      throw new Error('循环操作缺少 condition 参数');
    }

    const timeout = params.timeout ?? 60000;
    const interval = params.interval ?? 2000;
    const maxIterations = params.maxIterations ?? Math.ceil(timeout / interval);

    context.log(`开始循环等待条件成立 (最大 ${maxIterations} 次，间隔 ${interval}ms)`);

    const variableResolver = new VariableResolver(Object.fromEntries(context.variables));
    const evaluator = new ConditionEvaluator(page, variableResolver);

    const startTime = Date.now();
    let iterations = 0;

    while (Date.now() - startTime < timeout && iterations < maxIterations) {
      iterations++;

      // 检查是否应该跳出
      if (context.loopState?.shouldBreak) {
        context.log('收到 break 信号，跳出循环');
        context.loopState.shouldBreak = false;
        break;
      }

      // 检查是否应该继续下一次
      if (context.loopState?.shouldContinue) {
        context.loopState.shouldContinue = false;
        await page.waitForTimeout(interval);
        continue;
      }

      // 评估条件
      const result = await evaluator.evaluate(params.condition);

      if (result) {
        context.log(`条件满足，循环结束 (第 ${iterations} 次)`);
        return;
      }

      // 输出进度
      if (iterations % 5 === 0) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        context.log(`循环中... (${iterations}/${maxIterations}，已等待 ${elapsed}s)`);
      }

      await page.waitForTimeout(interval);
    }

    // 超时或达到最大次数
    throw new Error(`循环等待超时: 条件未在 ${timeout}ms 内满足`);
  }
}
