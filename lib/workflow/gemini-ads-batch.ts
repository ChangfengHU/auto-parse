import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getWorkflow, listWorkflows } from './workflow-db';
import type { WorkflowDef } from './types';
import {
  appendTaskTrace,
  pruneTaskTraces,
  taskTraceFile,
  taskTraceFileRelative,
  type TaskTracePayload,
} from './task-trace';
import {
  collectWorkflowTaskArtifacts,
  getWorkflowTask,
  startWorkflowTask,
  stopWorkflowTask,
} from './workflow-task-cli';

type BatchStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
type BatchRunStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

interface BatchRunInput {
  browserInstanceId: string;
  prompt: string;
  browserWsUrl?: string;
  sourceImageUrls?: string[] | string;
}

interface BatchRunState extends BatchRunInput {
  index: number;
  status: BatchRunStatus;
  attempts: number;
  taskId?: string;
  mediaUrls: string[];
  imageUrls: string[];
  primaryMediaType?: 'image' | 'video' | 'unknown';
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
  traceFile?: string;
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

const TRACE_NAMESPACE = 'gemini-ads-batch';

function trace(taskId: string, event: string, payload: TaskTracePayload = {}) {
  appendTaskTrace(TRACE_NAMESPACE, taskId, event, payload);
}

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

function normalizeSourceImageUrls(value: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const pushToken = (token: string) => {
    const trimmed = token.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };

  const visit = (input: unknown) => {
    if (Array.isArray(input)) {
      for (const item of input) visit(item);
      return;
    }

    const text = String(input || '').trim();
    if (!text) return;

    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          visit(parsed);
          return;
        }
      } catch {
        // fall through to split mode
      }
    }

    for (const token of text.split(/[\n,]/)) {
      pushToken(token);
    }
  };

  visit(value);
  return out;
}

function buildRunVars(input: {
  promptVarName: string;
  run: BatchRunInput;
}) {
  const prompt = input.run.prompt.trim();
  const sourceImageUrls = normalizeSourceImageUrls(input.run.sourceImageUrls);
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
    sourceImageUrl: sourceImageUrls[0] || '',
    sourceImageUrls: JSON.stringify(sourceImageUrls),
    imageUrl: sourceImageUrls[0] || '',
    imageUrls: JSON.stringify(sourceImageUrls),
  } as Record<string, string>;
}

function filterReferenceMediaUrls(urls: string[], sourceImageUrls: string[]): string[] {
  if (!Array.isArray(urls) || urls.length === 0) return [];
  const blocked = new Set((sourceImageUrls || []).map((item) => String(item || '').trim()).filter(Boolean));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const url = String(raw || '').trim();
    if (!url || blocked.has(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function parseUrlTokens(input: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const url = String(value || '').trim();
    if (!url || seen.has(url)) return;
    if (!/^https?:\/\//i.test(url)) return;
    seen.add(url);
    out.push(url);
  };
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const text = String(value || '').trim();
    if (!text) return;
    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          visit(parsed);
          return;
        }
      } catch {
        // fall through
      }
    }
    for (const token of text.split(/[\n,]/)) {
      push(token);
    }
  };
  visit(input);
  return out;
}

function collectMediaCandidates(result?: {
  mediaUrls?: string[];
  imageUrls?: string[];
  primaryMediaUrl?: string | null;
  primaryImageUrl?: string | null;
  outputs?: Record<string, unknown>;
  vars?: Record<string, string>;
}) {
  const media = new Set<string>();
  const image = new Set<string>();
  const addMedia = (value: unknown) => {
    for (const url of parseUrlTokens(value)) media.add(url);
  };
  const addImage = (value: unknown) => {
    for (const url of parseUrlTokens(value)) {
      image.add(url);
      media.add(url);
    }
  };

  addMedia(result?.mediaUrls);
  addImage(result?.imageUrls);
  addMedia(result?.primaryMediaUrl ?? '');
  addImage(result?.primaryImageUrl ?? '');

  const outputValues = Object.values(result?.outputs ?? {});
  for (const value of outputValues) addMedia(value);

  const vars = result?.vars ?? {};
  addMedia(vars.mediaUrl);
  addImage(vars.imageUrl);
  addMedia(vars.primaryMediaUrl);
  addImage(vars.primaryImageUrl);
  addMedia(vars.mediaUrls);
  addImage(vars.imageUrls);

  return {
    mediaUrls: Array.from(media),
    imageUrls: Array.from(image),
  };
}

