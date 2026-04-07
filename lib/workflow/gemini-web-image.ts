import { randomUUID } from 'crypto';
import { DEFAULT_HUMAN_OPTIONS } from '@/lib/workflow/human-options';
import { getPersistentContext } from '@/lib/persistent-browser';
import { executeNode } from '@/lib/workflow/engine';
import { createSession, deleteSession, getSession, updateSession } from '@/lib/workflow/session-store';
import type {
  NavigateParams,
  StepHistory,
  WorkflowContext,
  WorkflowDef,
  WorkflowSession,
} from '@/lib/workflow/types';

type TaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
type CheckpointStatus = 'running' | 'ok' | 'error' | 'cancelled';

interface TaskCheckpoint {
  stepIndex: number;
  name: string;
  status: CheckpointStatus;
  message: string;
  timestamp: string;
}

interface TaskResult {
  imageUrls: string[];
  primaryImageUrl: string | null;
  outputs: Record<string, unknown>;
  vars: Record<string, string>;
  sessionId: string;
}

export interface GeminiWebImageTask {
  id: string;
  workflowId: string;
  workflowName: string;
  sessionId: string;
  prompt: string;
  status: TaskStatus;
  error?: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  cancelRequested: boolean;
  autoCloseTab: boolean;
  checkpoints: TaskCheckpoint[];
  result?: TaskResult;
}

declare global {
  var __geminiWebImageTasks: Map<string, GeminiWebImageTask> | undefined;
}

function taskStore(): Map<string, GeminiWebImageTask> {
  if (!global.__geminiWebImageTasks) {
    global.__geminiWebImageTasks = new Map();
  }
  return global.__geminiWebImageTasks;
}

function shouldDeferNativePage(workflow: WorkflowDef): boolean {
  const firstNode = workflow.nodes[0];
  if (!firstNode || firstNode.type !== 'navigate') return false;
  const params = (firstNode.params ?? {}) as Partial<NavigateParams>;
  return !!params.useAdsPower;
}

function updateTask(id: string, patch: Partial<GeminiWebImageTask>): GeminiWebImageTask | undefined {
  const current = taskStore().get(id);
  if (!current) return undefined;
  const next = { ...current, ...patch };
  taskStore().set(id, next);
  return next;
}

function addCheckpoint(taskId: string, checkpoint: TaskCheckpoint) {
  const task = taskStore().get(taskId);
  if (!task) return;
  updateTask(taskId, { checkpoints: [...task.checkpoints, checkpoint] });
}

function looksLikeImageUrl(value: string): boolean {
  const v = value.trim();
  if (!v.startsWith('http')) return false;
  if (/\.(png|jpg|jpeg|webp|gif|bmp|svg)(\?|$)/i.test(v)) return true;
  if (v.includes('oss-') || v.includes('.aliyuncs.com')) return true;
  return /image|img|picture|photo/i.test(v);
}

