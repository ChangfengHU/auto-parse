import { randomUUID } from 'crypto';
import { DEFAULT_HUMAN_OPTIONS } from '@/lib/workflow/human-options';
import { getPersistentContext } from '@/lib/persistent-browser';
import { executeNode } from '@/lib/workflow/engine';
import { createSession, deleteSession, getSession, updateSession } from '@/lib/workflow/session-store';
import { chromium, type Browser, type Page } from 'playwright';
import type {
  NavigateParams,
  NodeDef,
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
  mediaUrls: string[];
  primaryMediaUrl: string | null;
  primaryMediaType?: 'image' | 'video' | 'unknown';
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

function inferMediaKindFromUrl(value: string): 'image' | 'video' | 'unknown' {
  const v = value.trim();
  if (!v.startsWith('http')) return 'unknown';
  if (/\.(png|jpg|jpeg|webp|gif|bmp|svg|avif)(\?|$)/i.test(v)) return 'image';
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(v)) return 'video';
  if (/image|img|picture|photo/i.test(v)) return 'image';
  if (/video|movie|clip/i.test(v)) return 'video';
  return v.includes('oss-') || v.includes('.aliyuncs.com') ? 'image' : 'unknown';
}

const INPUT_MEDIA_NODE_TYPES = new Set([
  'paste_image_clipboard',
  'file_upload',
]);

function collectStringsDeep(input: unknown, acc: Set<string>) {
  if (typeof input === 'string') {
    if (inferMediaKindFromUrl(input) !== 'unknown') acc.add(input.trim());
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

function collectMediaUrls(session: WorkflowSession): string[] {
  const urls = new Set<string>();
  for (const item of session.history) {
    if (INPUT_MEDIA_NODE_TYPES.has(item.nodeType as string)) continue;
    collectStringsDeep(item.result.output, urls);
  }
  if (urls.size > 0) return Array.from(urls);

  // Fallback: 某些工作流可能只把最终结果写回 vars，没有显式输出到 history。
  // 这里只读取“结果型”变量，避免把 sourceImageUrl/sourceImageUrls 之类的输入参考图带进去。
  collectStringsDeep(
    {
      mediaUrl: session.vars.mediaUrl,
      imageUrl: session.vars.imageUrl,
      videoUrl: session.vars.videoUrl,
      primaryMediaUrl: session.vars.primaryMediaUrl,
      primaryImageUrl: session.vars.primaryImageUrl,
    },
    urls
  );
  return Array.from(urls);
}

async function closeSessionPageSafely(session: WorkflowSession): Promise<'closed' | 'kept-last-tab' | 'none'> {
  const page = session._page;
  if (!page) return 'none';
  try {
    // AdsPower 场景：如果已经是该分身最后一个标签页，则不关闭，避免分身退回 Inactive。
    if (session._browser) {
      const openPages = page.context().pages().filter((p) => !p.isClosed());
      if (openPages.length <= 1) {
        return 'kept-last-tab';
      }
    }
    await page.close().catch(() => {});
    return 'closed';
  } catch {
    await page.close().catch(() => {});
    return 'closed';
  }
}

async function interruptSessionPage(session: WorkflowSession) {
  const page = session._page;
  if (!page || page.isClosed()) return;
  await page.close({ runBeforeUnload: false }).catch(() => {});
}

async function ensureRuntimePageForNode(input: {
  session: WorkflowSession;
  node: NodeDef;
  currentPage?: Page;
}): Promise<{ page: Page; tempBrowser?: Browser }> {
  if (input.currentPage) {
    return { page: input.currentPage };
  }

  const isAdsPowerNavigate =
    input.node.type === 'navigate' &&
    Boolean(((input.node.params ?? {}) as Partial<NavigateParams>).useAdsPower);
  if (isAdsPowerNavigate) {
    const tempBrowser = await chromium.launch({ headless: true });
    const page = await tempBrowser.newPage();
    return { page, tempBrowser };
  }

  const ctx = await getPersistentContext();
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  updateSession(input.session.id, { _page: page });
  input.session._page = page;
  return { page };
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
        await closeSessionPageSafely(session);
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

    const { page: stepPage, tempBrowser } = await ensureRuntimePageForNode({
      session,
      node,
      currentPage: runtimePage,
    });
    runtimePage = stepPage;

    let result: Awaited<ReturnType<typeof executeNode>>;
    try {
      result = await executeNode(runtimePage, node, ctx);
    } finally {
      if (tempBrowser) {
        await tempBrowser.close().catch(() => {});
      }
    }
    const cancelledAfterStep = taskStore().get(taskId)?.cancelRequested;
    if (cancelledAfterStep) {
      updateTask(taskId, { status: 'cancelled', endedAt: new Date().toISOString() });
      addCheckpoint(taskId, {
        stepIndex: i,
        name: node.label ?? node.type,
        status: 'cancelled',
        message: '任务已取消',
        timestamp: new Date().toISOString(),
      });
      if (session._page) {
        await interruptSessionPage(session);
      }
      if (taskStore().get(taskId)?.autoCloseTab) {
        deleteSession(session.id);
      }
      return;
    }
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
      if (taskStore().get(taskId)?.cancelRequested) {
        updateTask(taskId, {
          status: 'cancelled',
          endedAt: new Date().toISOString(),
        });
        if (session._page) {
          await interruptSessionPage(session);
        }
        if (taskStore().get(taskId)?.autoCloseTab) {
          deleteSession(session.id);
        }
        return;
      }
      updateTask(taskId, {
        status: 'failed',
        error: result.error ?? '节点执行失败',
        endedAt: new Date().toISOString(),
      });
      const failedTask = taskStore().get(taskId);
      if (failedTask?.autoCloseTab && session._page) {
        await closeSessionPageSafely(session);
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
  const mediaUrls = collectMediaUrls(finalSession);
  const imageUrls = mediaUrls.filter((url) => inferMediaKindFromUrl(url) === 'image');
  const primaryMediaUrl = mediaUrls[0] ?? null;
  const doneTask = updateTask(taskId, {
    status: 'success',
    endedAt: new Date().toISOString(),
    result: {
      mediaUrls,
      primaryMediaUrl,
      primaryMediaType: primaryMediaUrl ? inferMediaKindFromUrl(primaryMediaUrl) : 'unknown',
      imageUrls,
      primaryImageUrl: imageUrls[0] ?? null,
      outputs: finalSession.history.reduce((acc, h) => ({ ...acc, ...(h.result.output ?? {}) }), {}),
      vars: finalSession.vars,
      sessionId: finalSession.id,
    },
  });
  if (doneTask?.autoCloseTab && finalSession._page) {
    await closeSessionPageSafely(finalSession);
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
  const updated = updateTask(id, { cancelRequested: true });
  if (updated) {
    const session = getSession(updated.sessionId);
    if (session?._page) {
      void interruptSessionPage(session);
    }
  }
  return updated;
}
