import { randomUUID } from 'crypto';
import { chromium, type Browser, type Page } from 'playwright';
import { getPersistentContext } from '@/lib/persistent-browser';
import { shouldDeferNativePageBootstrap } from '@/lib/workflow/node-runtime';
import { runWorkflow } from '@/lib/workflow/engine';
import {
  addTaskLog,
  createTask,
  getTask,
  setTaskFinalVars,
  setTaskStepError,
  setTaskStepRunning,
  setTaskStepSkipped,
  setTaskStepSuccess,
  stopTask as stopStoredTask,
  updateTaskCurrentStep,
  updateTaskStatus,
  wfTaskDiag,
  type WorkflowTask,
} from '@/lib/workflow/task-store';
import { parseWorkflowStepErrorMessage } from '@/lib/workflow/step-error-meta';
import { getWorkflow } from '@/lib/workflow/workflow-db';
import type { WorkflowDef } from '@/lib/workflow/types';

const OUTPUT_PREVIEW_MAX = 280;

function stringifyOutputValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    return v.length > OUTPUT_PREVIEW_MAX ? `${v.slice(0, OUTPUT_PREVIEW_MAX)}…` : v;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    const j = JSON.stringify(v);
    return j.length > OUTPUT_PREVIEW_MAX ? `${j.slice(0, OUTPUT_PREVIEW_MAX)}…` : j;
  } catch {
    return String(v);
  }
}

function summarizeStepOutput(output: Record<string, unknown> | undefined): {
  output_keys: string[];
  output_preview: Record<string, string>;
} | undefined {
  if (!output || typeof output !== 'object') return undefined;
  const keys = Object.keys(output);
  if (keys.length === 0) return undefined;
  const output_preview: Record<string, string> = {};
  for (const k of keys) {
    output_preview[k] = stringifyOutputValue(output[k]);
  }
  return { output_keys: keys, output_preview };
}

function inferPrimaryOutputVar(workflow: WorkflowDef): string | null {
  for (let i = workflow.nodes.length - 1; i >= 0; i--) {
    const n = workflow.nodes[i];
    if (n.disabled) continue;
    if (n.type === 'extract_image_download' || n.type === 'extract_image_clipboard') {
      const v = (n.params as { outputVar?: string }).outputVar;
      return typeof v === 'string' && v.trim() ? v.trim() : 'imageUrl';
    }
  }
  return null;
}

function buildResultHighlights(
  finalVars: Record<string, string>,
  workflow: WorkflowDef
): {
  primaryGeneratedImageUrl: string | null;
  referenceImageUrl: string | null;
  primaryOutputVar: string | null;
  primaryOutputVarUrl: string | null;
  hint: string;
} {
  const primaryOutputVar = inferPrimaryOutputVar(workflow);
  const gen = finalVars.generatedImageUrl?.trim() || null;
  const primary = finalVars.primaryMediaUrl?.trim() || null;
  const src = finalVars.sourceImageUrl?.trim() || null;
  const img = finalVars.imageUrl?.trim() || null;
  const media = finalVars.mediaUrl?.trim() || null;

  let primaryOutputVarUrl: string | null = null;
  if (primaryOutputVar && finalVars[primaryOutputVar]) {
    const u = finalVars[primaryOutputVar].trim();
    if (u.startsWith('http')) primaryOutputVarUrl = u;
  }

  let primaryGeneratedImageUrl = gen || primary || null;
  if (!primaryGeneratedImageUrl && primaryOutputVarUrl) primaryGeneratedImageUrl = primaryOutputVarUrl;
  if (!primaryGeneratedImageUrl && img && img !== src) primaryGeneratedImageUrl = img;
  if (!primaryGeneratedImageUrl) primaryGeneratedImageUrl = media;

  const hint =
    primaryOutputVar != null
      ? `主产出：优先看 resultHighlights.primaryGeneratedImageUrl；与工作流最后一个提取节点 outputVar「${primaryOutputVar}」对应；sourceImageUrl 为入参参考图。`
      : '主产出：优先看 resultHighlights.primaryGeneratedImageUrl、generatedImageUrl；sourceImageUrl 为入参参考图。';

  return {
    primaryGeneratedImageUrl,
    referenceImageUrl: src,
    primaryOutputVar,
    primaryOutputVarUrl,
    hint,
  };
}

