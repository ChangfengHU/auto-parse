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
import { getCatalogItem } from './node-catalog';

import { executeMaterial } from './nodes/material';
import { executeNavigate } from './nodes/navigate';
import { executeTextInput } from './nodes/text-input';
import { executePasteImageClipboard } from './nodes/paste-image-clipboard';
import { executePressHotkey } from './nodes/press-hotkey';
import { executeClick } from './nodes/click';
import { executeScroll } from './nodes/scroll';
import { executeScreenshot } from './nodes/screenshot';
import { executeFileUpload } from './nodes/file-upload';
import { executeWaitCondition } from './nodes/wait-condition';
import { executeQRCode } from './nodes/qrcode';
import { executeHumanPause } from './nodes/human-pause';
import { executeExtractImage } from './nodes/extract-image';
import { executeExtractImageClipboard } from './nodes/extract-image-clipboard';
import { executeExtractImageDownload } from './nodes/extract-image-download';
import { executeXhsDownload } from './nodes/xhs-download';
import { executeLocalhostImageDownload } from './nodes/localhost-image-download';
import { executeLocalhostImageDownloadDebug } from './nodes/localhost-image-download-debug';
import { executeCredentialLogin } from './nodes/credential-login';
import { executeWorkflowCall } from './nodes/workflow-call';
import { executeMetaAIGenerate } from './nodes/metaai-generate';
import { executeGeminiParallelGenerate } from './nodes/gemini-parallel-generate';
import { executeVertexAI } from './nodes/vertex-ai';
import { executeTopicPickerAgent } from './nodes/topic-picker-agent';
import { executeAgentReact } from './nodes/agent-react';

// ── 节点注册表 ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NodeExecutor = (page: Page, params: any, ctx: WorkflowContext) => Promise<NodeResult>;

const NODE_REGISTRY: Record<NodeType, NodeExecutor> = {
  material:              executeMaterial,
  navigate:              executeNavigate,
  text_input:            executeTextInput,
  paste_image_clipboard: executePasteImageClipboard,
  press_hotkey:          executePressHotkey,
  click:                 executeClick,
  scroll:                executeScroll,
  screenshot:            executeScreenshot,
  file_upload:           executeFileUpload,
  wait_condition:        executeWaitCondition,
  qrcode:                executeQRCode,
  human_pause:           executeHumanPause,
  extract_image:         executeExtractImage,
  extract_image_clipboard: executeExtractImageClipboard,
  extract_image_download: executeExtractImageDownload,
  xhs_download:          executeXhsDownload,
  localhost_image_download: executeLocalhostImageDownload,
  localhost_image_download_debug: executeLocalhostImageDownloadDebug,
  credential_login:       executeCredentialLogin,
  workflow_call:          executeWorkflowCall,
  metaai_generate:       executeMetaAIGenerate,
  gemini_parallel_generate: executeGeminiParallelGenerate,
  vertex_ai:             executeVertexAI,
  topic_picker_agent:    executeTopicPickerAgent,
  agent_react:           executeAgentReact,
};

// ── 单步执行 ──────────────────────────────────────────────────────────────────

