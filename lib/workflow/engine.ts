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

import { executeNavigate } from './nodes/navigate';
import { executeTextInput } from './nodes/text-input';
import { executeClick } from './nodes/click';
import { executeScroll } from './nodes/scroll';
import { executeScreenshot } from './nodes/screenshot';
import { executeFileUpload } from './nodes/file-upload';
import { executeWaitCondition } from './nodes/wait-condition';
import { executeQRCode } from './nodes/qrcode';

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

  ctx.emit?.('log', `▶️ 执行节点：${node.label ?? node.type}`);

  try {
    const result = await executor(page, resolvedParams, ctx);
    if (result.screenshot) ctx.emit?.('screenshot', result.screenshot);
    return result;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { success: false, log: [`❌ 节点异常: ${error}`], error };
  }
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