export interface WorkflowTaskSummaryView {
  taskId: string;
  workflowId: string;
  status: WorkflowTask['status'];
  progress: {
    currentStep: number;
    totalSteps: number;
    percentage: number;
  };
  duration: {
    elapsed: number;
    estimated: number;
  };
  stepStatus: Array<{
    idx: number;
    status: WorkflowTask['steps'][number]['status'];
    label?: string;
    nodeType: string;
    duration: number | null;
    /** 本步 status=error 时的失败原因（与 steps[].error 一致，便于摘要接口直接展示） */
    error?: string;
    error_code?: string;
    error_msg?: string;
    /** 本步节点写入的 output 字段名（有 output 时） */
    output_keys?: string[];
    /** 与 output_keys 对应的值预览（已截断） */
    output_preview?: Record<string, string>;
  }>;
  /** 首个失败步骤的 1-based 序号，无失败为 null */
  failedStepIdx: number | null;
  lastLog: string;
  /** 从 finalVars 提炼：主生成图 URL、参考图 URL、工作流主输出变量名 */
  resultHighlights: {
    primaryGeneratedImageUrl: string | null;
    referenceImageUrl: string | null;
    primaryOutputVar: string | null;
    primaryOutputVarUrl: string | null;
    hint: string;
  };
  finalVars: Record<string, string>;
  isError: boolean;
  errorMessage: string | null;
  /** 与 errorMessage 同源拆分，便于客户端分支 */
  error_code: string | null;
  error_msg: string | null;
  startedAt: number;
  completedAt: number | null;
  totalDuration: number | null;
}

export interface WorkflowTaskDetailView extends WorkflowTaskSummaryView {
  workflow: WorkflowDef;
  /** 详情接口不返回 screenshot，避免 base64 撑爆响应体 */
  steps: Array<{
    idx: number;
    nodeType: string;
    label?: string;
    status: WorkflowTask['steps'][number]['status'];
    duration: number | null;
    logs: string[];
    output: Record<string, unknown> | null;
    error: string | null;
    error_code: string | null;
    error_msg: string | null;
    executedAt: number | null;
  }>;
}

export interface WorkflowTaskArtifacts {
  mediaUrls: string[];
  imageUrls: string[];
  primaryMediaUrl: string | null;
  primaryImageUrl: string | null;
  primaryMediaType: 'image' | 'video' | 'unknown';
  outputs: Record<string, unknown>;
  vars: Record<string, string>;
}

function normalizeVars(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null || v === undefined) out[k] = '';
    else if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
    else {
      try {
        out[k] = JSON.stringify(v);
      } catch {
        out[k] = String(v);
      }
    }
  }
  return out;
}

function mergeOutputsToFinalVars(
  initial: Record<string, string>,
  outputs: Record<string, unknown>
): Record<string, string> {
  const finalVars = { ...initial };
  for (const [k, v] of Object.entries(outputs)) {
    if (v === null || v === undefined) finalVars[k] = '';
    else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      finalVars[k] = String(v);
    } else {
      try {
        finalVars[k] = JSON.stringify(v);
      } catch {
        finalVars[k] = String(v);
      }
    }
  }
  return finalVars;
}

