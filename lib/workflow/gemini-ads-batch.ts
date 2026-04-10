import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createGeminiWebImageTask, getGeminiWebImageTask, cancelGeminiWebImageTask } from './gemini-web-image';
import { getWorkflow, listWorkflows } from './workflow-db';
import type { WorkflowDef } from './types';

type BatchStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
type BatchRunStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

interface BatchRunInput {
  browserInstanceId: string;
  prompt: string;
  browserWsUrl?: string;
}

interface BatchRunState extends BatchRunInput {
  index: number;
  status: BatchRunStatus;
  attempts: number;
  taskId?: string;
  imageUrls: string[];
  error?: string;
  startedAt?: string;
  endedAt?: string;
}

interface BatchSummary {
  total: number;
  queued: number;
  running: number;
  success: number;
  failed: number;
  cancelled: number;
}

export interface GeminiAdsBatchTask {
  id: string;
  status: BatchStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  cancelRequested: boolean;
  workflowId: string;
  workflowName: string;
  promptVarName: string;
  maxConcurrency: number;
  maxAttemptsPerRun: number;
  autoCloseTab: boolean;
  cacheUntil?: string;
  summary: BatchSummary;
  runs: BatchRunState[];
}

declare global {
  var __geminiAdsBatchTasks: Map<string, GeminiAdsBatchTask> | undefined;
}

function taskStore() {
  if (!global.__geminiAdsBatchTasks) {
    global.__geminiAdsBatchTasks = new Map();
  }
  return global.__geminiAdsBatchTasks;
}

const TASK_CACHE_TTL_MS = Number(process.env.GEMINI_ADS_BATCH_TASK_CACHE_TTL_MS || 30 * 60 * 1000);
const TASK_CACHE_DIR = path.join(os.tmpdir(), 'gemini-ads-batch-task-cache');

function cacheFile(taskId: string) {
  return path.join(TASK_CACHE_DIR, `${taskId}.json`);
}

function persistTask(task: GeminiAdsBatchTask) {
  try {
    fs.mkdirSync(TASK_CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile(task.id), JSON.stringify(task), 'utf8');
  } catch {
    // ignore disk cache failure
  }
}

function loadPersistedTask(taskId: string): GeminiAdsBatchTask | undefined {
  try {
    const file = cacheFile(taskId);
    if (!fs.existsSync(file)) return undefined;
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw) as GeminiAdsBatchTask;
  } catch {
    return undefined;
  }
}

function removePersistedTask(taskId: string) {
  try {
    fs.unlinkSync(cacheFile(taskId));
  } catch {
    // ignore
  }
}

function isTaskExpired(task: GeminiAdsBatchTask) {
  if (!task.cacheUntil) return false;
  const expiresAt = Date.parse(task.cacheUntil);
  if (!Number.isFinite(expiresAt)) return false;
  return Date.now() > expiresAt;
}

function computeSummary(runs: BatchRunState[]): BatchSummary {
  return {
    total: runs.length,
    queued: runs.filter((item) => item.status === 'queued').length,
    running: runs.filter((item) => item.status === 'running').length,
    success: runs.filter((item) => item.status === 'success').length,
    failed: runs.filter((item) => item.status === 'failed').length,
    cancelled: runs.filter((item) => item.status === 'cancelled').length,
  };
}

function updateTask(id: string, patch: Partial<GeminiAdsBatchTask>) {
  const current = taskStore().get(id);
  if (!current) return undefined;
  const next = { ...current, ...patch };
  taskStore().set(id, next);
  persistTask(next);
  return next;
}

function updateRun(taskId: string, index: number, patch: Partial<BatchRunState>) {
  const current = taskStore().get(taskId);
  if (!current) return undefined;
  const runs = current.runs.map((item) => (item.index === index ? { ...item, ...patch } : item));
  const next = { ...current, runs, summary: computeSummary(runs) };
  taskStore().set(taskId, next);
  persistTask(next);
  return next;
}

function isAdsWorkflow(workflow: WorkflowDef): boolean {
  return workflow.nodes.some((node) => {
    if (node.type !== 'navigate') return false;
    const params = (node.params ?? {}) as Record<string, unknown>;
    return Boolean(params.useAdsPower);
  });
}

function pickPromptVarName(workflow: WorkflowDef, requested?: string): string {
  if (requested?.trim()) return requested.trim();
  if (workflow.vars.includes('noteUrl')) return 'noteUrl';
  if (workflow.vars.includes('prompt')) return 'prompt';
  if (workflow.vars.includes('text')) return 'text';
  return 'noteUrl';
}