function collectStringsDeep(input: unknown, acc: Set<string>) {
  if (typeof input === 'string') {
    if (looksLikeImageUrl(input)) acc.add(input.trim());
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

function collectImageUrls(session: WorkflowSession): string[] {
  const urls = new Set<string>();
  for (const item of session.history) {
    collectStringsDeep(item.result.output, urls);
  }
  collectStringsDeep(session.vars, urls);
  return Array.from(urls);
}

async function runTask(taskId: string) {
  const task = taskStore().get(taskId);
  if (!task) return;
  const session = getSession(task.sessionId);
  if (!session) {
    const final = updateTask(taskId, {
      status: 'failed',
      error: 'Session not found',
      endedAt: new Date().toISOString(),
    });
    if (final?.autoCloseTab) deleteSession(task.sessionId);
    return;
  }

  updateTask(taskId, { status: 'running', startedAt: new Date().toISOString() });

  let runtimePage = session._page;
  if (!runtimePage) {
    const ctx = await getPersistentContext();
    runtimePage = await ctx.newPage();
    runtimePage.on('dialog', d => d.accept());
    updateSession(session.id, { _page: runtimePage });
    session._page = runtimePage;
  }

  for (let i = session.currentStep; i < session.workflow.nodes.length; i++) {
    const freshTask = taskStore().get(taskId);
    if (!freshTask) return;
    if (freshTask.cancelRequested) {
      updateTask(taskId, { status: 'cancelled', endedAt: new Date().toISOString() });
      addCheckpoint(taskId, {
        stepIndex: i,
        name: session.workflow.nodes[i]?.label ?? session.workflow.nodes[i]?.type ?? `step-${i + 1}`,
        status: 'cancelled',
        message: '任务已取消',
        timestamp: new Date().toISOString(),
      });
      if (freshTask.autoCloseTab && session._page) {
        await session._page.close().catch(() => {});
        deleteSession(session.id);
      }
      return;
    }

    const node = session.workflow.nodes[i];
    if (!node) break;

    addCheckpoint(taskId, {
      stepIndex: i,
      name: node.label ?? node.type,
      status: 'running',
      message: `执行步骤 ${i + 1}/${session.workflow.nodes.length}`,
      timestamp: new Date().toISOString(),
    });

    updateSession(session.id, { status: 'running', currentStep: i });
    const ctx: WorkflowContext = {
      vars: { ...session.vars, __pauseToken: session.id },
      outputs: session.history.reduce((acc, h) => ({ ...acc, ...(h.result.output ?? {}) }), {}),
      humanOptions: session.humanOptions,
    };

    const result = await executeNode(runtimePage, node, ctx);
    const nextVars = Object.fromEntries(
      Object.entries(ctx.vars).filter(([key]) => key !== '__pauseToken')
    );

    if (result.newPage) {
      runtimePage = result.newPage as typeof runtimePage;
      updateSession(session.id, { _page: runtimePage, _browser: result.newBrowser as WorkflowSession['_browser'] });
      session._page = runtimePage;
      session._browser = result.newBrowser as WorkflowSession['_browser'];
    }

    const historyEntry: StepHistory = {
      stepIndex: i,
      nodeType: node.type,
      label: node.label,
      result,
      executedAt: Date.now(),
    };

    const nextStep = i + 1;
    const done = nextStep >= session.workflow.nodes.length;
    const failed = !result.success && !node.continueOnError;

    const nextHistory = [...session.history, historyEntry];
    updateSession(session.id, {
      vars: nextVars,
      currentStep: failed ? i : nextStep,
      lastExecutedStep: i,
      status: failed ? 'error' : done ? 'done' : 'paused',
      history: nextHistory,
    });
    session.vars = nextVars;
    session.history = nextHistory;
    session.currentStep = failed ? i : nextStep;
    session.lastExecutedStep = i;
    session.status = failed ? 'error' : done ? 'done' : 'paused';

    addCheckpoint(taskId, {
      stepIndex: i,
      name: node.label ?? node.type,
      status: failed ? 'error' : 'ok',
      message: failed ? (result.error ?? '步骤失败') : '步骤完成',
      timestamp: new Date().toISOString(),
    });

    if (failed) {
      updateTask(taskId, {
        status: 'failed',
        error: result.error ?? '节点执行失败',
        endedAt: new Date().toISOString(),
      });
      const failedTask = taskStore().get(taskId);
      if (failedTask?.autoCloseTab && session._page) {
        await session._page.close().catch(() => {});
        deleteSession(session.id);
      }
      return;
    }
  }

  const finalSession = getSession(task.sessionId);
  if (!finalSession) {
    const final = updateTask(taskId, {
      status: 'failed',
      error: 'Session lost after execution',
      endedAt: new Date().toISOString(),
    });
    if (final?.autoCloseTab) deleteSession(task.sessionId);
    return;
  }
  const imageUrls = collectImageUrls(finalSession);
  const doneTask = updateTask(taskId, {
    status: 'success',
    endedAt: new Date().toISOString(),
    result: {
      imageUrls,
      primaryImageUrl: imageUrls[0] ?? null,
      outputs: finalSession.history.reduce((acc, h) => ({ ...acc, ...(h.result.output ?? {}) }), {}),
      vars: finalSession.vars,
      sessionId: finalSession.id,
    },
  });
  if (doneTask?.autoCloseTab && finalSession._page) {
    await finalSession._page.close().catch(() => {});
    deleteSession(finalSession.id);
  }
}

export async function createGeminiWebImageTask(input: {
  workflow: WorkflowDef;
  vars: Record<string, string>;
  prompt: string;
  autoCloseTab?: boolean;
}): Promise<GeminiWebImageTask> {
  const session = createSession({
    workflowId: input.workflow.id,
    workflow: input.workflow,
    vars: input.vars,
    humanOptions: DEFAULT_HUMAN_OPTIONS,
    lastExecutedStep: null,
  });

  if (!shouldDeferNativePage(input.workflow)) {
    const ctx = await getPersistentContext();
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    updateSession(session.id, { _page: page } as Partial<typeof session>);
  }

  const task: GeminiWebImageTask = {
    id: randomUUID(),
    workflowId: input.workflow.id,
    workflowName: input.workflow.name,
    sessionId: session.id,
    prompt: input.prompt,
    status: 'queued',
    createdAt: new Date().toISOString(),
    cancelRequested: false,
    autoCloseTab: input.autoCloseTab !== false,
    checkpoints: [],
  };
  taskStore().set(task.id, task);
  setTimeout(() => {
    runTask(task.id).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      updateTask(task.id, {
        status: 'failed',
        error: message,
        endedAt: new Date().toISOString(),
      });
    });
  }, 0);
  return task;
}

export function getGeminiWebImageTask(id: string): GeminiWebImageTask | undefined {
  return taskStore().get(id);
}

export function cancelGeminiWebImageTask(id: string): GeminiWebImageTask | undefined {
  const task = getGeminiWebImageTask(id);
  if (!task) return undefined;
  if (task.status === 'success' || task.status === 'failed' || task.status === 'cancelled') return task;
  return updateTask(id, { cancelRequested: true });
}