async function startWorkflowAsync(taskId: string, task: WorkflowTask) {
  let page: Page | null = null;
  let placeholderBrowser: Browser | null = null;
  const deferBootstrap = shouldDeferNativePageBootstrap(task.workflow);
  wfTaskDiag('run.start', {
    taskId,
    workflowId: task.workflowId,
    nodeCount: task.workflow.nodes.length,
    deferBootstrap,
    initialStatus: task.status,
  });
  try {
    if (deferBootstrap) {
      placeholderBrowser = await chromium.launch({ headless: true });
      page = await placeholderBrowser.newPage();
    } else {
      const browserCtx = await getPersistentContext();
      page = await browserCtx.newPage();
    }
    page.on('dialog', (d) => d.accept());

    wfTaskDiag('run.workflow.enter', { taskId, workflowId: task.workflowId });

    const runResult = await runWorkflow({
      workflow: task.workflow,
      vars: task.initialVars,
      page,
      shouldAbort: () => getTask(taskId)?.status === 'stopped',
      beforeStep: (stepIdx) => {
        if (getTask(taskId)?.status === 'stopped') return;
        updateTaskCurrentStep(taskId, stepIdx);
        setTaskStepRunning(taskId, stepIdx);
      },
      emit: (type, payload) => {
        const t = getTask(taskId);
        if (!t || type !== 'log') return;
        addTaskLog(taskId, t.currentStep, payload);
      },
      afterStep: (stepIdx, _node, result) => {
        const dur = result.durationMs ?? 0;
        if (result.success) {
          const skipped = Boolean((result.output as { skipped?: boolean } | undefined)?.skipped);
          if (skipped) setTaskStepSkipped(taskId, stepIdx);
          else setTaskStepSuccess(taskId, stepIdx, result, dur);
        } else {
          setTaskStepError(taskId, stepIdx, result.error ?? 'failed', dur, {
            errorCode: result.errorCode,
            errorMsg: result.errorMsg,
          });
        }
      },
    });

    const t = getTask(taskId);
    if (!t || t.status === 'stopped') {
      wfTaskDiag('run.exit_early', {
        taskId,
        workflowId: task.workflowId,
        reason: !t ? 'task_missing_after_run' : 'stopped',
        runSuccess: runResult.success,
        runMessage: runResult.message ?? '',
      });
      return;
    }

    setTaskFinalVars(taskId, mergeOutputsToFinalVars(t.initialVars, runResult.outputs));

    if (runResult.success) {
      wfTaskDiag('run.finish', { taskId, workflowId: task.workflowId, outcome: 'done' });
      updateTaskStatus(taskId, 'done');
    } else if (runResult.message === '任务已停止') {
      wfTaskDiag('run.finish', { taskId, workflowId: task.workflowId, outcome: 'stopped_by_message' });
    } else {
      wfTaskDiag('run.finish', {
        taskId,
        workflowId: task.workflowId,
        outcome: 'error',
        message: runResult.message ?? '',
      });
      updateTaskStatus(taskId, 'error', true, runResult.message);
    }
  } catch (err) {
    console.error(`Task ${taskId} failed:`, err);
    wfTaskDiag('run.catch', {
      taskId,
      workflowId: task.workflowId,
      errName: err instanceof Error ? err.name : typeof err,
      errMessage: err instanceof Error ? err.message : String(err),
    });
    const t = getTask(taskId);
    if (t && t.status !== 'stopped') {
      updateTaskStatus(taskId, 'error', true, err instanceof Error ? err.message : String(err));
    }
  } finally {
    wfTaskDiag('run.finally', {
      taskId,
      workflowId: task.workflowId,
      placeholderClosed: Boolean(placeholderBrowser),
      pageWasClosed: page ? page.isClosed() : true,
    });
    if (placeholderBrowser) {
      await placeholderBrowser.close().catch(() => {});
    } else if (page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
  }
}

function buildTaskProgress(task: WorkflowTask) {
  const totalSteps = task.steps.length;
  const completedSteps = task.steps.filter((s) => s.status !== 'pending' && s.status !== 'running').length;
  const percentage = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const elapsed = Date.now() - task.startedAt;
  const estimated = task.totalDuration || elapsed * 2;

  return {
    totalSteps,
    percentage,
    elapsed,
    estimated,
  };
}

function findLastLog(task: WorkflowTask): string {
  for (let i = task.steps.length - 1; i >= 0; i--) {
    if (task.steps[i].logs.length > 0) {
      return task.steps[i].logs[task.steps[i].logs.length - 1];
    }
  }
  return '';
}

/** 1-based，无失败步骤为 null（兼容旧任务：仅 steps 有 error、未写 failedStepIdx） */
function resolveFailedStepIdx1(task: WorkflowTask): number | null {
  if (task.failedStepIdx !== undefined) return task.failedStepIdx + 1;
  const i = task.steps.findIndex((s) => s.status === 'error');
  return i >= 0 ? i + 1 : null;
}

export async function startWorkflowTask(input: {
  workflowId: string;
  vars?: Record<string, unknown>;
  workflow?: WorkflowDef;
}) {
  const workflowId = input.workflowId.trim();
  if (!workflowId) {
    throw new Error('Missing workflowId');
  }

  const workflow = input.workflow ?? await getWorkflow(workflowId);
  if (!workflow) {
    throw new Error('Workflow not found');
  }

  const vars = normalizeVars(input.vars);
  const taskId = randomUUID();
  const task = createTask(taskId, workflowId, workflow, vars);

  wfTaskDiag('post.accept', {
    taskId,
    workflowId,
    nodeCount: workflow.nodes.length,
    varKeys: Object.keys(vars),
  });

  void startWorkflowAsync(taskId, task);
  return task;
}

export function getWorkflowTask(taskId: string) {
  return getTask(taskId);
}

export function getWorkflowTaskSummary(taskId: string): WorkflowTaskSummaryView | null {
  const task = getTask(taskId);
  if (!task) return null;
  const progress = buildTaskProgress(task);

  return {
    taskId: task.taskId,
    workflowId: task.workflowId,
    status: task.status,
    progress: {
      currentStep: task.currentStep + 1,
      totalSteps: progress.totalSteps,
      percentage: progress.percentage,
    },
    duration: {
      elapsed: progress.elapsed,
      estimated: progress.estimated,
    },
    stepStatus: task.steps.map((s) => {
      const row: WorkflowTaskSummaryView['stepStatus'][number] = {
        idx: s.idx + 1,
        status: s.status,
        label: s.label,
        nodeType: s.nodeType,
        duration: s.duration,
      };
      if (s.status === 'error' && s.error) {
        row.error = s.error;
        row.error_code =
          s.errorCode ?? parseWorkflowStepErrorMessage(s.error).error_code;
        row.error_msg = s.errorMsg ?? parseWorkflowStepErrorMessage(s.error).error_msg;
      }
      const outSum = summarizeStepOutput(s.output as Record<string, unknown> | undefined);
      if (outSum) {
        row.output_keys = outSum.output_keys;
        row.output_preview = outSum.output_preview;
      }
      return row;
    }),
    failedStepIdx: resolveFailedStepIdx1(task),
    lastLog: findLastLog(task),
    resultHighlights: buildResultHighlights(task.finalVars, task.workflow),
    finalVars: task.finalVars,
    isError: task.isError,
    errorMessage: task.errorMessage || null,
    error_code:
      task.errorCode ??
      (task.errorMessage ? parseWorkflowStepErrorMessage(task.errorMessage).error_code : null),
    error_msg:
      task.errorMsg ??
      (task.errorMessage ? parseWorkflowStepErrorMessage(task.errorMessage).error_msg : null),
    startedAt: task.startedAt,
    completedAt: task.completedAt || null,
    totalDuration: task.totalDuration || null,
  };
}

export function getWorkflowTaskDetail(taskId: string): WorkflowTaskDetailView | null {
  const task = getTask(taskId);
  if (!task) return null;
  const summary = getWorkflowTaskSummary(taskId);
  if (!summary) return null;

  return {
    ...summary,
    workflow: task.workflow,
    steps: task.steps.map((s) => ({
      idx: s.idx + 1,
      nodeType: s.nodeType,
      label: s.label,
      status: s.status,
      duration: s.duration,
      logs: s.logs,
      output: s.output || null,
      error: s.error || null,
      error_code:
        s.errorCode ?? (s.error ? parseWorkflowStepErrorMessage(s.error).error_code : null),
      error_msg:
        s.errorMsg ?? (s.error ? parseWorkflowStepErrorMessage(s.error).error_msg : null),
      executedAt: s.executedAt || null,
    })),
  };
}

function inferMediaKindFromUrl(value: string): 'image' | 'video' | 'unknown' {
  const v = value.trim();
  if (!v.startsWith('http')) return 'unknown';
  if (/\.(png|jpg|jpeg|webp|gif|bmp|svg|avif)(\?|$)/i.test(v)) return 'image';
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(v)) return 'video';
  if (/image|img|picture|photo/i.test(v)) return 'image';
  if (/video|movie|clip/i.test(v)) return 'video';
  return v.includes('oss-') || v.includes('.aliyuncs.com') ? 'image' : 'unknown';
}

