/**
 * human_pause 节点
 *
 * 暂停工作流，等待人工在浏览器中完成操作（验证码、Cloudflare 拦截等），
 * 然后在 Debug 面板点击「继续」按钮恢复执行。
 *
 * params:
 *   message    — 显示给用户的提示语（默认"请完成浏览器中的人工验证"）
 *   timeout    — 最长等待秒数（默认 300s）
 *   autoShot   — 继续后是否自动截图（默认 true）
 */

import type { Page } from 'playwright';
import type { NodeResult, WorkflowContext } from '../types';
import { waitForResume } from '../pause-signal';
import { captureScreenshot } from '../utils';

export interface HumanPauseParams {
  message?: string;
  timeout?: number;
}

export async function executeHumanPause(
  page: Page,
  params: HumanPauseParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const message = params.message ?? '请完成浏览器中的人工验证（验证码/Cloudflare 拦截等）';
  const timeoutMs = (params.timeout ?? 300) * 1000;

  // token = sessionId（由 ctx.vars.__pauseToken 传入）或 "scratch"
  const token = (ctx.vars.__pauseToken as string | undefined) ?? 'scratch';

  ctx.emit?.('log', `⏸️ 已暂停：${message}`);
  ctx.emit?.('log', `⏱️ 最长等待 ${params.timeout ?? 300} 秒，请在浏览器完成操作后点击「继续」`);
  ctx.emit?.('human_pause', JSON.stringify({ token, message, timeoutMs }));

  const outcome = await waitForResume(token, timeoutMs);

  if (outcome === 'timeout') {
    ctx.emit?.('log', '⚠️ 等待超时，自动继续执行');
    const shot = await captureScreenshot(page).catch(() => undefined);
    return {
      success: true,
      log: [`⚠️ 人工暂停超时（${params.timeout ?? 300}s），已自动继续`],
      screenshot: shot,
    };
  }

  ctx.emit?.('log', '✅ 人工操作完成，继续执行');
  const shot = await captureScreenshot(page).catch(() => undefined);
  return {
    success: true,
    log: ['✅ 人工操作已确认，继续'],
    screenshot: shot,
  };
}
