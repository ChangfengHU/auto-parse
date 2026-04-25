import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  acquireInstanceLease,
  getDispatchableInstanceStatus,
  listDispatchableInstanceStatuses,
  releaseInstanceLease,
  type InstanceStatus,
} from '@/lib/ads-instance-pool';
import {
  collectWorkflowTaskArtifacts,
  forceStopWorkflowTask,
  getWorkflowTask,
  startWorkflowTask,
  stopWorkflowTask,
} from '@/lib/workflow/workflow-task-cli';
import {
  appendTaskTrace,
  pruneTaskTraces,
  taskTraceFile,
  taskTraceFileRelative,
  type TaskTracePayload,
} from './task-trace';
import { getRuntimeBackendConfigSync } from '@/lib/runtime/backend-config';

type DispatcherStatus = 'queued' | 'running' | 'paused' | 'success' | 'failed' | 'cancelled';
type DispatcherItemStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
type DispatcherInstanceState = 'idle' | 'running' | 'inactive' | 'busy';
type DispatcherFailureCategory =
  | 'fast_fail'
  | 'policy_blocked'
  | 'timeout'
  | 'child_create_failed'
  | 'no_media'
  | 'network'
  | 'unknown';

interface DispatcherSummary {
  total: number;
  pending: number;
  running: number;
  success: number;
  failed: number;
  cancelled: number;
}

interface DispatcherMetrics {
  totalAssignments: number;
  totalCompletions: number;
  idleCyclesWithoutAssignment: number;
}

interface DispatcherPreflight {
  requestedPromptCount: number;
  acceptedPromptCount: number;
  totalInstances: number;
  idleInstances: number;
  busyInstances: number;
  inactiveInstances: number;
  willWaitForCapacity: boolean;
}

interface DispatcherSettings {
  instanceIds: string[];
  workflowId?: string;
  promptVarName?: string;
  maxAttemptsPerPrompt: number;
  pollIntervalMs: number;
  childTaskTimeoutMs: number;
  dispatcherTimeoutMs: number;
  maxIdleCyclesWithoutAssignment: number;
  instanceCooldownMs: number;
  failureCooldownThreshold: number;
  autoCloseTab: boolean;

  /** 当某个 item 失败且准备重试时，是否先用 LLM 改写 prompt 再重试（避免原样重试无意义） */
  optimizePromptOnRetry: boolean;
  /** 提示词改写模型（Gemini API models/<name>），例如 gemini-2.5-flash */
  promptOptimizationModel: string;
  /** 提示词改写超时（ms） */
  promptOptimizationTimeoutMs: number;
  /** 每个 item 最多允许改写 prompt 的次数（默认 1） */
  maxPromptOptimizationsPerItem: number;
}

export interface GeminiAdsDispatcherItem {
  id: string;
  index: number;
  /** 当前将要执行的 prompt（可能是重试时被改写后的版本） */
  prompt: string;
  /** 当前 prompt 绑定的参考图 URL 集合，可为空 */
  sourceImageUrls: string[];
  /** prompt 变体历史：第 1 个为原始 prompt，其后为改写版本 */
  promptHistory?: string[];
  /** 已进行过的 prompt 改写次数（便于快速判断） */
  promptOptimizedCount?: number;
  lastPromptOptimizedAt?: string;

  status: DispatcherItemStatus;
  attempts: number;
  browserInstanceId?: string;
  /**
   * 子工作流任务 ID（来自 /api/workflows/tasks 的 taskId）。
   * 为了兼容旧字段名，外层 API 仍可能以 batchTaskId 暴露同一个值。
   */
  workflowTaskId?: string;
  /** 历史所有 workflow task IDs（按尝试顺序，不含当前 workflowTaskId） */
  workflowTaskHistory?: string[];
  mediaUrls: string[];
  imageUrls: string[];
  primaryMediaType?: 'image' | 'video' | 'unknown';
  error?: string;
  failureCategory?: DispatcherFailureCategory;
  attemptHistory?: Array<{
    attempt: number;
    prompt: string;
    browserInstanceId?: string;
    workflowTaskId?: string;
    startedAt?: string;
    endedAt?: string;
    durationMs?: number;
    outcome?: 'running' | 'success' | 'failed' | 'timeout' | 'create_failed' | 'cancelled';
    error?: string;
    failureCategory?: DispatcherFailureCategory;
    rewriteApplied?: boolean;
    rewriteReason?: string;
  }>;
  startedAt?: string;
  endedAt?: string;
}

export interface GeminiAdsDispatcherInstance {
  instanceId: string;
  state: DispatcherInstanceState;
  leaseId?: string;
  currentItemId?: string;
  currentPrompt?: string;
  /** 当前运行中的子工作流 taskId（兼容旧 batchTaskId 语义） */
  workflowTaskId?: string;
  startedAt?: string;
  lastAssignedAt?: string;
  lastReleasedAt?: string;
  lastCompletedItemId?: string;
  lastResultStatus?: Exclude<DispatcherItemStatus, 'pending' | 'running'>;
  lastMediaUrl?: string | null;
  lastMediaType?: 'image' | 'video' | 'unknown';
  lastImageUrl?: string | null;
  lastError?: string;
  detail?: string;
  cooldownUntil?: string;
  consecutiveFailures: number;
  successCount: number;
  failureCount: number;
}

export interface GeminiAdsDispatcherTask {
  id: string;
  status: DispatcherStatus;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;

  cancelRequested: boolean;
  cancelReason?: string;

  suspendRequested?: boolean;
  suspendReason?: string;
  suspendedAt?: string;

  /** 用户主动暂停（与抢占 suspend 不同：暂停后不会自动重新入队） */
  pauseRequested?: boolean;
  pausedAt?: string;
  pauseReason?: string;

  cacheUntil?: string;
  traceFile?: string;
  error?: string;
  warnings: string[];
  preflight: DispatcherPreflight;
  settings: DispatcherSettings;
  summary: DispatcherSummary;
  metrics: DispatcherMetrics;
  prompts: string[];
  items: GeminiAdsDispatcherItem[];
  instances: GeminiAdsDispatcherInstance[];
  lastActivityAt?: string;
}

declare global {
  var __geminiAdsDispatcherTasks: Map<string, GeminiAdsDispatcherTask> | undefined;
  var __geminiAdsDispatcherQueue:
    | {
        entries: Array<{ taskId: string; enqueuedAt: string }>;
        runningTaskId?: string;
        updatedAt: string;
      }
    | undefined;
  var __geminiAdsDispatcherQueueKicking: boolean | undefined;
  var __geminiAdsDispatcherQueueKickPending: boolean | undefined;
}

const DEFAULT_INSTANCE_IDS = ['k1b908rw', 'k1bdaoa7', 'k1ba8vac'];
const TASK_CACHE_TTL_MS = Number(process.env.GEMINI_ADS_DISPATCHER_TASK_CACHE_TTL_MS || 3 * 60 * 60 * 1000);
const { getGeminiAdsDispatcherQueueLockDir, getGeminiAdsDispatcherTaskCacheDir } = require('./gemini-ads-dispatcher-cache') as typeof import('./gemini-ads-dispatcher-cache');
const TASK_CACHE_DIR = getGeminiAdsDispatcherTaskCacheDir();
const DEFAULT_DISPATCHER_TIMEOUT_MS = Number(process.env.GEMINI_ADS_DISPATCHER_TIMEOUT_MS || 45 * 60 * 1000);
const DEFAULT_INSTANCE_COOLDOWN_MS = Number(process.env.GEMINI_ADS_DISPATCHER_INSTANCE_COOLDOWN_MS || 45_000);
const DEFAULT_MAX_IDLE_CYCLES = Number(process.env.GEMINI_ADS_DISPATCHER_MAX_IDLE_CYCLES || 18);
const DEFAULT_FAILURE_COOLDOWN_THRESHOLD = Number(process.env.GEMINI_ADS_DISPATCHER_FAILURE_COOLDOWN_THRESHOLD || 2);

