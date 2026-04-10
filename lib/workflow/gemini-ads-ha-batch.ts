import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  cancelGeminiAdsBatchTask,
  createGeminiAdsBatchTask,
  getGeminiAdsBatchTask,
} from './gemini-ads-batch';

type HaTaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
type HaItemStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

interface HaSettings {
  instanceIds: string[];
  maxConcurrency: number;
  maxAttemptsPerPrompt: number;
  pollIntervalMs: number;
  runTimeoutMs: number;
  workflowId?: string;
  promptVarName?: string;
  autoCloseTab?: boolean;
}

interface HaItem {
  id: string;
  index: number;
  prompt: string;
  status: HaItemStatus;
  attempts: number;
  browserInstanceId?: string;
  imageUrls: string[];
  error?: string;
  startedAt?: string;
  endedAt?: string;
  batchTaskId?: string;
  childTaskId?: string;
}

interface HaSummary {
  total: number;
  pending: number;
  running: number;
  success: number;
  failed: number;
  cancelled: number;
}

export interface GeminiAdsHaBatchTask {
  id: string;
  status: HaTaskStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  cancelRequested: boolean;
  cacheUntil?: string;
  settings: HaSettings;
  summary: HaSummary;
  prompts: string[];
  items: HaItem[];
}

declare global {
  var __geminiAdsHaBatchTasks: Map<string, GeminiAdsHaBatchTask> | undefined;
}

function taskStore() {
  if (!global.__geminiAdsHaBatchTasks) {
    global.__geminiAdsHaBatchTasks = new Map();
  }
  return global.__geminiAdsHaBatchTasks;
}

const TASK_CACHE_TTL_MS = Number(process.env.GEMINI_ADS_HA_TASK_CACHE_TTL_MS || 10 * 60 * 1000);
const TASK_CACHE_DIR = path.join(os.tmpdir(), 'gemini-ads-ha-task-cache');

function cacheFile(taskId: string) {
  return path.join(TASK_CACHE_DIR, `${taskId}.json`);
}

function persistTask(task: GeminiAdsHaBatchTask) {
  try {
    fs.mkdirSync(TASK_CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile(task.id), JSON.stringify(task), 'utf8');
  } catch {
    // ignore disk cache failure
  }
}

