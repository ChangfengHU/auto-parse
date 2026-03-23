/**
 * 事件发送执行器
 * 
 * 支持: emit, log
 */

import { Page } from 'playwright';
import { ActionParams, ExecutionContext, StepExecutor } from '../types';

export class EmitExecutor implements StepExecutor {
  async execute(
    page: Page,
    params: ActionParams,
    context: ExecutionContext,
  ): Promise<void> {
    const event = params.event ?? 'log';
    const message = params.message ? context.resolve(params.message) : '';

    // 处理日志级别
    const level = params.level ?? 'info';
    const prefix = level === 'error' ? '❌ ' 
      : level === 'warn' ? '⚠️ ' 
      : level === 'debug' ? '🔍 ' 
      : '';

    const formattedMessage = `${prefix}${message}`;

    // 发送事件
    context.emit(event, formattedMessage);

    // 同时记录日志
    if (event !== 'log') {
      context.log(`发送事件 [${event}]: ${message}`);
    }
  }
}
