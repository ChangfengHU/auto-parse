/**
 * Workflow Engine
 *
 * 执行工作流节点序列。支持两种模式：
 *   - 自动模式：节点全部顺序执行，通过 emit 推送进度
 *   - Debug 模式：每步单独调用 executeStep()，中间暂停等用户确认
 */

import type { Page } from 'playwright';
import type { NodeDef, NodeResult, NodeType, WorkflowContext, WorkflowDef } from './types';
import { resolveParams } from './resolver';
import { captureScreenshot } from './utils';

import { executeNavigate } from './nodes/navigate';
import { executeTextInput } from './nodes/text-input';
import { executeClick } from './nodes/click';
import { executeScroll } from './nodes/scroll';
import { executeScreenshot } from './nodes/screenshot';
import { executeFileUpload } from './nodes/file-upload';
import { executeWaitCondition } from './nodes/wait-condition';
import { executeQRCode } from './nodes/qrcode';
import { executeHumanPause } from './nodes/human-pause';
import { executeExtractImage } from './nodes/extract-image';
import { executeXhsDownload } from './nodes/xhs-download';

// ── 节点注册表 ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NodeExecutor = (page: Page, params: any, ctx: WorkflowContext) => Promise<NodeResult>;

const NODE_REGISTRY: Record<NodeType, NodeExecutor> = {
  navigate:       executeNavigate,
  text_input:     executeTextInput,
  click:          executeClick,
  scroll:         executeScroll,
  screenshot:     executeScreenshot,
  file_upload:    executeFileUpload,
  wait_condition: executeWaitCondition,
  qrcode:         executeQRCode,
  human_pause:    executeHumanPause,
  extract_image:  executeExtractImage,
  xhs_download:   executeXhsDownload,
};

// ── 单步执行 ──────────────────────────────────────────────────────────────────

export async function executeNode(
  page: Page,
  node: NodeDef,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const executor = NODE_REGISTRY[node.type];
  if (!executor) {
    return { success: false, log: [`❌ 未知节点类型: ${node.type}`], error: `unknown node: ${node.type}` };
  }

  // 解析模板变量
  const resolvedParams = resolveParams(node.params, ctx.vars);

  // ── 节点前置导航（url 字段设置时自动跳转）─────────────────────────────────
  if (node.url) {
    const resolvedUrl = resolveParams({ url: node.url }, ctx.vars).url as string;
    const currentUrl = page.url();
    if (!currentUrl.includes(resolvedUrl) && !resolvedUrl.includes(currentUrl)) {
      ctx.emit?.('log', `🌐 自动导航到：${resolvedUrl}`);
      try {
        await page.goto(resolvedUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch (e) {
        ctx.emit?.('log', `⚠️ 导航超时，继续执行：${String(e).slice(0, 80)}`);
      }
    }
  }

  ctx.emit?.('log', `▶️ 执行节点：${node.label ?? node.type}`);

  let result: NodeResult;
  try {
    result = await executor(page, resolvedParams, ctx);
    if (result.screenshot) ctx.emit?.('screenshot', result.screenshot);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, log: [`❌ 节点异常: ${error}`], error };
  }

  // ── 节点后置等待（waitAfter 启用时）────────────────────────────────────────
  if (result.success && node.waitAfter?.enabled) {
    const wa = node.waitAfter;
    const timeout = wa.timeout ?? 15_000;
    const start = Date.now();
    ctx.emit?.('log', `⏳ 等待后置条件（最多 ${timeout / 1000}s）...`);

    while (Date.now() - start < timeout) {
      const url = page.url();

      if (wa.urlContains && url.includes(wa.urlContains)) {
        ctx.emit?.('log', `✅ 后置条件满足：URL 包含 "${wa.urlContains}"`);
        break;
      }

      if (wa.selector) {
        const visible = await page.locator(wa.selector).isVisible().catch(() => false);
        if (wa.action === 'appeared' && visible) { ctx.emit?.('log', `✅ 后置元素出现`); break; }
        if (wa.action === 'disappeared' && !visible) { ctx.emit?.('log', `✅ 后置元素消失`); break; }
      }

      if (wa.successKeywords?.length || wa.failKeywords?.length) {
        const text = await page.evaluate(() => document.body.innerText).catch(() => '');
        const failWord = wa.failKeywords?.find(k => text.includes(k));
        if (failWord) {
          result = { ...result, success: false, error: `后置检测失败：页面含"${failWord}"` };
          ctx.emit?.('log', `❌ 后置检测失败：${failWord}`);
          break;
        }
        const successWord = wa.successKeywords?.find(k => text.includes(k));
        if (successWord) { ctx.emit?.('log', `✅ 后置关键词满足："${successWord}"`); break; }
      }

      await page.waitForTimeout(500);
    }
  }

  // ── 自动截图（默认开启，除非明确关闭）────────────────────────────────────
  if (node.autoScreenshot !== false && !result.screenshot) {
    const shot = await captureScreenshot(page).catch(() => undefined);
    if (shot) {
      result = { ...result, screenshot: shot };
      ctx.emit?.('screenshot', shot);
    }
  } else if (result.screenshot) {
    ctx.emit?.('screenshot', result.screenshot);
  }

  return result;
}

// ── 自动全流程执行（SSE 模式）─────────────────────────────────────────────────

export interface RunWorkflowOptions {
  workflow: WorkflowDef;
  vars: Record<string, string>;
  page: Page;
  emit: (type: string, payload: string) => void;
  startFrom?: number;
}

export interface RunWorkflowResult {
  success: boolean;
  message: string;
  completedSteps: number;
  totalSteps: number;
  outputs: Record<string, unknown>;
}

export async function runWorkflow(options: RunWorkflowOptions): Promise<RunWorkflowResult> {
  const { workflow, vars, page, emit, startFrom = 0 } = options;
  const ctx: WorkflowContext = { vars, outputs: {}, emit };
  const nodes = workflow.nodes;
  let completedSteps = 0;

  for (let i = startFrom; i < nodes.length; i++) {
    const node = nodes[i];
    emit('log', `\n── 步骤 ${i + 1}/${nodes.length}：${node.label ?? node.type} ──`);

    const result = await executeNode(page, node, ctx);

    // 把输出合并进 context（后续节点可读取）
    if (result.output) {
      Object.assign(ctx.outputs, result.output);
    }

    // 推送每步日志
    for (const line of result.log) {
      emit('log', line);
    }

    if (!result.success && !node.continueOnError) {
      emit('error', result.error ?? '节点执行失败');
      return {
        success: false,
        message: `步骤 ${i + 1}（${node.label ?? node.type}）失败：${result.error}`,
        completedSteps,
        totalSteps: nodes.length,
        outputs: ctx.outputs,
      };
    }

    completedSteps++;
  }

  return {
    success: true,
    message: '工作流执行完成',
    completedSteps,
    totalSteps: nodes.length,
    outputs: ctx.outputs,
  };
}