async function resolveAdsWorkflow(workflowId?: string): Promise<WorkflowDef | null> {
  if (workflowId?.trim()) return getWorkflow(workflowId.trim());
  const preferredName = process.env.GEMINI_WEB_IMAGE_ADS_WORKFLOW_NAME || 'gemini流程管理-ads';
  const all = await listWorkflows();
  const byName = all.find((item) => item.name === preferredName)
    || all.find((item) => item.name.includes('gemini流程管理-ads'));
  if (!byName) return null;
  return getWorkflow(byName.id);
}

function buildRunVars(input: {
  promptVarName: string;
  run: BatchRunInput;
}) {
  const prompt = input.run.prompt.trim();
  return {
    prompt,
    userPrompt: prompt,
    noteUrl: prompt,
    note_url: prompt,
    text: prompt,
    input: prompt,
    prompts: JSON.stringify([prompt]),
    [input.promptVarName]: prompt,
    browserInstanceId: input.run.browserInstanceId.trim(),
    browserWsUrl: String(input.run.browserWsUrl || '').trim(),
  } as Record<string, string>;
}

function isTerminal(status: string) {
  return status === 'success' || status === 'failed' || status === 'cancelled';
}

async function runBatchTask(taskId: string) {
  const task = taskStore().get(taskId);
  if (!task) return;
  const workflow = await getWorkflow(task.workflowId);
  if (!workflow) {
    updateTask(taskId, {
      status: 'failed',
      endedAt: new Date().toISOString(),
      cacheUntil: new Date(Date.now() + TASK_CACHE_TTL_MS).toISOString(),
      runs: task.runs.map((item) => ({
        ...item,
        status: item.status === 'success' ? item.status : 'failed',
        error: item.error || '工作流不存在',
        endedAt: item.endedAt || new Date().toISOString(),
      })),
    });
    return;
  }

  updateTask(taskId, { status: 'running', startedAt: new Date().toISOString() });
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const fresh = taskStore().get(taskId);
      if (!fresh) return;
      if (fresh.cancelRequested) return;
      const index = cursor;
      cursor += 1;
      if (index >= fresh.runs.length) return;

      const run = fresh.runs[index];
      const startedAt = new Date().toISOString();
      updateRun(taskId, index, { status: 'running', startedAt, error: undefined, endedAt: undefined, imageUrls: [] });

      try {
        const vars = buildRunVars({
          promptVarName: fresh.promptVarName,
          run,
        });
        const maxAttempts = Math.max(1, fresh.maxAttemptsPerRun || 1);
        let finalStatus: BatchRunStatus = 'failed';
        let finalImageUrls: string[] = [];
        let finalError: string | undefined;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const latestTask = taskStore().get(taskId);
          if (!latestTask) return;
          if (latestTask.cancelRequested) {
            finalStatus = 'cancelled';
            break;
          }

          const child = await createGeminiWebImageTask({
            workflow,
            vars,
            prompt: run.prompt,
            autoCloseTab: fresh.autoCloseTab,
          });
          updateRun(taskId, index, { taskId: child.id, attempts: attempt, status: 'running' });

          while (true) {
            const latest = taskStore().get(taskId);
            if (!latest) return;
            if (latest.cancelRequested) {
              cancelGeminiWebImageTask(child.id);
            }

            const childTask = getGeminiWebImageTask(child.id);
            if (!childTask) {
              await new Promise((resolve) => setTimeout(resolve, 1200));
              continue;
            }
            if (!isTerminal(childTask.status)) {
              await new Promise((resolve) => setTimeout(resolve, 1200));
              continue;
            }

            if (childTask.status === 'success') {
              const imageUrls = childTask.result?.imageUrls ?? [];
              if (imageUrls.length > 0) {
                finalStatus = 'success';
                finalImageUrls = imageUrls;
                finalError = undefined;
              } else {
                finalStatus = 'failed';
                finalImageUrls = [];
                finalError = '任务完成但未返回图片 URL';
              }
            } else if (childTask.status === 'cancelled') {
              finalStatus = 'cancelled';
              finalImageUrls = [];
              finalError = undefined;
            } else {
              finalStatus = 'failed';
              finalImageUrls = childTask.result?.imageUrls ?? [];
              finalError = childTask.error || '子任务失败';
            }
            break;
          }

          if (finalStatus === 'success' || finalStatus === 'cancelled') {
            break;
          }
        }

        updateRun(taskId, index, {
          status: finalStatus,
          imageUrls: finalImageUrls,
          error: finalStatus === 'failed' ? finalError : undefined,
          endedAt: new Date().toISOString(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateRun(taskId, index, {
          status: 'failed',
          imageUrls: [],
          error: message,
          endedAt: new Date().toISOString(),
        });
      }
    }
  };

  const workers = Array.from({ length: Math.min(task.maxConcurrency, task.runs.length) }, () => worker());
  await Promise.all(workers);

  const final = taskStore().get(taskId);
  if (!final) return;
  const summary = computeSummary(final.runs);
  const endedAt = new Date().toISOString();

  if (final.cancelRequested) {
    const remaining = final.runs.map((item) =>
      item.status === 'queued' || item.status === 'running'
        ? { ...item, status: 'cancelled' as const, endedAt: item.endedAt || endedAt }
        : item
    );
    updateTask(taskId, {
      status: 'cancelled',
      endedAt,
      cacheUntil: new Date(Date.now() + TASK_CACHE_TTL_MS).toISOString(),
      runs: remaining,
      summary: computeSummary(remaining),
    });
    return;
  }

  const nextStatus: BatchStatus = summary.failed > 0 ? 'failed' : 'success';
  updateTask(taskId, {
    status: nextStatus,
    endedAt,
    cacheUntil: new Date(Date.now() + TASK_CACHE_TTL_MS).toISOString(),
    summary,
  });
}