function isTerminal(status: string) {
  return status === 'success' || status === 'failed' || status === 'cancelled';
}

function isWorkflowTaskTerminal(status: string) {
  return status === 'done' || status === 'error' || status === 'stopped';
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

  const startedAt = new Date().toISOString();
  updateTask(taskId, { status: 'running', startedAt });
  trace(taskId, 'task_started', { startedAt });
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
      updateRun(taskId, index, { status: 'running', startedAt, error: undefined, endedAt: undefined, mediaUrls: [], imageUrls: [] });
      trace(taskId, 'run_started', { index, browserInstanceId: run.browserInstanceId, prompt: run.prompt, startedAt });

      try {
        const vars = buildRunVars({
          promptVarName: fresh.promptVarName,
          run,
        });
        const maxAttempts = Math.max(1, fresh.maxAttemptsPerRun || 1);
        let finalStatus: BatchRunStatus = 'failed';
        let finalMediaUrls: string[] = [];
        let finalImageUrls: string[] = [];
        let finalPrimaryMediaType: BatchRunState['primaryMediaType'];
        let finalError: string | undefined;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const latestTask = taskStore().get(taskId);
          if (!latestTask) return;
          if (latestTask.cancelRequested) {
            finalStatus = 'cancelled';
            break;
          }

          const child = await startWorkflowTask({
            workflowId: workflow.id,
            workflow,
            vars,
          });
          updateRun(taskId, index, { taskId: child.id, attempts: attempt, status: 'running' });
          trace(taskId, 'child_task_created', { index, attempt, childTaskId: child.id, browserInstanceId: run.browserInstanceId });

          while (true) {
            const latest = taskStore().get(taskId);
            if (!latest) return;
            if (latest.cancelRequested) {
              stopWorkflowTask(child.id, 'batch_cancelled');
            }

            const childTask = getWorkflowTask(child.id);
            if (!childTask) {
              await new Promise((resolve) => setTimeout(resolve, 1200));
              continue;
            }
            if (!isWorkflowTaskTerminal(childTask.status)) {
              await new Promise((resolve) => setTimeout(resolve, 1200));
              continue;
            }

            if (childTask.status === 'done') {
              const artifacts = collectWorkflowTaskArtifacts(child.id);
              const candidate = collectMediaCandidates(artifacts ?? undefined);
              const mediaUrls = filterReferenceMediaUrls(
                candidate.mediaUrls,
                run.sourceImageUrls ? normalizeSourceImageUrls(run.sourceImageUrls) : []
              );
              const imageUrls = filterReferenceMediaUrls(
                candidate.imageUrls,
                run.sourceImageUrls ? normalizeSourceImageUrls(run.sourceImageUrls) : []
              );
              if (mediaUrls.length > 0) {
                finalStatus = 'success';
                finalMediaUrls = mediaUrls;
                finalImageUrls = imageUrls;
                finalPrimaryMediaType = artifacts?.primaryMediaType;
                finalError = undefined;
              } else {
                finalStatus = 'failed';
                finalMediaUrls = [];
                finalImageUrls = [];
                finalPrimaryMediaType = undefined;
                finalError = '任务完成但未返回媒体 URL';
              }
            } else if (childTask.status === 'stopped') {
              finalStatus = 'cancelled';
              finalMediaUrls = [];
              finalImageUrls = [];
              finalPrimaryMediaType = undefined;
              finalError = undefined;
            } else {
              const artifacts = collectWorkflowTaskArtifacts(child.id);
              const candidate = collectMediaCandidates(artifacts ?? undefined);
              const filteredMediaUrls = filterReferenceMediaUrls(
                candidate.mediaUrls,
                run.sourceImageUrls ? normalizeSourceImageUrls(run.sourceImageUrls) : []
              );
              const filteredImageUrls = filterReferenceMediaUrls(
                candidate.imageUrls,
                run.sourceImageUrls ? normalizeSourceImageUrls(run.sourceImageUrls) : []
              );
              finalStatus = 'failed';
              finalMediaUrls = filteredMediaUrls;
              finalImageUrls = filteredImageUrls;
              finalPrimaryMediaType = artifacts?.primaryMediaType;
              finalError = childTask.errorMessage || '子任务失败';
            }
            break;
          }

          if (finalStatus === 'failed' && finalError && finalError.includes('FAIL_FAST:')) {
            trace(taskId, 'child_task_fail_fast', { index, attempt, error: finalError });
            break;
          }

          if (finalStatus === 'success' || finalStatus === 'cancelled') {
            break;
          }
        }

        const runEndedAt = new Date().toISOString();
        trace(taskId, 'run_settled', {
          index,
          browserInstanceId: run.browserInstanceId,
          prompt: run.prompt,
          status: finalStatus,
          attempts: Math.max(1, Math.min(fresh.maxAttemptsPerRun || 1, Number(fresh.runs[index]?.attempts || 0) || 0)),
          mediaUrl: finalMediaUrls[0] || null,
          imageUrl: finalImageUrls[0] || null,
          error: finalStatus === 'failed' ? finalError : undefined,
          endedAt: runEndedAt,
        });

        if (finalStatus === 'success' && (finalMediaUrls[0] || finalImageUrls[0])) {
          const primary = finalMediaUrls[0] || finalImageUrls[0];
          const latest = taskStore().get(taskId);
          const dup = latest?.runs.find((r) => r.index !== index && (r.mediaUrls?.[0] === primary || r.imageUrls?.[0] === primary));
          if (dup) {
            trace(taskId, 'duplicate_primary_media_detected', {
              primary,
              currentIndex: index,
              currentPrompt: run.prompt,
              previousIndex: dup.index,
              previousPrompt: dup.prompt,
            });
          }
        }

        updateRun(taskId, index, {
          status: finalStatus,
          mediaUrls: finalMediaUrls,
          imageUrls: finalImageUrls,
          primaryMediaType: finalPrimaryMediaType,
          error: finalStatus === 'failed' ? finalError : undefined,
          endedAt: runEndedAt,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        trace(taskId, 'run_exception', { index, browserInstanceId: run.browserInstanceId, prompt: run.prompt, error: message });
        updateRun(taskId, index, {
          status: 'failed',
          mediaUrls: [],
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
    const summary = computeSummary(remaining);
    updateTask(taskId, {
      status: 'cancelled',
      endedAt,
      cacheUntil: new Date(Date.now() + TASK_CACHE_TTL_MS).toISOString(),
      runs: remaining,
      summary,
    });
    trace(taskId, 'task_finalized', { status: 'cancelled', endedAt, summary });
    return;
  }

  const nextStatus: BatchStatus = summary.failed > 0 ? 'failed' : 'success';
  updateTask(taskId, {
    status: nextStatus,
    endedAt,
    cacheUntil: new Date(Date.now() + TASK_CACHE_TTL_MS).toISOString(),
    summary,
  });
  trace(taskId, 'task_finalized', { status: nextStatus, endedAt, summary });
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
      sourceImageUrls: normalizeSourceImageUrls(item.sourceImageUrls),
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

  pruneTaskTraces(TRACE_NAMESPACE);
  const traceFile = taskTraceFileRelative(taskTraceFile(TRACE_NAMESPACE, taskId));

  const runStates: BatchRunState[] = runs.map((item, index) => ({
    index,
    browserInstanceId: item.browserInstanceId,
    prompt: item.prompt,
    browserWsUrl: item.browserWsUrl,
    sourceImageUrls: item.sourceImageUrls,
    status: 'queued',
    attempts: 0,
    mediaUrls: [],
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
    traceFile,
  };
  taskStore().set(taskId, task);
  persistTask(task);

  trace(taskId, 'task_created', {
    status: task.status,
    workflowId: task.workflowId,
    workflowName: task.workflowName,
    promptVarName: task.promptVarName,
    maxConcurrency: task.maxConcurrency,
    maxAttemptsPerRun: task.maxAttemptsPerRun,
    runs: task.runs.map((r) => ({
      index: r.index,
      browserInstanceId: r.browserInstanceId,
      prompt: r.prompt,
      sourceImageUrls: r.sourceImageUrls,
    })),
  });

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
  if (updated) {
    trace(taskId, 'cancel_requested', { status: task.status });
    for (const run of updated.runs) {
      if (run.status === 'running' && run.taskId) {
        stopWorkflowTask(run.taskId, 'batch_cancelled');
      }
    }
  }
  return updated;
}