export async function executeNode(
  page: Page,
  node: NodeDef,
  ctx: WorkflowContext
): Promise<NodeResult> {
  // 检查节点是否禁用
  if (node.disabled) {
    const msg = `⏭️ 节点已禁用，跳过执行：${node.label ?? node.type}`;
    ctx.emit?.('log', msg);
    // 不写 output：避免 { skipped, reason } 合并进 finalVars，下游误判「整单未产出」
    return {
      success: true,
      log: [msg],
      stepSkipped: true,
    };
  }

  const startTime = performance.now();
  const executor = NODE_REGISTRY[node.type];
  if (!executor) {
    return { success: false, log: [`❌ 未知节点类型: ${node.type}`], error: `unknown node: ${node.type}` };
  }

  const catalog = getCatalogItem(node.type);
  // 合并默认参数与实例参数，确保 UI 上显示的默认配置（如 AdsPower 分身 ID）在实际执行中能够“打底”生效
  const baseParams = { ...(catalog?.defaultParams ?? {}), ...node.params };
  
  // 解析模板变量
  const resolvedParams = resolveParams(baseParams, ctx.vars);

  // 兼容旧/误填配置：导航节点如果把 URL 填在了节点级 url，而 params.url 还是默认占位值，则自动兜底到 node.url
  if (node.type === 'navigate') {
    const navParams = resolvedParams as Record<string, unknown>;
    const currentUrl = typeof navParams.url === 'string' ? navParams.url.trim() : '';
    if ((!currentUrl || currentUrl === 'https://') && node.url) {
      navParams.url = resolveParams({ url: node.url }, ctx.vars).url;
      ctx.emit?.('log', `💡 导航节点已自动使用顶部 URL：${String(navParams.url)}`);
    }
  }

  // ── 节点前置导航（url 字段设置时自动跳转）─────────────────────────────────
  // 注意：对于导航节点本身，我们跳过解析此处的 url 自动跳转，由 navigate 节点内部 logic 统一处理，避免双重跳转
  if (node.url && node.type !== 'navigate') {
    const resolvedUrl = resolveParams({ url: node.url }, ctx.vars).url as string;
    const currentUrl = page.url();
    if (resolvedUrl && !currentUrl.includes(resolvedUrl) && !resolvedUrl.includes(currentUrl)) {
      ctx.emit?.('log', `🌐 节点前置自动导航：${resolvedUrl}`);
      try {
        await page.goto(resolvedUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch (e) {
        ctx.emit?.('log', `⚠️ 前置导航超时，尝试继续执行：${String(e).slice(0, 80)}`);
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

  const resultPage = (result.newPage as Page | undefined) ?? page;

  // ── 节点后置等待（waitAfter 启用时）────────────────────────────────────────
  if (result.success && node.waitAfter?.enabled) {
    const wa = node.waitAfter;
    const waitAction = wa.action ?? (wa.selector ? 'appeared' : undefined);
    const delaySeconds = Math.max(0, wa.delaySeconds ?? 0);
    const timeout = wa.timeout ?? 15_000;
    if (delaySeconds > 0) {
      ctx.emit?.('log', `⏱️ 延迟 ${delaySeconds}s 后开始判断后置条件...`);
      await resultPage.waitForTimeout(delaySeconds * 1000);
    }
    const start = Date.now();
    ctx.emit?.('log', `⏳ 等待后置条件（最多 ${timeout / 1000}s）...`);

    while (Date.now() - start < timeout) {
      const url = resultPage.url();

      if (wa.urlContains && url.includes(wa.urlContains)) {
        ctx.emit?.('log', `✅ 后置条件满足：URL 包含 "${wa.urlContains}"`);
        break;
      }

      if (wa.selector) {
        const visible = await resultPage.locator(wa.selector).first().isVisible().catch(() => false);
        if (waitAction === 'appeared' && visible) { ctx.emit?.('log', `✅ 后置元素出现`); break; }
        if (waitAction === 'disappeared' && !visible) { ctx.emit?.('log', `✅ 后置元素消失`); break; }
      }

      if (wa.successKeywords?.length || wa.failKeywords?.length) {
        const text = await resultPage.evaluate(() => document.body.innerText).catch(() => '');
        const failWord = wa.failKeywords?.find(k => text.includes(k));
        if (failWord) {
          result = { ...result, success: false, error: `后置检测失败：页面含"${failWord}"` };
          ctx.emit?.('log', `❌ 后置检测失败：${failWord}`);
          break;
        }
        const successWord = wa.successKeywords?.find(k => text.includes(k));
        if (successWord) { ctx.emit?.('log', `✅ 后置关键词满足："${successWord}"`); break; }
      }

      await resultPage.waitForTimeout(500);
    }
  }

  // ── 自动截图及耗时收尾 ────────────────────────────────────────────────
  if (node.autoScreenshot !== false && !result.screenshot) {
    const shot = await captureScreenshot(resultPage).catch(() => undefined);
    if (shot) {
      result = { ...result, screenshot: shot };
      ctx.emit?.('screenshot', shot);
    }
  } else if (result.screenshot) {
    ctx.emit?.('screenshot', result.screenshot);
  }

  const durationMs = Math.round(performance.now() - startTime);
  const durationS = (durationMs / 1000).toFixed(2);
  
  result.durationMs = durationMs;

  if (result.success) {
    ctx.emit?.('log', `⏱️ 节点执行耗时: ${durationS}s`);
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
  /** 每步执行前（已做过 shouldAbort 检查） */
  beforeStep?: (stepIndex: number, node: NodeDef, ctx: WorkflowContext) => void | Promise<void>;
  /** 每步日志已 emit 后、判定失败返回前 */
  afterStep?: (stepIndex: number, node: NodeDef, result: NodeResult, ctx: WorkflowContext) => void | Promise<void>;
  /** 每步开始前检查，返回 true 则中止整次 run（如任务已被 stop） */
  shouldAbort?: () => boolean;
}

export interface RunWorkflowResult {
  success: boolean;
  message: string;
  completedSteps: number;
  totalSteps: number;
  outputs: Record<string, unknown>;
}

export async function runWorkflow(options: RunWorkflowOptions): Promise<RunWorkflowResult> {
  const { workflow, vars, page, emit, startFrom = 0, beforeStep, afterStep, shouldAbort } = options;
  const ctx: WorkflowContext = { vars, outputs: {}, emit };
  const nodes = workflow.nodes;
  let completedSteps = 0;
  let currentRunningPage = page; // 使用局部变量追踪当前活跃页面，支持中途掉包

  for (let i = startFrom; i < nodes.length; i++) {
    if (shouldAbort?.()) {
      return {
        success: false,
        message: '任务已停止',
        completedSteps,
        totalSteps: nodes.length,
        outputs: ctx.outputs,
      };
    }

    const node = nodes[i];
    await beforeStep?.(i, node, ctx);

    emit('log', `\n── 步骤 ${i + 1}/${nodes.length}：${node.label ?? node.type} ──`);

    const result = await executeNode(currentRunningPage, node, ctx);

    // 【核心黑科技】探测到浏览器接管指令：如果节点（如导航）返回了新页面，则后续步骤全部切换到新环境
    if (result.newPage) {
      currentRunningPage = result.newPage as Page;
      emit('log', `⚠️ [系统接管] 检测到环境热切换，后续步骤已自动迁移至新容器运行`);
    }

    // 把输出合并进 context（后续节点可读取）
    if (result.output) {
      Object.assign(ctx.outputs, result.output);
    }

    // 推送每步日志
    for (const line of result.log) {
      emit('log', line);
    }

    await afterStep?.(i, node, result, ctx);

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
