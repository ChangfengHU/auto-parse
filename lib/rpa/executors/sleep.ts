/**
 * 睡眠执行器
 * 
 * 支持: sleep
 */

import { Page } from 'playwright';
import { ActionParams, ExecutionContext, StepExecutor } from '../types';

export class SleepExecutor implements StepExecutor {
  async execute(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    const duration = params.timeout ?? params.delay ?? 1000;

    context.log(`等待 ${duration}ms`);
    await page.waitForTimeout(duration);
  }
}