function collectStringsDeep(input: unknown, acc: Set<string>) {
  if (typeof input === 'string') {
    const value = input.trim();
    if (value && inferMediaKindFromUrl(value) !== 'unknown') acc.add(value);
    return;
  }
  if (Array.isArray(input)) {
    for (const item of input) collectStringsDeep(item, acc);
    return;
  }
  if (input && typeof input === 'object') {
    for (const value of Object.values(input as Record<string, unknown>)) {
      collectStringsDeep(value, acc);
    }
  }
}

export function collectWorkflowTaskArtifacts(taskId: string): WorkflowTaskArtifacts | null {
  const task = getTask(taskId);
  if (!task) return null;

  const urls = new Set<string>();
  const outputs: Record<string, unknown> = {};
  for (const step of task.steps) {
    if (!step.output) continue;
    Object.assign(outputs, step.output);
    collectStringsDeep(step.output, urls);
  }

  collectStringsDeep(
    {
      mediaUrl: task.finalVars.mediaUrl,
      imageUrl: task.finalVars.imageUrl,
      videoUrl: task.finalVars.videoUrl,
      primaryMediaUrl: task.finalVars.primaryMediaUrl,
      primaryImageUrl: task.finalVars.primaryImageUrl,
      mediaUrls: task.finalVars.mediaUrls,
      imageUrls: task.finalVars.imageUrls,
    },
    urls
  );

  const mediaUrls = Array.from(urls);
  const imageUrls = mediaUrls.filter((url) => inferMediaKindFromUrl(url) === 'image');
  const primaryMediaUrl = mediaUrls[0] ?? null;

  return {
    mediaUrls,
    imageUrls,
    primaryMediaUrl,
    primaryImageUrl: imageUrls[0] ?? null,
    primaryMediaType: primaryMediaUrl ? inferMediaKindFromUrl(primaryMediaUrl) : 'unknown',
    outputs,
    vars: task.finalVars,
  };
}

export function stopWorkflowTask(taskId: string, reason?: string) {
  const task = getTask(taskId);
  if (!task) return null;
  stopStoredTask(taskId, reason);
  return getTask(taskId);
}