const DEFAULT_OPTIMIZE_PROMPT_ON_RETRY = String(process.env.GEMINI_ADS_DISPATCHER_OPTIMIZE_PROMPT_ON_RETRY || '').toLowerCase() === 'true';
const DEFAULT_PROMPT_OPTIMIZATION_MODEL = String(process.env.GEMINI_ADS_DISPATCHER_PROMPT_OPTIMIZATION_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash';
const DEFAULT_PROMPT_OPTIMIZATION_TIMEOUT_MS = Number(process.env.GEMINI_ADS_DISPATCHER_PROMPT_OPTIMIZATION_TIMEOUT_MS || 8000);
const DEFAULT_MAX_PROMPT_OPTIMIZATIONS_PER_ITEM = Number(process.env.GEMINI_ADS_DISPATCHER_MAX_PROMPT_OPTIMIZATIONS_PER_ITEM || 1);

const TRACE_NAMESPACE = 'gemini-ads-dispatcher';

function taskStore() {
  if (!global.__geminiAdsDispatcherTasks) {
    global.__geminiAdsDispatcherTasks = new Map();
  }
  return global.__geminiAdsDispatcherTasks;
}

function cacheFile(taskId: string) {
  return path.join(TASK_CACHE_DIR, `${taskId}.json`);
}

function persistTask(task: GeminiAdsDispatcherTask) {
  try {
    fs.mkdirSync(TASK_CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile(task.id), JSON.stringify(task), 'utf8');
  } catch {
    // ignore disk cache failure
  }

  try {
    // Best-effort persistence (do not block main workflow)
    const { upsertAdsDispatcherTaskSnapshot } = require('./supabase-task-persist') as typeof import('./supabase-task-persist');
    upsertAdsDispatcherTaskSnapshot({
      ...task,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // ignore
  }
}

function loadPersistedTask(taskId: string): GeminiAdsDispatcherTask | undefined {
  try {
    const file = cacheFile(taskId);
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as GeminiAdsDispatcherTask;
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

function isTaskExpired(task: GeminiAdsDispatcherTask) {
  if (!task.cacheUntil) return false;
  const expiresAt = Date.parse(task.cacheUntil);
  if (!Number.isFinite(expiresAt)) return false;
  return Date.now() > expiresAt;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const QUEUE_FILE = path.join(TASK_CACHE_DIR, 'queue.json');
const QUEUE_LOCK_DIR = getGeminiAdsDispatcherQueueLockDir();

type DispatcherQueueState = {
  entries: Array<{ taskId: string; enqueuedAt: string }>;
  runningTaskId?: string;
  updatedAt: string;
};

export type GeminiAdsDispatcherQueueInfo = {
  maxSize: number;
  size: number;
  runningTaskId?: string;
  state: 'queued' | 'running' | 'none';
  position?: number;
  aheadCount?: number;
};

function queueMaxSize() {
  const configured = getRuntimeBackendConfigSync().adsDispatcher?.maxQueueSize;
  const n = Number(configured);
  if (!Number.isFinite(n)) return 20;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

function queueSize(state: DispatcherQueueState) {
  return state.entries.length + (state.runningTaskId ? 1 : 0);
}

function loadQueueState(): DispatcherQueueState {
  if (global.__geminiAdsDispatcherQueue) return global.__geminiAdsDispatcherQueue;
  try {
    if (!fs.existsSync(QUEUE_FILE)) {
      const fresh: DispatcherQueueState = { entries: [], updatedAt: nowIso() };
      global.__geminiAdsDispatcherQueue = fresh;
      return fresh;
    }
    const raw = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')) as Partial<DispatcherQueueState>;
    const state: DispatcherQueueState = {
      entries: Array.isArray(raw.entries) ? raw.entries.filter(Boolean) : [],
      runningTaskId: typeof raw.runningTaskId === 'string' ? raw.runningTaskId : undefined,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
    };
    global.__geminiAdsDispatcherQueue = state;
    return state;
  } catch {
    const fresh: DispatcherQueueState = { entries: [], updatedAt: nowIso() };
    global.__geminiAdsDispatcherQueue = fresh;
    return fresh;
  }
}

function persistQueueState(next: DispatcherQueueState) {
  try {
    fs.mkdirSync(TASK_CACHE_DIR, { recursive: true });
    global.__geminiAdsDispatcherQueue = next;
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(next), 'utf8');
  } catch {
    global.__geminiAdsDispatcherQueue = next;
  }
}

function normalizeQueueState(state: DispatcherQueueState) {
  const normalized: DispatcherQueueState = {
    ...state,
    entries: state.entries
      .filter((entry) => entry && typeof entry.taskId === 'string')
      .map((entry) => ({ taskId: entry.taskId, enqueuedAt: entry.enqueuedAt || nowIso() })),
    updatedAt: nowIso(),
  };

  // Drop entries that no longer exist or are no longer queued
  normalized.entries = normalized.entries.filter((entry) => {
    const task = getGeminiAdsDispatcherTaskSync(entry.taskId);
    return Boolean(task && task.status === 'queued' && !isTerminal(task.status));
  });

  if (normalized.runningTaskId) {
    const runningTask = getGeminiAdsDispatcherTaskSync(normalized.runningTaskId);
    if (!runningTask || isTerminal(runningTask.status)) {
      normalized.runningTaskId = undefined;
    }
  }

  return normalized;
}

async function withQueueLock<T>(fn: () => Promise<T>, timeoutMs = 2500): Promise<T> {
  const start = Date.now();
  while (true) {
    try {
      fs.mkdirSync(QUEUE_LOCK_DIR);
      break;
    } catch {
      if (Date.now() - start > timeoutMs) {
        throw new Error('队列繁忙，请稍后重试');
      }
      await sleep(50);
    }
  }
  try {
    return await fn();
  } finally {
    try {
      fs.rmdirSync(QUEUE_LOCK_DIR);
    } catch {
      // ignore
    }
  }
}

export function getGeminiAdsDispatcherQueueInfo(taskId: string): GeminiAdsDispatcherQueueInfo {
  const maxSize = queueMaxSize();
  const state = normalizeQueueState(loadQueueState());
  const size = queueSize(state);

  if (state.runningTaskId === taskId) {
    return { maxSize, size, runningTaskId: state.runningTaskId, state: 'running', position: 0, aheadCount: 0 };
  }

  const index = state.entries.findIndex((entry) => entry.taskId === taskId);
  if (index >= 0) {
    return {
      maxSize,
      size,
      runningTaskId: state.runningTaskId,
      state: 'queued',
      position: index + 1,
      aheadCount: index,
    };
  }

  return { maxSize, size, runningTaskId: state.runningTaskId, state: 'none' };
}

export async function clearGeminiAdsDispatcherQueue(options?: { reason?: string; includeRunning?: boolean }) {
  const reason = (options?.reason || 'queue cleared').slice(0, 500);
  const includeRunning = options?.includeRunning === true;
  const clearedTaskIds: string[] = [];

  await withQueueLock(async () => {
    const state = normalizeQueueState(loadQueueState());
    const ids = state.entries.map((entry) => entry.taskId);
    const next: DispatcherQueueState = {
      ...state,
      entries: [],
      runningTaskId: includeRunning ? undefined : state.runningTaskId,
      updatedAt: nowIso(),
    };
    persistQueueState(next);
    clearedTaskIds.push(...ids);
    if (includeRunning && state.runningTaskId) {
      clearedTaskIds.push(state.runningTaskId);
    }
  });

  if (clearedTaskIds.length === 0) {
    return { cleared: 0, taskIds: [] as string[] };
  }

  const endedAt = nowIso();
  for (const taskId of clearedTaskIds) {
    const task = await getGeminiAdsDispatcherTask(taskId);
    if (!task) continue;
    if (isTerminal(task.status)) continue;

    const cancelledItems = task.items.map((item) =>
      item.status === 'success' || item.status === 'failed'
        ? item
        : { ...item, status: 'cancelled' as const, endedAt }
    );

    updateTask(taskId, {
      cancelRequested: true,
      cancelReason: reason,
      status: 'cancelled',
      endedAt,
      cacheUntil: new Date(Date.now() + TASK_CACHE_TTL_MS).toISOString(),
      items: cancelledItems,
      summary: computeSummary(cancelledItems),
    });

    if (task.status === 'running') {
      updateTask(taskId, {
        suspendRequested: true,
        suspendReason: reason,
      });
      void forceStopRunningTaskInstances(taskId, reason);
    }

    trace(taskId, 'queue_cleared', { reason });
  }

  return { cleared: clearedTaskIds.length, taskIds: clearedTaskIds };
}

async function removeFromQueue(taskId: string) {
  await withQueueLock(async () => {
    const state = normalizeQueueState(loadQueueState());
    const next: DispatcherQueueState = {
      ...state,
      entries: state.entries.filter((entry) => entry.taskId !== taskId),
      updatedAt: nowIso(),
    };
    if (next.runningTaskId === taskId) next.runningTaskId = undefined;
    persistQueueState(next);
  });
}

async function enqueueTask(taskId: string, options?: { mode?: 'front' | 'back' }) {
  const mode = options?.mode === 'front' ? 'front' : 'back';

  await withQueueLock(async () => {
    const state = normalizeQueueState(loadQueueState());
    const maxSize = queueMaxSize();
    const size = queueSize(state);
    if (size >= maxSize) {
      throw new Error(`队列已满（${size}/${maxSize}），请稍后重试`);
    }

    if (state.runningTaskId === taskId || state.entries.some((e) => e.taskId === taskId)) {
      return;
    }

    const entry = { taskId, enqueuedAt: nowIso() };
    const next: DispatcherQueueState = {
      ...state,
      entries: mode === 'front' ? [entry, ...state.entries] : [...state.entries, entry],
      updatedAt: nowIso(),
    };
    persistQueueState(next);
  });

  trace(taskId, mode === 'front' ? 'queue_enqueued_front' : 'queue_enqueued', getGeminiAdsDispatcherQueueInfo(taskId));
  void kickQueue();
}

function requestTaskSuspend(taskId: string, reason?: string) {
  const task = taskStore().get(taskId);
  if (!task) return;
  if (task.status !== 'running') return;
  if (task.suspendRequested) return;

  const now = nowIso();
  updateTask(taskId, {
    suspendRequested: true,
    suspendReason: reason || 'force preempt',
    lastActivityAt: now,
  });
  trace(taskId, 'task_suspend_requested', { requestedAt: now, reason: reason || 'force preempt' });
}

async function forceStopRunningTaskInstances(taskId: string, reason?: string) {
  const task = taskStore().get(taskId);
  if (!task) return;
  if (task.status !== 'running') return;

  trace(taskId, 'task_force_stop_instances', { reason: reason || 'force preempt' });

  await Promise.all(
    task.instances.map(async (instance) => {
      if (!instance.workflowTaskId) return;
      const stopped = await forceStopWorkflowTask(instance.workflowTaskId, reason || 'force preempt');
      trace(taskId, 'child_task_force_stopped', {
        instanceId: instance.instanceId,
        workflowTaskId: instance.workflowTaskId,
        status: stopped?.status,
        reason: reason || 'force preempt',
      });
    })
  ).catch((error) => {
    trace(taskId, 'child_task_force_stop_failed', {
      reason: reason || 'force preempt',
      error: error instanceof Error ? error.message : String(error),
    });
  });

  await Promise.all(
    task.instances.map(async (instance) => {
      if (!instance.leaseId) return;
      await releaseInstance(taskId, instance.instanceId, instance.leaseId);
      trace(taskId, 'preempt_instance_released', {
        instanceId: instance.instanceId,
        leaseId: instance.leaseId,
      });
    })
  ).catch(() => null);
}

async function forceDispatchTask(taskId: string, reason?: string) {
  let preemptedTaskId: string | undefined;

  await withQueueLock(async () => {
    const state = normalizeQueueState(loadQueueState());
    const maxSize = queueMaxSize();

    preemptedTaskId = state.runningTaskId;

    const alreadyInQueue = state.entries.some((e) => e.taskId === taskId);
    const alreadyRunning = state.runningTaskId === taskId;
    if (alreadyInQueue || alreadyRunning) {
      const next: DispatcherQueueState = {
        ...state,
        entries: [{ taskId, enqueuedAt: nowIso() }, ...state.entries.filter((e) => e.taskId !== taskId)],
        runningTaskId: undefined,
        updatedAt: nowIso(),
      };
      persistQueueState(next);
      return;
    }

    const nextSize = state.entries.length + 1; // runningTaskId 将被清空以抢占执行
    if (nextSize > maxSize) {
      throw new Error(`队列已满（${queueSize(state)}/${maxSize}），请稍后重试`);
    }

    const next: DispatcherQueueState = {
      ...state,
      entries: [{ taskId, enqueuedAt: nowIso() }, ...state.entries],
      runningTaskId: undefined,
      updatedAt: nowIso(),
    };
    persistQueueState(next);
  });

  trace(taskId, 'queue_force_enqueued', { reason: reason || 'force' });

  if (preemptedTaskId && preemptedTaskId !== taskId) {
    requestTaskSuspend(preemptedTaskId, reason);
    void forceStopRunningTaskInstances(preemptedTaskId, reason);
  }

  void kickQueue();
}

async function onQueueTaskFinished(taskId: string) {
  await withQueueLock(async () => {
    const state = normalizeQueueState(loadQueueState());
    if (state.runningTaskId !== taskId) return;
    const next: DispatcherQueueState = { ...state, runningTaskId: undefined, updatedAt: nowIso() };
    persistQueueState(next);
  }).catch(() => null);

  trace(taskId, 'queue_task_finished', { status: (await getGeminiAdsDispatcherTask(taskId))?.status });
  void kickQueue();
}

async function startQueuedTask(taskId: string) {
  const task = await getGeminiAdsDispatcherTask(taskId);
  if (!task) {
    await onQueueTaskFinished(taskId);
    return;
  }

  if (task.cancelRequested) {
    const endedAt = nowIso();
    const cancelledItems = task.items.map((item) =>
      item.status === 'success' || item.status === 'failed' ? item : { ...item, status: 'cancelled' as const, endedAt }
    );
    updateTask(taskId, {
      status: 'cancelled',
      endedAt,
      cacheUntil: new Date(Date.now() + TASK_CACHE_TTL_MS).toISOString(),
      items: cancelledItems,
      summary: computeSummary(cancelledItems),
    });
    trace(taskId, 'task_cancelled_before_start', { cancelReason: task.cancelReason });
    await onQueueTaskFinished(taskId);
    return;
  }

  trace(taskId, 'queue_task_started', { queue: getGeminiAdsDispatcherQueueInfo(taskId) });

  runDispatcherTask(taskId)
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      const current = taskStore().get(taskId);
      if (!current) return;
      const failedItems = current.items.map((item) =>
        item.status === 'success' || item.status === 'failed'
          ? item
          : { ...item, status: 'failed' as const, error: message, endedAt: nowIso() }
      );
      updateTask(taskId, {
        status: 'failed',
        error: message,
        endedAt: nowIso(),
        cacheUntil: new Date(Date.now() + TASK_CACHE_TTL_MS).toISOString(),
        items: failedItems,
        summary: computeSummary(failedItems),
      });
    })
    .finally(() => {
      void onQueueTaskFinished(taskId);
    });
}

async function kickQueue() {
  if (global.__geminiAdsDispatcherQueueKicking) {
    global.__geminiAdsDispatcherQueueKickPending = true;
    return;
  }
  global.__geminiAdsDispatcherQueueKicking = true;
  try {
    const nextTaskId = await withQueueLock(async () => {
      const state = normalizeQueueState(loadQueueState());

      if (state.runningTaskId) {
        persistQueueState(state);
        return null;
      }

      const head = state.entries[0];
      if (!head) {
        persistQueueState(state);
        return null;
      }

      const next: DispatcherQueueState = {
        ...state,
        runningTaskId: head.taskId,
        entries: state.entries.slice(1),
        updatedAt: nowIso(),
      };
      persistQueueState(next);
      return head.taskId;
    }).catch(() => null);

    if (nextTaskId) {
      trace(nextTaskId, 'queue_dequeued', getGeminiAdsDispatcherQueueInfo(nextTaskId));
      await startQueuedTask(nextTaskId);
    }
  } finally {
    global.__geminiAdsDispatcherQueueKicking = false;
    if (global.__geminiAdsDispatcherQueueKickPending) {
      global.__geminiAdsDispatcherQueueKickPending = false;
      void kickQueue();
    }
  }
}

function nowIso() {
  return new Date().toISOString();
}

function trace(taskId: string, event: string, payload: TaskTracePayload = {}) {
  appendTaskTrace(TRACE_NAMESPACE, taskId, event, payload);
}

function parseTs(value?: string) {
  if (!value) return NaN;
  return Date.parse(value);
}

function computeSummary(items: GeminiAdsDispatcherItem[]): DispatcherSummary {
  return {
    total: items.length,
    pending: items.filter((item) => item.status === 'pending').length,
    running: items.filter((item) => item.status === 'running').length,
    success: items.filter((item) => item.status === 'success').length,
    failed: items.filter((item) => item.status === 'failed').length,
    cancelled: items.filter((item) => item.status === 'cancelled').length,
  };
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

function updateTask(taskId: string, patch: Partial<GeminiAdsDispatcherTask>) {
  const current = taskStore().get(taskId);
  if (!current) return undefined;
  const next = { ...current, ...patch };
  taskStore().set(taskId, next);
  persistTask(next);
  return next;
}

function updateInstances(taskId: string, updater: (instances: GeminiAdsDispatcherInstance[]) => GeminiAdsDispatcherInstance[]) {
  const current = taskStore().get(taskId);
  if (!current) return undefined;
  const instances = updater(current.instances);
  const next = { ...current, instances };
  taskStore().set(taskId, next);
  persistTask(next);
  return next;
}

function updateTaskState(taskId: string, updater: (task: GeminiAdsDispatcherTask) => GeminiAdsDispatcherTask) {
  const current = taskStore().get(taskId);
  if (!current) return undefined;
  const next = updater(current);
  taskStore().set(taskId, next);
  persistTask(next);
  return next;
}

function isTerminal(status: string) {
  return status === 'success' || status === 'failed' || status === 'cancelled';
}

function isWorkflowTaskTerminal(status: string | undefined): boolean {
  return status === 'done' || status === 'error' || status === 'stopped';
}

function buildChildVars(input: {
  promptVarName: string;
  browserInstanceId: string;
  prompt: string;
  sourceImageUrls: string[];
}) {
  const prompt = input.prompt.trim();
  const sourceImageUrls = normalizeSourceImageUrls(input.sourceImageUrls)
    .filter((u) => /^https?:\/\//i.test(u));
  return {
    prompt,
    userPrompt: prompt,
    noteUrl: prompt,
    note_url: prompt,
    text: prompt,
    input: prompt,
    prompts: JSON.stringify([prompt]),
    [input.promptVarName]: prompt,
    browserInstanceId: input.browserInstanceId.trim(),
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

function isInCooldown(instance: GeminiAdsDispatcherInstance, nowMs = Date.now()) {
  if (!instance.cooldownUntil) return false;
  const until = Date.parse(instance.cooldownUntil);
  return Number.isFinite(until) && until > nowMs;
}

function formatDurationMs(ms: number) {
  const seconds = Math.max(1, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes < 60) return remainSeconds > 0 ? `${minutes}m${remainSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes > 0 ? `${hours}h${remainMinutes}m` : `${hours}h`;
}

function toDurationMs(startedAt?: string, endedAt?: string): number | undefined {
  const s = parseTs(startedAt);
  const e = parseTs(endedAt);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return undefined;
  return Math.round(e - s);
}

function parseFailureCategory(message?: string): DispatcherFailureCategory {
  const text = String(message || '').toLowerCase();
  if (!text) return 'unknown';
  if (text.includes('fail_fast:')) return 'fast_fail';
  if (text.includes('超时') || text.includes('timeout')) return 'timeout';
  if (text.includes('子任务创建失败') || text.includes('create_failed')) return 'child_create_failed';
  if (text.includes('任务未返回媒体') || text.includes('未返回媒体')) return 'no_media';
  if (
    text.includes('policy') ||
    text.includes('safety') ||
    text.includes('违规') ||
    text.includes('违禁') ||
    text.includes('not create images of people') ||
    text.includes('depict a real person')
  ) {
    return 'policy_blocked';
  }
  if (text.includes('fetch failed') || text.includes('network') || text.includes('econn') || text.includes('timed out')) {
    return 'network';
  }
  return 'unknown';
}

function isInstanceUnavailableError(message?: string): boolean {
  const text = String(message || '').toLowerCase();
  if (!text) return false;
  return (
    text.includes('未激活') ||
    text.includes('不可用') ||
    text.includes('inactive') ||
    text.includes('not active') ||
    text.includes('adspower 分身未激活')
  );
}

function isDownloadExtractFastFailReason(message?: string): boolean {
  const text = String(message || '');
  return text.includes('FAIL_FAST:') && text.includes('NODE=extract_image_download;');
}

function shouldForceRewrite(
  category: DispatcherFailureCategory,
  settings: DispatcherSettings,
  failureReason?: string
): boolean {
  if (settings.optimizePromptOnRetry) return false;
  if (category !== 'fast_fail') return false;
  return isDownloadExtractFastFailReason(failureReason);
}

function adaptiveChildTimeoutMs(baseMs: number, attempts: number): number {
  // 允许业务通过 childTaskTimeoutMs 控制首轮超时，避免被固定 5 分钟上限误杀。
  const normalizedBase = Math.max(60_000, Math.min(baseMs, 30 * 60_000));
  if (attempts <= 1) return normalizedBase;
  if (attempts === 2) return Math.max(180_000, Math.floor(normalizedBase * 0.8));
  if (attempts === 3) return Math.max(150_000, Math.floor(normalizedBase * 0.65));
  return Math.max(120_000, Math.floor(normalizedBase * 0.5));
}

function appendAttemptHistoryEntry(
  item: GeminiAdsDispatcherItem,
  entry: NonNullable<GeminiAdsDispatcherItem['attemptHistory']>[number]
) {
  const prev = Array.isArray(item.attemptHistory) ? item.attemptHistory : [];
  return [...prev, entry];
}

function patchLatestAttemptHistory(
  item: GeminiAdsDispatcherItem,
  patch: Partial<NonNullable<GeminiAdsDispatcherItem['attemptHistory']>[number]>
) {
  const history = Array.isArray(item.attemptHistory) ? [...item.attemptHistory] : [];
  if (history.length === 0) return history;
  history[history.length - 1] = { ...history[history.length - 1], ...patch };
  return history;
}

function normalizePromptHistory(item: GeminiAdsDispatcherItem): string[] {
  const history = Array.isArray(item.promptHistory)
    ? item.promptHistory.map((p) => String(p || '').trim()).filter(Boolean)
    : [];
  if (history.length === 0) history.push(String(item.prompt || '').trim());
  // 保证最后一个就是当前 prompt
  if (history[history.length - 1] !== item.prompt) {
    history.push(String(item.prompt || '').trim());
  }
  return history;
}

async function optimizePromptViaGemini(input: {
  model: string;
  apiKey: string;
  prompt: string;
  failureHint?: string;
  timeoutMs: number;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const sysPrompt = `你是一个提示词纠错/改写专家，目标是让网页端 Gemini 更稳定地产出【单张静态图片】。
要求：
1) 保留用户原意与细节，但要明确强调：single still image / image only / no video / no animation。
2) 如果用户提到“8k/海报/电影感”等可以保留。
3) 只输出最终的 prompt，不要解释、不要 Markdown。`; 

    const body = {
      contents: [
        {
          parts: [
            {
              text:
                `${sysPrompt}\n\n失败线索（可选）：${input.failureHint || '无'}\n\n用户原 prompt：\n${input.prompt}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 220,
      },
    };

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${input.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gemini prompt optimize failed (${res.status}): ${text || res.statusText}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const out = String(text || '').trim();
    if (!out) throw new Error('Gemini prompt optimize returned empty');
    return out.length > 1200 ? out.slice(0, 1200) : out;
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackOptimizePrompt(prompt: string, failureHint?: string) {
  const base = String(prompt || '').trim();
  if (!base) return base;

  const normalized = base
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n');

  const concise = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^#{1,6}\s/.test(line) && !/^[-*]\s/.test(line))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 900)
    .trim();

  // 发生 fast-fail / policy 类问题时，收敛到更安全、稳定的静态图表达，避免重试继续触发风控。
  const safetyTriggered = /fail_fast|policy|safety|hard|encountered an error|not create images of people|depict a real person/i.test(
    String(failureHint || '')
  );
  const softened = safetyTriggered
    ? concise
        .replace(/feminine curves highlighted/gi, 'fashion silhouette emphasis')
        .replace(/slightly parted lips/gi, 'natural expression')
        .replace(/allure|魅惑/gi, 'editorial style')
    : concise;

  const safetySuffix = safetyTriggered
    ? 'Use an adult, fully clothed, non-sexual fashion portrait. Keep it tasteful and policy-safe.'
    : '';

  return [
    softened,
    safetySuffix,
    'Single still image only (image only), no video, no animation, no GIF. Output PNG.',
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

async function computeRetryPromptWithOptimization(taskId: string, task: GeminiAdsDispatcherTask, item: GeminiAdsDispatcherItem, failureReason: string) {
  const history = normalizePromptHistory(item);
  const optimizedCount = item.promptOptimizedCount ?? Math.max(0, history.length - 1);

  const enabled = Boolean((task.settings as Partial<DispatcherSettings>).optimizePromptOnRetry);
  const maxOptimizations = Number(
    (task.settings as Partial<DispatcherSettings>).maxPromptOptimizationsPerItem ?? DEFAULT_MAX_PROMPT_OPTIMIZATIONS_PER_ITEM
  );
  const model = String(
    (task.settings as Partial<DispatcherSettings>).promptOptimizationModel ?? DEFAULT_PROMPT_OPTIMIZATION_MODEL
  ).trim() || DEFAULT_PROMPT_OPTIMIZATION_MODEL;
  const timeoutMs = Math.max(
    1000,
    Number((task.settings as Partial<DispatcherSettings>).promptOptimizationTimeoutMs ?? DEFAULT_PROMPT_OPTIMIZATION_TIMEOUT_MS) || DEFAULT_PROMPT_OPTIMIZATION_TIMEOUT_MS
  );

  if (!enabled) {
    trace(taskId, 'prompt_optimization_skipped', { itemId: item.id, reason: 'disabled' });
    return { prompt: item.prompt, history, optimizedCount };
  }

  if (optimizedCount >= maxOptimizations) {
    trace(taskId, 'prompt_optimization_skipped', { itemId: item.id, reason: 'limit_reached', optimizedCount, maxOptimizations });
    return { prompt: item.prompt, history, optimizedCount };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    trace(taskId, 'prompt_optimization_failed', { itemId: item.id, reason: 'missing_GEMINI_API_KEY' });
    const next = fallbackOptimizePrompt(item.prompt, failureReason);
    return {
      prompt: next,
      history: [...history, next],
      optimizedCount: optimizedCount + 1,
      usedFallback: true as const,
    };
  }

  try {
    const next = await optimizePromptViaGemini({
      model,
      apiKey,
      prompt: item.prompt,
      failureHint: failureReason,
      timeoutMs,
    });
    trace(taskId, 'prompt_optimized', {
      itemId: item.id,
      from: item.prompt,
      to: next,
      model,
      optimizedCount: optimizedCount + 1,
      failureReason,
    });
    return {
      prompt: next,
      history: [...history, next],
      optimizedCount: optimizedCount + 1,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    trace(taskId, 'prompt_optimization_failed', {
      itemId: item.id,
      reason: message,
      model,
    });
    const next = fallbackOptimizePrompt(item.prompt, failureReason);
    return {
      prompt: next,
      history: [...history, next],
      optimizedCount: optimizedCount + 1,
      usedFallback: true as const,
    };
  }
}

async function computeRetryPromptForFailure(input: {
  taskId: string;
  task: GeminiAdsDispatcherTask;
  item: GeminiAdsDispatcherItem;
  failureReason: string;
  failureCategory: DispatcherFailureCategory;
  forceRewrite?: boolean;
}) {
  const forceRewrite = typeof input.forceRewrite === 'boolean'
    ? input.forceRewrite
    : shouldForceRewrite(input.failureCategory, input.task.settings, input.failureReason);
  const taskForOpt = forceRewrite
    ? { ...input.task, settings: { ...input.task.settings, optimizePromptOnRetry: true } }
    : input.task;
  if (forceRewrite) {
    trace(input.taskId, 'prompt_rewrite_forced', {
      itemId: input.item.id,
      category: input.failureCategory,
      attempts: input.item.attempts,
      reason: input.failureReason,
    });
  }
  const before = input.item.prompt;
  const opt = await computeRetryPromptWithOptimization(input.taskId, taskForOpt, input.item, input.failureReason);
  return {
    prompt: opt.prompt,
    history: opt.history,
    optimizedCount: opt.optimizedCount,
    rewriteApplied: String(opt.prompt || '').trim() !== String(before || '').trim(),
    rewriteForced: forceRewrite,
  };
}

function mapPoolState(state?: InstanceStatus['state']): DispatcherInstanceState {
  if (state === 'inactive') return 'inactive';
  if (state === 'busy') return 'busy';
  return 'idle';
}

function buildWarnings(input: {
  requestedPromptCount: number;
  acceptedPromptCount: number;
  instanceStatuses: InstanceStatus[];
  force?: boolean;
}) {
  const warnings: string[] = [];
  const idleInstances = input.instanceStatuses.filter((item) => item.state === 'idle').length;
  const busyInstances = input.instanceStatuses.filter((item) => item.state === 'busy').length;
  const inactiveInstances = input.instanceStatuses.filter((item) => item.state === 'inactive').length;

  if (input.force) {
    warnings.push('force=true：将插队并尝试抢占正在执行的任务（如有），以尽快调度');
  }

  if (input.acceptedPromptCount < input.requestedPromptCount) {
    warnings.push(`已过滤空提示词 ${input.requestedPromptCount - input.acceptedPromptCount} 条`);
  }
  if (inactiveInstances > 0) {
    warnings.push(`实例池中有 ${inactiveInstances} 个 inactive 实例，调度速度会受影响`);
  }
  if (busyInstances > 0) {
    warnings.push(
      input.force
        ? `实例池中有 ${busyInstances} 个 busy 实例，force=true 将尝试抢占/等待空闲后分配`
        : `实例池中有 ${busyInstances} 个 busy 实例，任务将等待空闲后再分配`
    );
  }
  if (idleInstances === 0) {
    warnings.push(input.force ? '当前没有 idle 实例，force=true 将尝试抢占/等待容量释放' : '当前没有 idle 实例，调度器会先等待容量释放');
  }

  return warnings;
}

function touchActivity(taskId: string) {
  updateTaskState(taskId, (task) => ({
    ...task,
    lastActivityAt: nowIso(),
  }));
}

function incrementAssignmentMetrics(taskId: string) {
  updateTaskState(taskId, (task) => ({
    ...task,
    lastActivityAt: nowIso(),
    metrics: {
      ...task.metrics,
      totalAssignments: task.metrics.totalAssignments + 1,
      idleCyclesWithoutAssignment: 0,
    },
  }));
}

function incrementCompletionMetrics(taskId: string) {
  updateTaskState(taskId, (task) => ({
    ...task,
    lastActivityAt: nowIso(),
    metrics: {
      ...task.metrics,
      totalCompletions: task.metrics.totalCompletions + 1,
      idleCyclesWithoutAssignment: 0,
    },
  }));
}

function noteIdleCycle(taskId: string) {
  updateTaskState(taskId, (task) => ({
    ...task,
    metrics: {
      ...task.metrics,
      idleCyclesWithoutAssignment: task.metrics.idleCyclesWithoutAssignment + 1,
    },
  }));
}

function resetIdleCycles(taskId: string) {
  updateTaskState(taskId, (task) => ({
    ...task,
    metrics: {
      ...task.metrics,
      idleCyclesWithoutAssignment: 0,
    },
  }));
}

function updateInstanceResult(
  taskId: string,
  instanceId: string,
  input: {
    outcome: 'success' | 'failed' | 'cancelled';
    itemId?: string;
    mediaUrl?: string | null;
    mediaType?: 'image' | 'video' | 'unknown';
    imageUrl?: string | null;
    error?: string;
  }
) {
  updateTaskState(taskId, (task) => {
    const instances = task.instances.map((instance) => {
      if (instance.instanceId !== instanceId) return instance;

      if (input.outcome === 'success') {
        return {
          ...instance,
          lastCompletedItemId: input.itemId ?? instance.lastCompletedItemId,
          lastResultStatus: 'success' as const,
          lastMediaUrl: input.mediaUrl ?? input.imageUrl ?? null,
          lastMediaType: input.mediaType,
          lastImageUrl: input.imageUrl ?? null,
          lastError: undefined,
          consecutiveFailures: 0,
          successCount: instance.successCount + 1,
          cooldownUntil: undefined,
          detail: input.mediaType === 'video'
            ? '最近一次任务成功返回视频'
            : input.imageUrl
              ? '最近一次任务成功返回图片'
              : '最近一次任务成功完成',
        };
      }

      if (input.outcome === 'cancelled') {
        return {
          ...instance,
          lastCompletedItemId: input.itemId ?? instance.lastCompletedItemId,
          lastResultStatus: 'cancelled' as const,
          lastMediaUrl: input.mediaUrl ?? input.imageUrl ?? instance.lastMediaUrl ?? null,
          lastMediaType: input.mediaType ?? instance.lastMediaType,
          lastImageUrl: input.imageUrl ?? instance.lastImageUrl ?? null,
          lastError: undefined,
          detail: '最近一次任务已取消',
        };
      }

      const nextFailureStreak = instance.consecutiveFailures + 1;
      const unavailable = isInstanceUnavailableError(input.error);
      const timeoutFailure = parseFailureCategory(input.error) === 'timeout';
      const enableCooldown = unavailable || timeoutFailure || nextFailureStreak >= task.settings.failureCooldownThreshold;
      const cooldownMs = unavailable
        ? Math.max(task.settings.instanceCooldownMs, 3 * 60_000)
        : timeoutFailure
          ? Math.max(task.settings.instanceCooldownMs, 2 * 60_000)
          : task.settings.instanceCooldownMs;
      const cooldownUntil = enableCooldown ? new Date(Date.now() + cooldownMs).toISOString() : undefined;
      return {
        ...instance,
        lastCompletedItemId: input.itemId ?? instance.lastCompletedItemId,
        lastResultStatus: 'failed' as const,
        lastMediaUrl: input.mediaUrl ?? input.imageUrl ?? instance.lastMediaUrl ?? null,
        lastMediaType: input.mediaType ?? instance.lastMediaType,
        lastImageUrl: input.imageUrl ?? instance.lastImageUrl ?? null,
        lastError: input.error || '任务失败',
        failureCount: instance.failureCount + 1,
        consecutiveFailures: nextFailureStreak,
        cooldownUntil,
        detail: enableCooldown
          ? (unavailable
              ? `实例不可用，冷却 ${formatDurationMs(cooldownMs)}（等待手动恢复）`
              : timeoutFailure
                ? `子任务超时，冷却 ${formatDurationMs(cooldownMs)}（等待分身状态回稳）`
              : `连续失败 ${nextFailureStreak} 次，冷却 ${formatDurationMs(cooldownMs)}`)
          : (input.error || '最近一次任务失败'),
      };
    });

    return {
      ...task,
      instances,
    };
  });
}

async function refreshNonRunningInstances(taskId: string) {
  const current = taskStore().get(taskId);
  if (!current) return;
  const targetIds = current.instances
    .filter((instance) => instance.state !== 'running')
    .map((instance) => instance.instanceId);
  if (targetIds.length === 0) return;

  const statuses = await listDispatchableInstanceStatuses(targetIds).catch(() => []);
  if (statuses.length === 0) return;
  const statusMap = new Map(statuses.map((item) => [item.instanceId, item]));
  const nowMs = Date.now();

  updateTaskState(taskId, (task) => {
    const instances = task.instances.map((instance) => {
      if (instance.state === 'running') return instance;
      const status = statusMap.get(instance.instanceId);
      if (!status) return instance;
      const coolingDown = isInCooldown(instance, nowMs);
      const keepInactiveByRecentError = coolingDown && isInstanceUnavailableError(instance.lastError);
      return {
        ...instance,
        state: status.state === 'inactive' || keepInactiveByRecentError
          ? 'inactive'
          : coolingDown
            ? 'idle'
            : mapPoolState(status.state),
        detail: coolingDown
          ? `实例冷却中，截止 ${instance.cooldownUntil}`
          : (status.detail || instance.detail),
      };
    });
    return {
      ...task,
      instances,
    };
  });
}

async function releaseInstance(taskId: string, instanceId: string, leaseId?: string) {
  const status = await releaseInstanceLease(instanceId, leaseId, { mode: 'dispatcher' }).catch(() => null);
  const nowMs = Date.now();
  updateInstances(taskId, (instances) =>
    instances.map((instance) =>
      instance.instanceId !== instanceId
        ? instance
        : {
            ...instance,
            state: status?.state === 'inactive'
              || (isInCooldown(instance, nowMs) && isInstanceUnavailableError(instance.lastError))
              ? 'inactive'
              : 'idle',
            leaseId: undefined,
            currentItemId: undefined,
            currentPrompt: undefined,
            workflowTaskId: undefined,
            startedAt: undefined,
            lastReleasedAt: nowIso(),
            detail: isInCooldown(instance, nowMs)
              ? `实例冷却中，截止 ${instance.cooldownUntil}`
              : (status?.detail || instance.detail),
          }
    )
  );
}

async function assignNextItem(taskId: string, instanceId: string) {
  const current = taskStore().get(taskId);
  if (!current || current.cancelRequested || current.suspendRequested) return false;
  const instance = current.instances.find((item) => item.instanceId === instanceId);
  if (!instance || instance.state === 'running' || instance.state === 'inactive') return false;
  if (isInCooldown(instance)) {
    updateInstances(taskId, (instances) =>
      instances.map((item) =>
        item.instanceId !== instanceId
          ? item
          : {
              ...item,
              detail: `实例冷却中，截止 ${item.cooldownUntil}`,
            }
      )
    );
    return false;
  }

  const nextItem = current.items.find((item) => item.status === 'pending');
  if (!nextItem) return false;

  trace(taskId, 'assign_attempt', {
    instanceId,
    itemId: nextItem.id,
    index: nextItem.index,
    prompt: nextItem.prompt,
    attemptsSoFar: nextItem.attempts,
  });

  const lease = await acquireInstanceLease(instanceId, `${taskId}:${nextItem.id}`, { mode: 'dispatcher' });
  if (!lease.ok || !lease.leaseId) {
    const status = await getDispatchableInstanceStatus(instanceId).catch(() => null);
    const detail = lease.reason || status?.detail || instance.detail;
    trace(taskId, 'lease_failed', {
      instanceId,
      itemId: nextItem.id,
      reason: lease.reason,
      poolState: status?.state,
      detail,
    });
    updateInstances(taskId, (instances) =>
      instances.map((item) =>
        item.instanceId !== instanceId
          ? item
          : {
              ...item,
              state: status?.state === 'inactive' ? 'inactive' : status?.state === 'busy' ? 'busy' : 'idle',
              detail: lease.reason || status?.detail || item.detail,
            }
      )
    );
    return false;
  }

  trace(taskId, 'lease_acquired', {
    instanceId,
    itemId: nextItem.id,
    leaseId: lease.leaseId,
  });

  // 二次活性校验：避免分身状态刚好抖动（池里显示可用，但 AdsPower 实际未激活）导致整轮子任务白跑。
  const liveStatus = await listDispatchableInstanceStatuses([instanceId]).catch(() => []);
  const live = liveStatus.find((item) => item.instanceId === instanceId);
  if (live && live.state === 'inactive') {
    trace(taskId, 'assign_skipped_inactive', {
      instanceId,
      itemId: nextItem.id,
      leaseId: lease.leaseId,
      detail: live.detail,
    });
    updateInstances(taskId, (instances) =>
      instances.map((instance) =>
        instance.instanceId !== instanceId
          ? instance
          : {
              ...instance,
              state: 'inactive',
              detail: live.detail || '实例未激活，跳过本轮分配',
            }
      )
    );
    await releaseInstance(taskId, instanceId, lease.leaseId);
    return false;
  }

  updateTaskState(taskId, (task) => {
    const itemIndex = task.items.findIndex((item) => item.id === nextItem.id);
    const instanceIndex = task.instances.findIndex((item) => item.instanceId === instanceId);
    if (itemIndex < 0 || instanceIndex < 0) return task;

    const startedAt = nowIso();
    const items = task.items.map((item, index) =>
      index !== itemIndex
        ? item
        : (() => {
            const attempt = item.attempts + 1;
            return {
              ...item,
              status: 'running' as const,
              attempts: attempt,
              browserInstanceId: instanceId,
              startedAt: item.startedAt || startedAt,
              endedAt: undefined,
              error: undefined,
              failureCategory: undefined,
              attemptHistory: appendAttemptHistoryEntry(item, {
                attempt,
                prompt: item.prompt,
                browserInstanceId: instanceId,
                startedAt,
                outcome: 'running',
              }),
            };
          })()
    );
    const instances = task.instances.map((item, index) =>
      index !== instanceIndex
        ? item
        : {
            ...item,
            state: 'running' as const,
            leaseId: lease.leaseId,
            currentItemId: nextItem.id,
            currentPrompt: nextItem.prompt,
            workflowTaskId: undefined,
            startedAt,
            lastAssignedAt: startedAt,
            detail: '已分配任务，准备提交子任务',
            lastError: undefined,
            cooldownUntil: undefined,
          }
    );
    return {
      ...task,
      items,
      instances,
      summary: computeSummary(items),
    };
  });
  incrementAssignmentMetrics(taskId);

  trace(taskId, 'item_assigned', {
    instanceId,
    itemId: nextItem.id,
    index: nextItem.index,
    prompt: nextItem.prompt,
    attempt: nextItem.attempts + 1,
    childTimeoutMs: adaptiveChildTimeoutMs(current.settings.childTaskTimeoutMs, nextItem.attempts + 1),
    sourceImageCount: nextItem.sourceImageUrls.length,
    leaseId: lease.leaseId,
  });

  try {
    const workflowId = String(current.settings.workflowId || '').trim();
    if (!workflowId) {
      throw new Error('缺少 workflowId（请在调度任务参数里传 workflowId）');
    }
    const promptVarName = String(current.settings.promptVarName || 'noteUrl').trim() || 'noteUrl';
    const child = await startWorkflowTask({
      workflowId,
      vars: buildChildVars({
        promptVarName,
        browserInstanceId: instanceId,
        prompt: nextItem.prompt,
        sourceImageUrls: nextItem.sourceImageUrls,
      }),
    });
    updateTaskState(taskId, (task) => {
      const items = task.items.map((item) =>
        item.id !== nextItem.id
          ? item
          : {
              ...item,
              workflowTaskId: child.taskId,
              workflowTaskHistory: item.workflowTaskId
                ? [...(item.workflowTaskHistory ?? []), item.workflowTaskId]
                : (item.workflowTaskHistory ?? []),
              attemptHistory: patchLatestAttemptHistory(item, {
                workflowTaskId: child.taskId,
              }),
            }
      );
      const instances = task.instances.map((item) =>
        item.instanceId !== instanceId
          ? item
          : {
              ...item,
              workflowTaskId: child.taskId,
              detail: `子任务已启动: ${child.taskId}`,
            }
      );
      return {
        ...task,
        items,
        instances,
        summary: computeSummary(items),
      };
    });

    trace(taskId, 'child_task_created', {
      instanceId,
      itemId: nextItem.id,
      workflowTaskId: child.taskId,
      attempt: nextItem.attempts + 1,
      childTimeoutMs: adaptiveChildTimeoutMs(current.settings.childTaskTimeoutMs, nextItem.attempts + 1),
    });

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failureReason = `子任务创建失败: ${message}`;
    const failureCategory = parseFailureCategory(failureReason);
    const fresh = taskStore().get(taskId);
    if (!fresh) return false;
    const currentItem = fresh.items.find((item) => item.id === nextItem.id);
    if (!currentItem) return false;
    const exhausted = (currentItem?.attempts || 0) >= fresh.settings.maxAttemptsPerPrompt;
    let retryPrompt = currentItem.prompt;
    let retryPromptHistory = normalizePromptHistory(currentItem);
    let retryOptimizedCount = currentItem.promptOptimizedCount;
    let rewriteApplied = false;
    let rewriteReason: string | undefined;
    if (!exhausted) {
      const opt = await computeRetryPromptForFailure({
        taskId,
        task: fresh,
        item: currentItem,
        failureReason,
        failureCategory,
      });
      retryPrompt = opt.prompt;
      retryPromptHistory = opt.history;
      retryOptimizedCount = opt.optimizedCount;
      rewriteApplied = opt.rewriteApplied;
      if (opt.rewriteApplied) {
        rewriteReason = opt.rewriteForced ? 'forced_by_failure_category' : 'retry_optimization_enabled';
      }
    }
    const endedAt = nowIso();
    updateTaskState(taskId, (task) => {
      const items = task.items.map((item) =>
        item.id !== nextItem.id
          ? item
          : {
              ...item,
              status: exhausted ? 'failed' as const : 'pending' as const,
              prompt: !exhausted && typeof retryPrompt === 'string' && retryPrompt.trim() ? retryPrompt : item.prompt,
              promptHistory: !exhausted ? retryPromptHistory : item.promptHistory,
              promptOptimizedCount: !exhausted ? retryOptimizedCount : item.promptOptimizedCount,
              lastPromptOptimizedAt: !exhausted && (retryOptimizedCount ?? 0) > (item.promptOptimizedCount ?? 0)
                ? nowIso()
                : item.lastPromptOptimizedAt,
              error: failureReason,
              failureCategory,
              endedAt: exhausted ? endedAt : undefined,
              attemptHistory: patchLatestAttemptHistory(item, {
                endedAt,
                durationMs: toDurationMs(item.attemptHistory?.[item.attemptHistory.length - 1]?.startedAt, endedAt),
                outcome: exhausted ? 'failed' : 'create_failed',
                error: failureReason,
                failureCategory,
                rewriteApplied: !exhausted ? rewriteApplied : undefined,
                rewriteReason: !exhausted ? rewriteReason : undefined,
              }),
            }
      );
      const instances = task.instances.map((item) =>
        item.instanceId !== instanceId
          ? item
          : {
              ...item,
              state: 'idle' as const,
              workflowTaskId: undefined,
              currentItemId: undefined,
              currentPrompt: undefined,
              startedAt: undefined,
            }
      );
      return {
        ...task,
        items,
        instances,
        summary: computeSummary(items),
      };
    });
    trace(taskId, 'child_task_create_failed', {
      instanceId,
      itemId: nextItem.id,
      error: failureReason,
      category: failureCategory,
      rewriteApplied,
      rewriteReason,
      exhausted,
    });
    if (!exhausted) {
      trace(taskId, 'item_retry_scheduled', {
        instanceId,
        itemId: nextItem.id,
        status: 'pending',
        error: failureReason,
        category: failureCategory,
        rewriteApplied,
        rewriteReason,
      });
    }

    updateInstanceResult(taskId, instanceId, {
      outcome: 'failed',
      itemId: nextItem.id,
      error: failureReason,
    });
    await releaseInstance(taskId, instanceId, lease.leaseId);
    return false;
  }
}

async function reconcileRunningInstances(taskId: string) {
  const current = taskStore().get(taskId);
  if (!current) return 0;

  let completedCount = 0;

  for (const instance of current.instances.filter((item) => item.state === 'running' && item.currentItemId && item.workflowTaskId)) {
    const fresh = taskStore().get(taskId);
    if (!fresh) return completedCount;
    const workflowTaskId = instance.workflowTaskId;
    const currentItemId = instance.currentItemId;
    if (!workflowTaskId || !currentItemId) {
      continue;
    }

    if (fresh.cancelRequested) {
      stopWorkflowTask(workflowTaskId, 'dispatcher_cancel_requested');
    }

    const child = getWorkflowTask(workflowTaskId);
    if (!child) continue;
    if (!isWorkflowTaskTerminal(child.status)) {
      const item = fresh.items.find((entry) => entry.id === currentItemId);
      const timeoutMs = adaptiveChildTimeoutMs(fresh.settings.childTaskTimeoutMs, item?.attempts || 1);
      if (instance.startedAt && Date.now() - Date.parse(instance.startedAt) > timeoutMs) {
        stopWorkflowTask(workflowTaskId, 'dispatcher_child_timeout');
        const exhausted = (item?.attempts || 0) >= fresh.settings.maxAttemptsPerPrompt;
        const timeoutMessage = `子任务超时（>${Math.floor(timeoutMs / 1000)}s）`;
        const failureCategory = parseFailureCategory(timeoutMessage);
        let retryPrompt = item?.prompt;
        let retryPromptHistory = item ? normalizePromptHistory(item) : undefined;
        let retryOptimizedCount = item?.promptOptimizedCount;
        let rewriteApplied = false;
        let rewriteReason: string | undefined;
        if (!exhausted && item) {
          const opt = await computeRetryPromptForFailure({
            taskId,
            task: fresh,
            item,
            failureReason: timeoutMessage,
            failureCategory,
          });
          retryPrompt = opt.prompt;
          retryPromptHistory = opt.history;
          retryOptimizedCount = opt.optimizedCount;
          rewriteApplied = opt.rewriteApplied;
          if (opt.rewriteApplied) {
            rewriteReason = opt.rewriteForced ? 'forced_by_failure_category' : 'retry_optimization_enabled';
          }
        }
        const endedAt = nowIso();
        updateTaskState(taskId, (task) => {
          const items = task.items.map((entry) =>
            entry.id !== currentItemId
              ? entry
              : {
                  ...entry,
                  status: exhausted ? 'failed' as const : 'pending' as const,
                  prompt: !exhausted && typeof retryPrompt === 'string' && retryPrompt.trim() ? retryPrompt : entry.prompt,
                  promptHistory: !exhausted ? retryPromptHistory : entry.promptHistory,
                  promptOptimizedCount: !exhausted ? retryOptimizedCount : entry.promptOptimizedCount,
                  lastPromptOptimizedAt: !exhausted && (retryOptimizedCount ?? 0) > (entry.promptOptimizedCount ?? 0)
                    ? nowIso()
                    : entry.lastPromptOptimizedAt,
                  error: timeoutMessage,
                  failureCategory,
                  endedAt: exhausted ? endedAt : undefined,
                  attemptHistory: patchLatestAttemptHistory(entry, {
                    endedAt,
                    durationMs: toDurationMs(entry.attemptHistory?.[entry.attemptHistory.length - 1]?.startedAt, endedAt),
                    outcome: exhausted ? 'failed' : 'timeout',
                    error: timeoutMessage,
                    failureCategory,
                    rewriteApplied: !exhausted ? rewriteApplied : undefined,
                    rewriteReason: !exhausted ? rewriteReason : undefined,
                  }),
                }
          );
          return {
            ...task,
            items,
            summary: computeSummary(items),
          };
        });
        trace(taskId, 'child_task_timeout', {
          instanceId: instance.instanceId,
          itemId: currentItemId,
          workflowTaskId,
          prompt: item?.prompt,
          attempts: item?.attempts,
          timeoutMs,
          failureCategory,
          rewriteApplied,
          rewriteReason,
          exhausted,
        });
        if (!exhausted) {
          trace(taskId, 'item_retry_scheduled', {
            instanceId: instance.instanceId,
            itemId: currentItemId,
            workflowTaskId,
            status: 'pending',
            error: timeoutMessage,
            category: failureCategory,
            rewriteApplied,
            rewriteReason,
          });
        }

        updateInstanceResult(taskId, instance.instanceId, {
          outcome: 'failed',
          itemId: currentItemId,
          error: timeoutMessage,
        });
        await releaseInstance(taskId, instance.instanceId, instance.leaseId);
        completedCount += 1;
        incrementCompletionMetrics(taskId);
      }
      continue;
    }

    const item = fresh.items.find((entry) => entry.id === currentItemId);
    const artifacts = collectWorkflowTaskArtifacts(workflowTaskId);
    const mediaUrls = filterReferenceMediaUrls(artifacts?.mediaUrls ?? [], item?.sourceImageUrls ?? []);
    const imageUrls = filterReferenceMediaUrls(artifacts?.imageUrls ?? [], item?.sourceImageUrls ?? []);
    const success = child.status === 'done' && mediaUrls.length > 0;
    const cancelled = child.status === 'stopped';
    const message = success
      ? undefined
      : cancelled
        ? undefined
        : child.errorMessage || (mediaUrls.length === 0 ? '任务未返回媒体 URL' : '子任务失败');
    const failureCategory = !success && !cancelled
      ? parseFailureCategory(message || '子任务失败')
      : undefined;

    // Fast-fail 策略处理
    const isFastFail = !success && !cancelled && Boolean(message?.includes('FAIL_FAST:'));
    const fastFailStrategy = isFastFail
      ? (getRuntimeBackendConfigSync().adsDispatcher?.fastFailStrategy ?? 'llm_rewrite')
      : 'direct_retry';
    const forceExhausted = isFastFail && fastFailStrategy === 'skip';
    const exhausted = !success && !cancelled && (forceExhausted || (item?.attempts || 0) >= fresh.settings.maxAttemptsPerPrompt);
    const endedAt = nowIso();

    trace(taskId, 'child_task_terminal', {
      instanceId: instance.instanceId,
      itemId: currentItemId,
      workflowTaskId,
      childStatus: child.status,
      success,
      cancelled,
      mediaUrl: mediaUrls[0] || null,
      imageUrl: imageUrls[0] || null,
      mediaCount: mediaUrls.length,
      attempts: item?.attempts,
      error: message,
      failureCategory,
    });

    let retryPrompt = item?.prompt;
    let retryPromptHistory = item ? normalizePromptHistory(item) : undefined;
    let retryOptimizedCount = item?.promptOptimizedCount;
    let rewriteApplied = false;
    let rewriteReason: string | undefined;
    if (!success && !cancelled && !exhausted && item) {
      const isDownloadExtractFastFail = isDownloadExtractFastFailReason(message);
      const forceRewriteForRetry = isFastFail
        ? (fastFailStrategy === 'llm_rewrite' && isDownloadExtractFastFail)
        : undefined;
      if (isFastFail && fastFailStrategy !== 'direct_retry') {
        trace(taskId, 'fast_fail_retry_strategy', {
          itemId: currentItemId,
          strategy: fastFailStrategy,
          forceLlmRewrite: forceRewriteForRetry === true,
          eligibleByNode: isDownloadExtractFastFail,
          attempts: item.attempts,
          message,
        });
      }
      const opt = await computeRetryPromptForFailure({
        taskId,
        task: fresh,
        item,
        failureReason: message || '子任务失败',
        failureCategory: failureCategory || 'unknown',
        forceRewrite: forceRewriteForRetry,
      });
      retryPrompt = opt.prompt;
      retryPromptHistory = opt.history;
      retryOptimizedCount = opt.optimizedCount;
      rewriteApplied = opt.rewriteApplied;
      if (opt.rewriteApplied) {
        rewriteReason = opt.rewriteForced ? 'forced_by_failure_category' : 'retry_optimization_enabled';
      }
    }

    updateTaskState(taskId, (task) => {
      const items = task.items.map((entry) => {
        if (entry.id !== currentItemId) return entry;
        if (success) {
          return {
            ...entry,
            status: 'success' as const,
            mediaUrls,
            imageUrls,
            primaryMediaType: artifacts?.primaryMediaType,
            error: undefined,
            failureCategory: undefined,
            endedAt,
            attemptHistory: patchLatestAttemptHistory(entry, {
              endedAt,
              durationMs: toDurationMs(entry.attemptHistory?.[entry.attemptHistory.length - 1]?.startedAt, endedAt),
              outcome: 'success',
              error: undefined,
              failureCategory: undefined,
            }),
          };
        }
        if (cancelled || task.cancelRequested) {
          return {
            ...entry,
            status: 'cancelled' as const,
            error: undefined,
            failureCategory: undefined,
            endedAt,
            attemptHistory: patchLatestAttemptHistory(entry, {
              endedAt,
              durationMs: toDurationMs(entry.attemptHistory?.[entry.attemptHistory.length - 1]?.startedAt, endedAt),
              outcome: 'cancelled',
              error: undefined,
              failureCategory: undefined,
            }),
          };
        }

        if (exhausted) {
          return {
            ...entry,
            status: 'failed' as const,
            mediaUrls: mediaUrls.length > 0 ? mediaUrls : entry.mediaUrls,
            imageUrls: imageUrls.length > 0 ? imageUrls : entry.imageUrls,
            primaryMediaType: artifacts?.primaryMediaType || entry.primaryMediaType,
            error: message,
            failureCategory,
            endedAt,
            attemptHistory: patchLatestAttemptHistory(entry, {
              endedAt,
              durationMs: toDurationMs(entry.attemptHistory?.[entry.attemptHistory.length - 1]?.startedAt, endedAt),
              outcome: 'failed',
              error: message,
              failureCategory,
              rewriteApplied,
              rewriteReason,
            }),
          };
        }

        return {
          ...entry,
          status: 'pending' as const,
          prompt: typeof retryPrompt === 'string' && retryPrompt.trim() ? retryPrompt : entry.prompt,
          promptHistory: retryPromptHistory,
          promptOptimizedCount: retryOptimizedCount,
          lastPromptOptimizedAt: retryOptimizedCount && retryOptimizedCount > (entry.promptOptimizedCount ?? 0) ? nowIso() : entry.lastPromptOptimizedAt,
          mediaUrls: mediaUrls.length > 0 ? mediaUrls : entry.mediaUrls,
          imageUrls: imageUrls.length > 0 ? imageUrls : entry.imageUrls,
          primaryMediaType: artifacts?.primaryMediaType || entry.primaryMediaType,
          error: message,
          failureCategory,
          endedAt: undefined,
          attemptHistory: patchLatestAttemptHistory(entry, {
            endedAt,
            durationMs: toDurationMs(entry.attemptHistory?.[entry.attemptHistory.length - 1]?.startedAt, endedAt),
            outcome: 'failed',
            error: message,
            failureCategory,
            rewriteApplied,
            rewriteReason,
          }),
        };
      });
      return {
        ...task,
        items,
        summary: computeSummary(items),
      };
    });

    const resultStatus = success
      ? 'success'
      : cancelled || fresh.cancelRequested
        ? 'cancelled'
        : exhausted
          ? 'failed'
          : 'retry';

    trace(taskId, resultStatus === 'retry' ? 'item_retry_scheduled' : 'item_settled', {
      instanceId: instance.instanceId,
      itemId: currentItemId,
      workflowTaskId,
      prompt: resultStatus === 'retry' ? retryPrompt : item?.prompt,
      attempts: item?.attempts,
      status: resultStatus === 'retry' ? 'pending' : resultStatus,
      mediaUrl: mediaUrls[0] || null,
      imageUrl: imageUrls[0] || null,
      error: resultStatus === 'success' || resultStatus === 'cancelled' ? undefined : message,
      category: failureCategory,
      rewriteApplied,
      rewriteReason,
    });

    if (success && (mediaUrls[0] || imageUrls[0])) {
      const primary = mediaUrls[0] || imageUrls[0];
      const dup = fresh.items.find((entry) =>
        entry.id !== currentItemId && (entry.mediaUrls?.[0] === primary || entry.imageUrls?.[0] === primary)
      );
      if (dup) {
        trace(taskId, 'duplicate_primary_media_detected', {
          primary,
          currentItemId,
          currentPrompt: item?.prompt,
          previousItemId: dup.id,
          previousPrompt: dup.prompt,
        });
      }
    }

    updateInstanceResult(taskId, instance.instanceId, {
      outcome: success ? 'success' : cancelled || fresh.cancelRequested ? 'cancelled' : 'failed',
      itemId: currentItemId,
      mediaUrl: mediaUrls[0] || null,
      mediaType: artifacts?.primaryMediaType,
      imageUrl: imageUrls[0] || null,
      error: success ? undefined : message,
    });
    await releaseInstance(taskId, instance.instanceId, instance.leaseId);
    completedCount += 1;
    incrementCompletionMetrics(taskId);
  }

  return completedCount;
}

async function finalizeTaskWithFailure(taskId: string, reason: string) {
  const current = taskStore().get(taskId);
  if (!current) return;
  const endedAt = nowIso();
  const failureCategory = parseFailureCategory(reason);

  for (const instance of current.instances.filter((item) => item.workflowTaskId)) {
    if (instance.workflowTaskId) {
      stopWorkflowTask(instance.workflowTaskId, 'dispatcher_finalize_failure');
    }
  }

  for (const instance of current.instances.filter((item) => item.leaseId)) {
    await releaseInstance(taskId, instance.instanceId, instance.leaseId);
  }

  const final = taskStore().get(taskId);
  if (!final) return;
  const items = final.items.map((item) =>
    item.status === 'success' || item.status === 'failed' || item.status === 'cancelled'
      ? item
      : {
          ...item,
          status: 'failed' as const,
          error: item.error || reason,
          failureCategory: item.failureCategory || failureCategory,
          endedAt: item.endedAt || endedAt,
          attemptHistory: patchLatestAttemptHistory(item, {
            endedAt: item.endedAt || endedAt,
            durationMs: toDurationMs(item.attemptHistory?.[item.attemptHistory.length - 1]?.startedAt, item.endedAt || endedAt),
            outcome: 'failed',
            error: item.error || reason,
            failureCategory: item.failureCategory || failureCategory,
          }),
        }
  );
  const summary = computeSummary(items);
  updateTask(taskId, {
    status: 'failed',
    error: reason,
    endedAt,
    cacheUntil: new Date(Date.now() + TASK_CACHE_TTL_MS).toISOString(),
    items,
    summary,
    instances: final.instances.map((instance) => ({
      ...instance,
      state: instance.state === 'inactive' ? 'inactive' : 'idle',
      currentItemId: undefined,
      currentPrompt: undefined,
      workflowTaskId: undefined,
      leaseId: undefined,
      startedAt: undefined,
    })),
  });
  trace(taskId, 'task_finalized', { status: 'failed', endedAt, error: reason, summary });
}

async function runDispatcherTask(taskId: string) {
  const task = taskStore().get(taskId);
  if (!task) return;
  const startedAt = nowIso();
  updateTask(taskId, { status: 'running', startedAt, lastActivityAt: startedAt });
  trace(taskId, 'task_started', { startedAt });

  while (true) {
    const fresh = taskStore().get(taskId);
    if (!fresh) return;

    if (Date.now() - parseTs(fresh.startedAt || startedAt) > fresh.settings.dispatcherTimeoutMs) {
      await finalizeTaskWithFailure(
        taskId,
        `调度总超时（>${formatDurationMs(fresh.settings.dispatcherTimeoutMs)}），未完成任务已终止`
      );
      return;
    }

    const completedCount = await reconcileRunningInstances(taskId);
    if (completedCount > 0) {
      touchActivity(taskId);
    }

    await refreshNonRunningInstances(taskId);

    const latest = taskStore().get(taskId);
    if (!latest) return;

    if (latest.suspendRequested) {
      const active = latest.instances.filter((item) => item.state === 'running' && item.workflowTaskId);
      for (const instance of active) {
        if (instance.workflowTaskId) stopWorkflowTask(instance.workflowTaskId, 'dispatcher_suspended');
      }
      if (active.length === 0) break;
      await sleep(latest.settings.pollIntervalMs);
      continue;
    }

    if (latest.cancelRequested) {
      const active = latest.instances.filter((item) => item.state === 'running' && item.workflowTaskId);
      if (active.length === 0) break;
      await sleep(latest.settings.pollIntervalMs);
      continue;
    }

    const pendingItems = latest.items.filter((item) => item.status === 'pending');
    const runningItems = latest.items.filter((item) => item.status === 'running');
    if (pendingItems.length === 0 && runningItems.length === 0) {
      break;
    }

    let assignedCount = 0;
    const idleInstances = latest.instances.filter((item) => item.state === 'idle');
    for (const instance of idleInstances) {
      const currentTask = taskStore().get(taskId);
      if (!currentTask || currentTask.cancelRequested || currentTask.suspendRequested) break;
      const hasPending = currentTask.items.some((item) => item.status === 'pending');
      if (!hasPending) break;
      const assigned = await assignNextItem(taskId, instance.instanceId);
      if (assigned) {
        assignedCount += 1;
      }
    }

    const afterAssign = taskStore().get(taskId);
    if (!afterAssign) return;

    if (assignedCount === 0 && afterAssign.summary.running === 0 && afterAssign.summary.pending > 0) {
      noteIdleCycle(taskId);
      const stalled = taskStore().get(taskId);
      if (stalled && stalled.metrics.idleCyclesWithoutAssignment >= stalled.settings.maxIdleCyclesWithoutAssignment) {
        await finalizeTaskWithFailure(
          taskId,
          `实例池连续 ${stalled.metrics.idleCyclesWithoutAssignment} 轮无可用容量，调度已熔断`
        );
        return;
      }
    } else if (assignedCount > 0 || afterAssign.summary.running > 0) {
      resetIdleCycles(taskId);
    }

    await sleep(afterAssign.settings.pollIntervalMs);
  }

  const final = taskStore().get(taskId);
  if (!final) return;
  const endedAt = nowIso();

  if (final.suspendRequested) {
    const willPause = Boolean(final.pauseRequested);

    const nextItems = final.items.map((item) =>
      item.status === 'running'
        ? {
            ...item,
            status: 'pending' as const,
            browserInstanceId: undefined,
            workflowTaskId: undefined,
            error: undefined,
            failureCategory: undefined,
            endedAt: undefined,
            attemptHistory: patchLatestAttemptHistory(item, {
              endedAt,
              durationMs: toDurationMs(item.attemptHistory?.[item.attemptHistory.length - 1]?.startedAt, endedAt),
              outcome: 'cancelled',
              error: undefined,
              failureCategory: undefined,
            }),
          }
        : item
    );

    const summary = computeSummary(nextItems);
    updateTask(taskId, {
      status: willPause ? 'paused' : 'queued',
      startedAt: undefined,
      endedAt: undefined,
      suspendedAt: endedAt,
      suspendRequested: false,
      pauseRequested: false,
      pausedAt: willPause ? endedAt : final.pausedAt,
      pauseReason: willPause ? final.pauseReason || final.suspendReason : final.pauseReason,
      items: nextItems,
      summary,
      instances: final.instances.map((instance) => ({
        ...instance,
        state: instance.state === 'inactive' ? 'inactive' : 'idle',
        currentItemId: undefined,
        currentPrompt: undefined,
        workflowTaskId: undefined,
        leaseId: undefined,
        startedAt: undefined,
      })),
    });

    trace(taskId, willPause ? 'task_paused' : 'task_suspended', {
      suspendedAt: endedAt,
      pausedAt: willPause ? endedAt : undefined,
      reason: final.pauseReason || final.suspendReason,
    });

    if (!willPause) {
      await enqueueTask(taskId, { mode: 'front' });
    }
    return;
  }

  if (final.cancelRequested) {
    const cancelledItems = final.items.map((item) =>
      item.status === 'success' || item.status === 'failed'
        ? item
        : {
            ...item,
            status: 'cancelled' as const,
            failureCategory: undefined,
            endedAt: item.endedAt || endedAt,
            attemptHistory: patchLatestAttemptHistory(item, {
              endedAt: item.endedAt || endedAt,
              durationMs: toDurationMs(item.attemptHistory?.[item.attemptHistory.length - 1]?.startedAt, item.endedAt || endedAt),
              outcome: 'cancelled',
              error: undefined,
              failureCategory: undefined,
            }),
          }
    );
    const summary = computeSummary(cancelledItems);
    updateTask(taskId, {
      status: 'cancelled',
      endedAt,
      cacheUntil: new Date(Date.now() + TASK_CACHE_TTL_MS).toISOString(),
      items: cancelledItems,
      summary,
      instances: final.instances.map((instance) => ({
        ...instance,
        state: instance.state === 'inactive' ? 'inactive' : 'idle',
        currentItemId: undefined,
        currentPrompt: undefined,
        workflowTaskId: undefined,
        leaseId: undefined,
        startedAt: undefined,
      })),
    });
    trace(taskId, 'task_finalized', { status: 'cancelled', endedAt, summary });
    return;
  }

  const settledItems = final.items.map((item) =>
    item.status === 'pending' || item.status === 'running'
      ? {
          ...item,
          status: 'failed' as const,
          error: item.error || '任务结束时仍未完成',
          failureCategory: item.failureCategory || parseFailureCategory(item.error || '任务结束时仍未完成'),
          endedAt: item.endedAt || endedAt,
          attemptHistory: patchLatestAttemptHistory(item, {
            endedAt: item.endedAt || endedAt,
            durationMs: toDurationMs(item.attemptHistory?.[item.attemptHistory.length - 1]?.startedAt, item.endedAt || endedAt),
            outcome: 'failed',
            error: item.error || '任务结束时仍未完成',
            failureCategory: item.failureCategory || parseFailureCategory(item.error || '任务结束时仍未完成'),
          }),
        }
      : item
  );
  const summary = computeSummary(settledItems);
  const status = summary.success === summary.total ? 'success' : 'failed';
  updateTask(taskId, {
    status,
    endedAt,
    cacheUntil: new Date(Date.now() + TASK_CACHE_TTL_MS).toISOString(),
    items: settledItems,
    summary,
    instances: final.instances.map((instance) => ({
      ...instance,
      state: instance.state === 'inactive' ? 'inactive' : 'idle',
      currentItemId: undefined,
      currentPrompt: undefined,
      workflowTaskId: undefined,
      leaseId: undefined,
      startedAt: undefined,
    })),
  });
  trace(taskId, 'task_finalized', { status, endedAt, summary });
}

export async function createGeminiAdsDispatcherTask(input: {
  prompts?: string[];
  runs?: Array<{
    prompt: string;
    sourceImageUrls?: string[] | string;
  }>;
  instanceIds?: string[];
  workflowId?: string;
  promptVarName?: string;
  maxAttemptsPerPrompt?: number;
  pollIntervalMs?: number;
  childTaskTimeoutMs?: number;
  dispatcherTimeoutMs?: number;
  maxIdleCyclesWithoutAssignment?: number;
  instanceCooldownMs?: number;
  failureCooldownThreshold?: number;
  autoCloseTab?: boolean;

  optimizePromptOnRetry?: boolean;
  promptOptimizationModel?: string;
  promptOptimizationTimeoutMs?: number;
  maxPromptOptimizationsPerItem?: number;

  force?: boolean;
  forceReason?: string;
}) {
  const requestedPromptCount = Array.isArray(input.runs)
    ? input.runs.length
    : Array.isArray(input.prompts)
      ? input.prompts.length
      : 0;
  const normalizedRuns = Array.isArray(input.runs)
    ? input.runs
      .map((item) => ({
        prompt: String(item?.prompt || '').trim(),
        sourceImageUrls: normalizeSourceImageUrls(item?.sourceImageUrls),
      }))
      .filter((item) => item.prompt)
    : (input.prompts ?? [])
      .map((item) => ({
        prompt: String(item || '').trim(),
        sourceImageUrls: [] as string[],
      }))
      .filter((item) => item.prompt);
  const prompts = normalizedRuns.map((item) => item.prompt);
  if (prompts.length === 0) {
    throw new Error('prompts 不能为空');
  }

  const rawInstanceIds = input.instanceIds || DEFAULT_INSTANCE_IDS;
  const uniqueInstanceIds = Array.from(new Set(rawInstanceIds.map((item) => String(item || '').trim()).filter(Boolean)));
  if (uniqueInstanceIds.length === 0) {
    throw new Error('instanceIds 不能为空');
  }

  const maxAttemptsPerPrompt = Math.max(1, Math.min(10, Number(input.maxAttemptsPerPrompt ?? 3) || 3));
  const pollIntervalMs = Math.max(800, Number(input.pollIntervalMs ?? 2000) || 2000);
  const childTaskTimeoutMs = Math.max(60_000, Number(input.childTaskTimeoutMs ?? 8 * 60 * 1000) || 8 * 60 * 1000);
  const dispatcherTimeoutMs = Math.max(5 * 60_000, Number(input.dispatcherTimeoutMs ?? DEFAULT_DISPATCHER_TIMEOUT_MS) || DEFAULT_DISPATCHER_TIMEOUT_MS);
  const maxIdleCyclesWithoutAssignment = Math.max(
    3,
    Number(input.maxIdleCyclesWithoutAssignment ?? DEFAULT_MAX_IDLE_CYCLES) || DEFAULT_MAX_IDLE_CYCLES
  );
  const instanceCooldownMs = Math.max(5_000, Number(input.instanceCooldownMs ?? DEFAULT_INSTANCE_COOLDOWN_MS) || DEFAULT_INSTANCE_COOLDOWN_MS);
  const failureCooldownThreshold = Math.max(
    1,
    Math.min(5, Number(input.failureCooldownThreshold ?? DEFAULT_FAILURE_COOLDOWN_THRESHOLD) || DEFAULT_FAILURE_COOLDOWN_THRESHOLD)
  );

  const optimizePromptOnRetry = input.optimizePromptOnRetry ?? DEFAULT_OPTIMIZE_PROMPT_ON_RETRY;
  const promptOptimizationModel = String(input.promptOptimizationModel ?? DEFAULT_PROMPT_OPTIMIZATION_MODEL).trim() || DEFAULT_PROMPT_OPTIMIZATION_MODEL;
  const promptOptimizationTimeoutMs = Math.max(
    1000,
    Math.min(30_000, Number(input.promptOptimizationTimeoutMs ?? DEFAULT_PROMPT_OPTIMIZATION_TIMEOUT_MS) || DEFAULT_PROMPT_OPTIMIZATION_TIMEOUT_MS)
  );
  const maxPromptOptimizationsPerItem = Math.max(
    0,
    Math.min(3, Number(input.maxPromptOptimizationsPerItem ?? DEFAULT_MAX_PROMPT_OPTIMIZATIONS_PER_ITEM) || DEFAULT_MAX_PROMPT_OPTIMIZATIONS_PER_ITEM)
  );

  const fallbackStatuses: InstanceStatus[] = uniqueInstanceIds.map((instanceId) => ({
    instanceId,
    state: 'idle',
    tabOpen: false,
    active: true,
    locked: false,
    source: 'none',
    detail: '实例预检失败，按可调度处理',
  }));
  const instanceStatuses: InstanceStatus[] = await listDispatchableInstanceStatuses(uniqueInstanceIds).catch(() => fallbackStatuses);
  const warnings = buildWarnings({
    requestedPromptCount,
    acceptedPromptCount: prompts.length,
    instanceStatuses,
    force: Boolean(input.force),
  });
  if (uniqueInstanceIds.length < rawInstanceIds.length) {
    warnings.unshift(`实例池已去重，原始 ${rawInstanceIds.length} 个实例保留为 ${uniqueInstanceIds.length} 个`);
  }

  const preflight: DispatcherPreflight = {
    requestedPromptCount,
    acceptedPromptCount: prompts.length,
    totalInstances: uniqueInstanceIds.length,
    idleInstances: instanceStatuses.filter((item) => item.state === 'idle').length,
    busyInstances: instanceStatuses.filter((item) => item.state === 'busy').length,
    inactiveInstances: instanceStatuses.filter((item) => item.state === 'inactive').length,
    willWaitForCapacity: instanceStatuses.every((item) => item.state !== 'idle'),
  };

  // Enforce FIFO queue capacity before creating the task.
  if (input.force) {
    await clearGeminiAdsDispatcherQueue({
      reason: input.forceReason || 'force clearing queue',
      includeRunning: true,
    });
  } else {
    await withQueueLock(async () => {
      const state = normalizeQueueState(loadQueueState());
      const maxSize = queueMaxSize();
      const size = queueSize(state);
      persistQueueState(state);
      if (size >= maxSize) {
        throw new Error(`队列已满（${size}/${maxSize}），请稍后重试`);
      }
    });
  }

  const now = nowIso();
  const taskId = randomUUID();

  pruneTaskTraces(TRACE_NAMESPACE);
  const traceFile = taskTraceFileRelative(taskTraceFile(TRACE_NAMESPACE, taskId));

  const items: GeminiAdsDispatcherItem[] = normalizedRuns.map((run, index) => ({
    id: `${taskId}-${index + 1}`,
    index,
    prompt: run.prompt,
    sourceImageUrls: run.sourceImageUrls,
    promptHistory: [run.prompt],
    promptOptimizedCount: 0,
    status: 'pending',
    attempts: 0,
    mediaUrls: [],
    imageUrls: [],
  }));
  const statusMap = new Map(instanceStatuses.map((item) => [item.instanceId, item]));
  const instances: GeminiAdsDispatcherInstance[] = uniqueInstanceIds.map((instanceId) => {
    const status = statusMap.get(instanceId);
    return {
      instanceId,
      state: mapPoolState(status?.state),
      lastMediaUrl: null,
      lastImageUrl: null,
      detail: status?.detail,
      consecutiveFailures: 0,
      successCount: 0,
      failureCount: 0,
    };
  });

  const task: GeminiAdsDispatcherTask = {
    id: taskId,
    status: 'queued',
    createdAt: now,
    cancelRequested: false,
    suspendRequested: false,
    warnings,
    preflight,
    settings: {
      instanceIds: uniqueInstanceIds,
      workflowId: input.workflowId,
      promptVarName: input.promptVarName,
      maxAttemptsPerPrompt,
      pollIntervalMs,
      childTaskTimeoutMs,
      dispatcherTimeoutMs,
      maxIdleCyclesWithoutAssignment,
      instanceCooldownMs,
      failureCooldownThreshold,
      autoCloseTab: input.autoCloseTab === true,

      optimizePromptOnRetry: Boolean(optimizePromptOnRetry),
      promptOptimizationModel,
      promptOptimizationTimeoutMs,
      maxPromptOptimizationsPerItem,
    },
    summary: computeSummary(items),
    metrics: {
      totalAssignments: 0,
      totalCompletions: 0,
      idleCyclesWithoutAssignment: 0,
    },
    prompts,
    items,
    instances,
    traceFile,
  };
  taskStore().set(taskId, task);
  persistTask(task);

  trace(taskId, 'task_created', {
    status: task.status,
    warnings: task.warnings,
    preflight: task.preflight,
    settings: task.settings,
    prompts: task.prompts,
    items: task.items.map((item) => ({
      id: item.id,
      index: item.index,
      prompt: item.prompt,
      sourceImageUrls: item.sourceImageUrls,
    })),
    instances: task.instances,
  });

  if (input.force) {
    await forceDispatchTask(taskId, input.forceReason);
  } else {
    await enqueueTask(taskId);
  }

  return task;
}

/**
 * [NEW] 内部同步校验，仅检查内存和本地文件，不触发网络请求
 * 用于队列维护等高频、低延迟场景
 */
function getGeminiAdsDispatcherTaskSync(taskId: string): GeminiAdsDispatcherTask | undefined {
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

/**
 * 获取调度任务详情（支持二级缓存回源）
 * 逻辑：内存 -> 本地磁盘 -> Supabase 远端
 */
export async function getGeminiAdsDispatcherTask(taskId: string): Promise<GeminiAdsDispatcherTask | undefined> {
  // 1. 本地尝试（内存 & 磁盘）
  const local = getGeminiAdsDispatcherTaskSync(taskId);
  if (local) return local;

  // 2. 本地缺失或已过期，尝试从 Supabase 远端恢复
  const { getAdsDispatcherTaskSnapshot } = require('./supabase-task-persist');
  const remote = await getAdsDispatcherTaskSnapshot(taskId).catch(() => null);
  
  if (remote) {
    // 赋予一个新的本地 TTL（如继续保留 3 小时），避免频繁请求数据库
    const task: GeminiAdsDispatcherTask = {
      ...(remote as unknown as GeminiAdsDispatcherTask),
      cacheUntil: new Date(Date.now() + TASK_CACHE_TTL_MS).toISOString()
    };
    taskStore().set(taskId, task);
    // 恢复现场提示
    console.log(`[Dispatcher] Task ${taskId} resurrected from Supabase.`);
    return task;
  }

  return undefined;
}

export async function cancelGeminiAdsDispatcherTask(taskId: string, reason?: string) {
  const task = await getGeminiAdsDispatcherTask(taskId);
  if (!task) return undefined;
  if (isTerminal(task.status)) return task;

  let updated = updateTask(taskId, {
    cancelRequested: true,
    cancelReason: reason ? String(reason).slice(0, 500) : task.cancelReason,
  });

  if (updated) {
    trace(taskId, 'cancel_requested', { status: task.status, reason: updated.cancelReason });

    // If still queued, cancel immediately and remove from queue.
    if (updated.status === 'queued') {
      const endedAt = nowIso();
      const cancelledItems = updated.items.map((item) =>
        item.status === 'success' || item.status === 'failed' ? item : { ...item, status: 'cancelled' as const, endedAt }
      );
      updated =
        updateTask(taskId, {
          status: 'cancelled',
          endedAt,
          cacheUntil: new Date(Date.now() + TASK_CACHE_TTL_MS).toISOString(),
          items: cancelledItems,
          summary: computeSummary(cancelledItems),
        }) || updated;
      void removeFromQueue(taskId);
      trace(taskId, 'task_cancelled_in_queue', { reason: updated.cancelReason });
    }
  }

  return updated;
}

export async function pauseGeminiAdsDispatcherTask(taskId: string, reason?: string) {
  const task = await getGeminiAdsDispatcherTask(taskId);
  if (!task) return undefined;
  if (isTerminal(task.status)) return task;

  const now = nowIso();
  const normalizedReason = reason ? String(reason).slice(0, 500) : undefined;

  if (task.status === 'paused') return task;

  // If still queued, pause immediately and remove from queue.
  if (task.status === 'queued') {
    const updated =
      updateTask(taskId, {
        status: 'paused',
        pausedAt: now,
        pauseReason: normalizedReason,
        lastActivityAt: now,
      }) || task;

    await removeFromQueue(taskId).catch(() => null);
    trace(taskId, 'task_paused_in_queue', { pausedAt: now, reason: normalizedReason });
    return updated;
  }

  // Running: request suspend + force stop instances, then the main loop will transition to paused.
  const patched =
    updateTask(taskId, {
      pauseRequested: true,
      pauseReason: normalizedReason,
      lastActivityAt: now,
    }) || task;

  trace(taskId, 'pause_requested', { requestedAt: now, reason: normalizedReason });
  requestTaskSuspend(taskId, normalizedReason || 'pause');
  void forceStopRunningTaskInstances(taskId, normalizedReason || 'pause');
  return patched;
}

export async function resumeGeminiAdsDispatcherTask(taskId: string, options?: { mode?: 'front' | 'back' }) {
  const task = await getGeminiAdsDispatcherTask(taskId);
  if (!task) return undefined;
  if (isTerminal(task.status)) return task;
  if (task.status !== 'paused') return task;

  const now = nowIso();
  const updated =
    updateTask(taskId, {
      status: 'queued',
      pausedAt: undefined,
      pauseReason: undefined,
      lastActivityAt: now,
    }) || task;

  trace(taskId, 'task_resumed', { resumedAt: now, mode: options?.mode || 'back' });
  await enqueueTask(taskId, { mode: options?.mode === 'front' ? 'front' : 'back' });
  return updated;
}
