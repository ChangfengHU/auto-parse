/**
 * 工作流任务存储 - 内存管理
 *
 * 埋点：统一前缀 [wf-task]，便于 grep / 日志平台检索。
 */

import type { WorkflowDef, NodeResult, NodeDef } from './types';
import { parseWorkflowStepErrorMessage } from './step-error-meta';
import {
  deleteWorkflowTaskRecord,
  loadWorkflowTask,
  persistWorkflowTask,
  persistWorkflowTaskDebounced,
} from './task-store-persist';

/** 服务端日志前缀（勿改，依赖方用 grep 定位） */
export const WF_TASK_LOG_PREFIX = '[wf-task]';

export function wfTaskDiag(event: string, data: Record<string, unknown> = {}): void {
  const line = {
    ts: new Date().toISOString(),
    pid: process.pid,
    nodeEnv: process.env.NODE_ENV ?? '',
    event,
    storeSize: typeof TASK_STORE !== 'undefined' ? TASK_STORE.size : -1,
    ...data,
  };
  console.log(WF_TASK_LOG_PREFIX, JSON.stringify(line));
}

export function wfTaskStoreSnapshot(): { storeSize: number; taskIdsSample: string[] } {
  return {
    storeSize: TASK_STORE.size,
    taskIdsSample: [...TASK_STORE.keys()].slice(0, 12),
  };
}

/** API 查询不到任务时调用：带上当前内存里有哪些 taskId（截断），便于区分「打错 id / 进程重启 / 热重载」 */
export function wfTaskLogLookupMiss(
  taskId: string,
  route: string,
  extra: Record<string, unknown> = {}
): void {
  const snap = wfTaskStoreSnapshot();
  wfTaskDiag('lookup.miss', {
    route,
    requestedTaskId: taskId,
    requestedLen: String(taskId ?? '').length,
    ...snap,
    ...extra,
  });
}

export interface WorkflowTaskStep {
  idx: number;
  nodeType: string;
  label?: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
  duration: number | null;
  logs: string[];
  screenshot?: string;
  output?: Record<string, unknown>;
  error?: string;
  /** 与 parseWorkflowStepErrorMessage / NodeResult 对齐 */
  errorCode?: string;
  errorMsg?: string;
  executedAt?: number;
}

export interface WorkflowTask {
  taskId: string;
  workflowId: string;
  workflow: WorkflowDef;
  status: 'running' | 'paused' | 'done' | 'error' | 'stopped';

  initialVars: Record<string, string>;
  finalVars: Record<string, string>;

  steps: WorkflowTaskStep[];
  currentStep: number;

  isError: boolean;
  errorMessage?: string;
  /** 从 errorMessage 解析或步骤失败时写入 */
  errorCode?: string;
  errorMsg?: string;
  failedStepIdx?: number;

  startedAt: number;
  completedAt?: number;
  stoppedAt?: number;

  totalDuration?: number;  // ms
}

// 内存存储：taskId -> Task（挂 globalThis，避免 Next dev 热重载清空 Map 导致「刚创建的任务立刻查不到」）
declare global {
  // eslint-disable-next-line no-var
  var __workflowTaskStore: Map<string, WorkflowTask> | undefined;
}

const TASK_STORE =
  globalThis.__workflowTaskStore ?? new Map<string, WorkflowTask>();
if (!globalThis.__workflowTaskStore) {
  globalThis.__workflowTaskStore = TASK_STORE;
}

wfTaskDiag('store.ready', {
  globalMapAttached: true,
  reusedGlobalMap: TASK_STORE === (globalThis.__workflowTaskStore ?? null),
});

export function createTask(
  taskId: string,
  workflowId: string,
  workflow: WorkflowDef,
  vars: Record<string, string>
): WorkflowTask {
  const task: WorkflowTask = {
    taskId,
    workflowId,
    workflow,
    status: 'running',
    initialVars: vars,
    finalVars: { ...vars },
    steps: workflow.nodes.map((node, idx) => ({
      idx,
      nodeType: node.type,
      label: node.label,
      status: 'pending',
      duration: null,
      logs: [],
      output: undefined,
      error: undefined,
    })),
    currentStep: 0,
    isError: false,
    startedAt: Date.now(),
  };

  TASK_STORE.set(taskId, task);
  persistWorkflowTask(task);
  wfTaskDiag('task.created', {
    taskId,
    workflowId,
    nodeCount: workflow.nodes.length,
    varKeyCount: Object.keys(vars).length,
    afterStoreSize: TASK_STORE.size,
  });
  return task;
}

export function getTask(taskId: string): WorkflowTask | null {
  const mem = TASK_STORE.get(taskId);
  if (mem) return mem;
  const fromDisk = loadWorkflowTask(taskId) as WorkflowTask | null;
  if (fromDisk) {
    TASK_STORE.set(taskId, fromDisk);
    wfTaskDiag('task.hydrated_from_disk', {
      taskId,
      status: fromDisk.status,
      workflowId: fromDisk.workflowId,
    });
  }
  return fromDisk;
}