export async function createGeminiAdsBatchTask(input: {
  runs: BatchRunInput[];
  workflowId?: string;
  promptVarName?: string;
  maxConcurrency?: number;
  maxAttemptsPerRun?: number;
  autoCloseTab?: boolean;
}) {
  const runs = input.runs
    .map((item) => ({
      browserInstanceId: String(item.browserInstanceId || '').trim(),
      prompt: String(item.prompt || '').trim(),
      browserWsUrl: String(item.browserWsUrl || '').trim(),
    }))
    .filter((item) => item.browserInstanceId && item.prompt);

  if (runs.length === 0) {
    throw new Error('runs 不能为空，且每组必须包含 browserInstanceId 和 prompt');
  }

  const workflow = await resolveAdsWorkflow(input.workflowId);
  if (!workflow) {
    throw new Error('未找到 Ads 工作流，请传 workflowId 或确保存在 gemini流程管理-ads');
  }
  if (!isAdsWorkflow(workflow)) {
    throw new Error('所选 workflow 不是 Ads 工作流（缺少 useAdsPower 导航节点）');
  }

  const promptVarName = pickPromptVarName(workflow, input.promptVarName);
  const maxConcurrency = Math.max(1, Math.min(6, Number(input.maxConcurrency ?? runs.length) || runs.length));
  const maxAttemptsPerRun = Math.max(1, Math.min(5, Number(input.maxAttemptsPerRun ?? 1) || 1));
  const taskId = randomUUID();
  const now = new Date().toISOString();
  const runStates: BatchRunState[] = runs.map((item, index) => ({
    index,
    browserInstanceId: item.browserInstanceId,
    prompt: item.prompt,
    browserWsUrl: item.browserWsUrl,
    status: 'queued',
    attempts: 0,
    imageUrls: [],
  }));

  const task: GeminiAdsBatchTask = {
    id: taskId,
    status: 'queued',
    createdAt: now,
    cancelRequested: false,
    workflowId: workflow.id,
    workflowName: workflow.name,
    promptVarName,
    maxConcurrency,
    maxAttemptsPerRun,
    // Ads 批量任务默认不自动关 tab，避免分身退回 Inactive。
    autoCloseTab: input.autoCloseTab === true,
    runs: runStates,
    summary: computeSummary(runStates),
  };
  taskStore().set(taskId, task);
  persistTask(task);

  setTimeout(() => {
    runBatchTask(taskId).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      const current = taskStore().get(taskId);
      if (!current) return;
      const runsWithFail = current.runs.map((item) =>
        item.status === 'queued' || item.status === 'running'
          ? { ...item, status: 'failed' as const, error: message, endedAt: new Date().toISOString() }
          : item
      );
      updateTask(taskId, {
        status: 'failed',
        endedAt: new Date().toISOString(),
        cacheUntil: new Date(Date.now() + TASK_CACHE_TTL_MS).toISOString(),
        runs: runsWithFail,
        summary: computeSummary(runsWithFail),
      });
    });
  }, 0);

  return task;
}

export function getGeminiAdsBatchTask(taskId: string) {
  const mem = taskStore().get(taskId);
  if (mem) {
    if (isTaskExpired(mem)) {
      taskStore().delete(taskId);
      removePersistedTask(taskId);
      return undefined;
    }
    return mem;
  }
  const persisted = loadPersistedTask(taskId);
  if (!persisted) return undefined;
  if (isTaskExpired(persisted)) {
    removePersistedTask(taskId);
    return undefined;
  }
  taskStore().set(taskId, persisted);
  return persisted;
}

export function cancelGeminiAdsBatchTask(taskId: string) {
  const task = getGeminiAdsBatchTask(taskId);
  if (!task) return undefined;
  if (isTerminal(task.status)) return task;
  const updated = updateTask(taskId, { cancelRequested: true });
  return updated;
}