function loadPersistedTask(taskId: string): GeminiAdsHaBatchTask | undefined {
  try {
    const file = cacheFile(taskId);
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as GeminiAdsHaBatchTask;
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

function isTaskExpired(task: GeminiAdsHaBatchTask) {
  if (!task.cacheUntil) return false;
  const expiresAt = Date.parse(task.cacheUntil);
  if (!Number.isFinite(expiresAt)) return false;
  return Date.now() > expiresAt;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeSummary(items: HaItem[]): HaSummary {
  return {
    total: items.length,
    pending: items.filter((item) => item.status === 'pending').length,
    running: items.filter((item) => item.status === 'running').length,
    success: items.filter((item) => item.status === 'success').length,
    failed: items.filter((item) => item.status === 'failed').length,
    cancelled: items.filter((item) => item.status === 'cancelled').length,
  };
}

function updateTask(taskId: string, patch: Partial<GeminiAdsHaBatchTask>) {
  const current = taskStore().get(taskId);
  if (!current) return undefined;
  const next = { ...current, ...patch };
  taskStore().set(taskId, next);
  persistTask(next);
  return next;
}

function updateItems(taskId: string, updater: (items: HaItem[]) => HaItem[]) {
  const current = taskStore().get(taskId);
  if (!current) return undefined;
  const items = updater(current.items);
  const next = {
    ...current,
    items,
    summary: computeSummary(items),
  };
  taskStore().set(taskId, next);
  persistTask(next);
  return next;
}

function isTerminal(status: string) {
  return status === 'success' || status === 'failed' || status === 'cancelled';
}

async function runHaTask(taskId: string) {
  const task = taskStore().get(taskId);
  if (!task) return;
  updateTask(taskId, { status: 'running', startedAt: new Date().toISOString() });

  while (true) {
    const current = taskStore().get(taskId);
    if (!current) return;
    if (current.cancelRequested) break;

    const candidates = current.items.filter(
      (item) => item.status === 'pending' && item.attempts < current.settings.maxAttemptsPerPrompt
    );
    if (candidates.length === 0) break;

    const groupSize = Math.min(
      candidates.length,
      current.settings.instanceIds.length,
      current.settings.maxConcurrency
    );
    const picked = candidates.slice(0, groupSize);
    const batchRuns = picked.map((item, idx) => ({
      browserInstanceId: current.settings.instanceIds[idx % current.settings.instanceIds.length] || '',
      prompt: item.prompt,
      browserWsUrl: '',
    }));
    const pickedRunById = new Map(picked.map((item, idx) => [item.id, batchRuns[idx]]));

    const pickedIds = new Set(picked.map((item) => item.id));
    updateItems(taskId, (items) =>
      items.map((item) => {
        if (!pickedIds.has(item.id)) return item;
        const run = pickedRunById.get(item.id);
        return {
          ...item,
          status: 'running',
          attempts: item.attempts + 1,
          browserInstanceId: run?.browserInstanceId || item.browserInstanceId,
          startedAt: item.startedAt || new Date().toISOString(),
          error: undefined,
        };
      })
    );

    const batch = await createGeminiAdsBatchTask({
      runs: batchRuns,
      maxConcurrency: groupSize,
      workflowId: current.settings.workflowId,
      promptVarName: current.settings.promptVarName,
      autoCloseTab: current.settings.autoCloseTab,
    });

    updateItems(taskId, (items) =>
      items.map((item) => {
        const idx = picked.findIndex((p) => p.id === item.id);
        if (idx < 0) return item;
        return { ...item, batchTaskId: batch.id };
      })
    );

    const started = Date.now();
    let timeoutReached = false;
    while (true) {
      const latest = taskStore().get(taskId);
      if (!latest) return;
      if (latest.cancelRequested) {
        cancelGeminiAdsBatchTask(batch.id);
      }

      const wave = getGeminiAdsBatchTask(batch.id);
      if (!wave) {
        await sleep(latest.settings.pollIntervalMs);
        if (Date.now() - started > latest.settings.runTimeoutMs) {
          timeoutReached = true;
          break;
        }
        continue;
      }

      if (isTerminal(wave.status)) {
        const doneAt = new Date().toISOString();
        updateItems(taskId, (items) =>
          items.map((item) => {
            const idx = picked.findIndex((p) => p.id === item.id);
            if (idx < 0) return item;
            const run = wave.runs[idx];
            const imageUrls = run?.imageUrls ?? [];
            if (run?.status === 'success' && imageUrls.length > 0) {
              return {
                ...item,
                status: 'success',
                imageUrls,
                childTaskId: run.taskId,
                error: undefined,
                endedAt: doneAt,
              };
            }
            const exhausted = item.attempts >= latest.settings.maxAttemptsPerPrompt;
            return {
              ...item,
              status: exhausted ? 'failed' : 'pending',
              imageUrls: imageUrls.length > 0 ? imageUrls : item.imageUrls,
              childTaskId: run?.taskId || item.childTaskId,
              error: run?.error || (imageUrls.length === 0 ? '任务未返回图片 URL' : '子任务失败'),
              endedAt: exhausted ? doneAt : undefined,
            };
          })
        );
        break;
      }

      if (Date.now() - started > latest.settings.runTimeoutMs) {
        timeoutReached = true;
        break;
      }
      await sleep(latest.settings.pollIntervalMs);
    }

    if (timeoutReached) {
      cancelGeminiAdsBatchTask(batch.id);
      updateItems(taskId, (items) =>
        items.map((item) => {
          const matched = pickedIds.has(item.id);
          if (!matched) return item;
          const exhausted = item.attempts >= current.settings.maxAttemptsPerPrompt;
          return {
            ...item,
            status: exhausted ? 'failed' : 'pending',
            error: `批次超时（>${Math.floor(current.settings.runTimeoutMs / 1000)}s）`,
            endedAt: exhausted ? new Date().toISOString() : undefined,
          };
        })
      );
    }
  }

  const final = taskStore().get(taskId);
  if (!final) return;
  const endedAt = new Date().toISOString();

  if (final.cancelRequested) {
    const cancelledItems = final.items.map((item) =>
      item.status === 'success' || item.status === 'failed'
        ? item
        : { ...item, status: 'cancelled' as const, endedAt: item.endedAt || endedAt }
    );
    updateTask(taskId, {
      status: 'cancelled',
      endedAt,
      cacheUntil: new Date(Date.now() + TASK_CACHE_TTL_MS).toISOString(),
      items: cancelledItems,
      summary: computeSummary(cancelledItems),
    });
    return;
  }

  const settledItems = final.items.map((item) => {
    if (item.status === 'pending' || item.status === 'running') {
      return {
        ...item,
        status: 'failed' as const,
        error: item.error || '达到最大重试次数仍未成功',
        endedAt: item.endedAt || endedAt,
      };
    }
    return item;
  });
  const summary = computeSummary(settledItems);
  updateTask(taskId, {
    status: summary.success === summary.total ? 'success' : 'failed',
    endedAt,
    cacheUntil: new Date(Date.now() + TASK_CACHE_TTL_MS).toISOString(),
    items: settledItems,
    summary,
  });
}

export async function createGeminiAdsHaBatchTask(input: {
  prompts: string[];
  instanceIds?: string[];
  workflowId?: string;
  promptVarName?: string;
  maxConcurrency?: number;
  maxAttemptsPerPrompt?: number;
  runTimeoutMs?: number;
  pollIntervalMs?: number;
  autoCloseTab?: boolean;
}) {
  const prompts = input.prompts
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (prompts.length === 0) {
    throw new Error('prompts 不能为空');
  }

  const instanceIds = (input.instanceIds || ['k1b908rw', 'k1bc2kj2', 'k1bc2kja'])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (instanceIds.length === 0) {
    throw new Error('instanceIds 不能为空');
  }

  const maxConcurrency = Math.max(1, Math.min(6, Number(input.maxConcurrency ?? instanceIds.length) || instanceIds.length));
  const maxAttemptsPerPrompt = Math.max(1, Math.min(10, Number(input.maxAttemptsPerPrompt ?? 4) || 4));
  const runTimeoutMs = Math.max(60_000, Number(input.runTimeoutMs ?? 8 * 60 * 1000) || 8 * 60 * 1000);
  const pollIntervalMs = Math.max(800, Number(input.pollIntervalMs ?? 2000) || 2000);

  const now = new Date().toISOString();
  const taskId = randomUUID();
  const items: HaItem[] = prompts.map((prompt, index) => ({
    id: `${taskId}-${index + 1}`,
    index,
    prompt,
    status: 'pending',
    attempts: 0,
    imageUrls: [],
  }));

  const task: GeminiAdsHaBatchTask = {
    id: taskId,
    status: 'queued',
    createdAt: now,
    cancelRequested: false,
    settings: {
      instanceIds,
      maxConcurrency,
      maxAttemptsPerPrompt,
      pollIntervalMs,
      runTimeoutMs,
      workflowId: input.workflowId,
      promptVarName: input.promptVarName,
      autoCloseTab: input.autoCloseTab === true,
    },
    summary: computeSummary(items),
    prompts,
    items,
  };
  taskStore().set(taskId, task);
  persistTask(task);

  setTimeout(() => {
    runHaTask(taskId).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      const current = taskStore().get(taskId);
      if (!current) return;
      const failedItems = current.items.map((item) =>
        item.status === 'success' || item.status === 'failed'
          ? item
          : { ...item, status: 'failed' as const, error: message, endedAt: new Date().toISOString() }
      );
      updateTask(taskId, {
        status: 'failed',
        endedAt: new Date().toISOString(),
        cacheUntil: new Date(Date.now() + TASK_CACHE_TTL_MS).toISOString(),
        items: failedItems,
        summary: computeSummary(failedItems),
      });
    });
  }, 0);

  return task;
}

export function getGeminiAdsHaBatchTask(taskId: string) {
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

export function cancelGeminiAdsHaBatchTask(taskId: string) {
  const task = getGeminiAdsHaBatchTask(taskId);
  if (!task) return undefined;
  if (isTerminal(task.status)) return task;
  return updateTask(taskId, { cancelRequested: true });
}