export function updateTaskStatus(
  taskId: string,
  status: WorkflowTask['status'],
  isError?: boolean,
  errorMessage?: string
): void {
  const task = TASK_STORE.get(taskId);
  if (!task) {
    wfTaskDiag('task.updateStatus.skipped_no_task', { taskId, targetStatus: status });
    return;
  }

  const prev = task.status;
  task.status = status;
  if (isError !== undefined) task.isError = isError;
  if (errorMessage !== undefined) {
    task.errorMessage = errorMessage;
    const p = parseWorkflowStepErrorMessage(errorMessage);
    task.errorCode = p.error_code;
    task.errorMsg = p.error_msg;
  }
  if (status === 'done' || status === 'error' || status === 'stopped') {
    task.completedAt = Date.now();
    task.totalDuration = task.completedAt - task.startedAt;
  }
  wfTaskDiag('task.status', {
    taskId,
    prev,
    next: task.status,
    isError: task.isError,
    err: errorMessage ?? task.errorMessage ?? '',
  });
  persistWorkflowTask(task);
}

export function updateTaskStep(
  taskId: string,
  stepIdx: number,
  updates: Partial<WorkflowTaskStep>
): void {
  const task = TASK_STORE.get(taskId);
  if (!task || !task.steps[stepIdx]) return;

  task.steps[stepIdx] = { ...task.steps[stepIdx], ...updates };
  persistWorkflowTask(task);
}

export function updateTaskCurrentStep(taskId: string, stepIdx: number): void {
  const task = TASK_STORE.get(taskId);
  if (!task) return;
  task.currentStep = stepIdx;
  persistWorkflowTask(task);
}

export function addTaskLog(taskId: string, stepIdx: number, log: string): void {
  const task = TASK_STORE.get(taskId);
  if (!task || !task.steps[stepIdx]) return;

  task.steps[stepIdx].logs.push(log);
  persistWorkflowTaskDebounced(taskId, () => TASK_STORE.get(taskId));
}

export function setTaskStepRunning(taskId: string, stepIdx: number): void {
  const task = TASK_STORE.get(taskId);
  if (!task || !task.steps[stepIdx]) return;

  task.steps[stepIdx].status = 'running';
  task.steps[stepIdx].executedAt = Date.now();
  persistWorkflowTask(task);
}

export function setTaskStepSuccess(
  taskId: string,
  stepIdx: number,
  result: NodeResult,
  duration: number
): void {
  const task = TASK_STORE.get(taskId);
  if (!task || !task.steps[stepIdx]) return;

  task.steps[stepIdx].status = 'success';
  task.steps[stepIdx].duration = duration;
  task.steps[stepIdx].screenshot = result.screenshot;
  task.steps[stepIdx].output = result.output;
  persistWorkflowTask(task);
}

export function setTaskStepError(
  taskId: string,
  stepIdx: number,
  error: string,
  duration: number,
  meta?: { errorCode?: string; errorMsg?: string }
): void {
  const task = TASK_STORE.get(taskId);
  if (!task || !task.steps[stepIdx]) return;

  task.steps[stepIdx].status = 'error';
  task.steps[stepIdx].duration = duration;
  task.steps[stepIdx].error = error;
  const parsed = parseWorkflowStepErrorMessage(error);
  task.steps[stepIdx].errorCode = meta?.errorCode ?? parsed.error_code;
  task.steps[stepIdx].errorMsg = meta?.errorMsg ?? parsed.error_msg;
  if (task.failedStepIdx === undefined) {
    task.failedStepIdx = stepIdx;
  }
  persistWorkflowTask(task);
}

export function setTaskStepSkipped(taskId: string, stepIdx: number): void {
  const task = TASK_STORE.get(taskId);
  if (!task || !task.steps[stepIdx]) return;

  task.steps[stepIdx].status = 'skipped';
  task.steps[stepIdx].duration = 0;
  persistWorkflowTask(task);
}

export function setTaskFinalVars(taskId: string, vars: Record<string, string>): void {
  const task = TASK_STORE.get(taskId);
  if (!task) return;
  task.finalVars = vars;
  persistWorkflowTask(task);
}

export function stopTask(taskId: string, reason?: string): void {
  const task = TASK_STORE.get(taskId);
  if (!task) {
    wfTaskDiag('task.stop.skipped_no_task', { taskId, reason: reason ?? '' });
    return;
  }

  task.status = 'stopped';
  task.stoppedAt = Date.now();
  task.totalDuration = task.stoppedAt - task.startedAt;
  task.isError = true;
  task.errorMessage = reason || 'Task stopped by user';
  const sp = parseWorkflowStepErrorMessage(task.errorMessage);
  task.errorCode = sp.error_code;
  task.errorMsg = sp.error_msg;
  wfTaskDiag('task.stopped', { taskId, reason: task.errorMessage ?? '' });
  persistWorkflowTask(task);
}

export function deleteTask(taskId: string): void {
  const had = TASK_STORE.has(taskId);
  TASK_STORE.delete(taskId);
  deleteWorkflowTaskRecord(taskId);
  wfTaskDiag('task.deleted', { taskId, had, afterStoreSize: TASK_STORE.size });
}
