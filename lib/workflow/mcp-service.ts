import { createHash, randomUUID } from 'node:crypto';
import { chromium, type Browser, type Page } from 'playwright';
import { NODE_CATALOG } from './node-catalog';
import { createWorkflow, copyWorkflow, getWorkflow, listWorkflowsPage, updateWorkflow } from './workflow-db';
import { assertWorkflowMutable, assertWorkflowShape, isRecord, redactWorkflowData, validateWorkflow, WorkflowInputError } from './validation';
import { createSession, getSession, deleteSession, updateSession, acquireSessionOperation } from './session-store';
import { acquireManagedBrowserActivity } from './browser-activity';
import { executeNode } from './engine';
import { captureScreenshot } from './utils';
import { DEFAULT_HUMAN_OPTIONS } from './human-options';
import type { NodeDef, WorkflowSession } from './types';

const DEBUG_TYPES = new Set(['material', 'navigate', 'click', 'text_input', 'press_hotkey', 'scroll', 'file_upload', 'wait_condition', 'screenshot', 'qrcode']);
const IDLE_MS = 20 * 60 * 1000;
type Operation = { id: string; fingerprint: string; status: 'running' | 'done' | 'error' | 'stopped'; error?: string };
type ManagedSession = { browser: Browser; release: () => Promise<void>; port: number; revision: number; expiresAt: number; timer?: ReturnType<typeof setTimeout>; stopped: boolean; closing: boolean; saving?: boolean; operation?: Operation; requests: Map<string, Operation> };
declare global { var __workflowMcpSessions: Map<string, ManagedSession> | undefined; }
const sessions = () => global.__workflowMcpSessions ??= new Map<string, ManagedSession>();
function fail(message: string): never { throw new WorkflowInputError(message); }
function str(value: unknown, field: string) { if (typeof value !== 'string' || !value.trim()) fail(`${field}_required`); return value; }
function vars(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value) || Object.entries(value).some(([k, v]) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(k) || typeof v !== 'string')) fail('vars_must_be_string_map');
  return value as Record<string, string>;
}
function managed(id: string) {
  const runtime = sessions().get(id), session = getSession(id);
  if (!runtime || !session) fail('session_not_found_or_process_restarted_do_not_repeat_unknown_actions');
  if (runtime.closing) fail('session_closing');
  touch(id, runtime);
  return { runtime, session };
}
function touch(id: string, runtime: ManagedSession) {
  if (runtime.timer) clearTimeout(runtime.timer);
  runtime.expiresAt = Date.now() + IDLE_MS;
  runtime.timer = setTimeout(() => {
    if (runtime.operation?.status === 'running' || runtime.saving) { touch(id, runtime); return; }
    void dispose(id);
  }, IDLE_MS);
  runtime.timer.unref?.();
}
async function dispose(id: string) {
  const runtime = sessions().get(id);
  if (!runtime) return;
  runtime.closing = true; runtime.stopped = true;
  if (runtime.timer) clearTimeout(runtime.timer);
  const session = getSession(id);
  session?._idleSim?.stop();
  await session?._page?.close().catch(() => {});
  if (runtime.operation?.status === 'running' || runtime.saving) return; // operation finally releases after cleanup
  await runtime.browser.close().catch(() => {});
  await runtime.release();
  deleteSession(id); sessions().delete(id);
}
function editable(id: string, revision: unknown) {
  const found = managed(id);
  if (found.runtime.operation?.status === 'running' || found.runtime.saving) fail('session_busy');
  if (revision !== found.runtime.revision) fail('session_revision_conflict_read_again');
  return found;
}
function assertExecutable(node: NodeDef) {
  if (node.disabled) return;
  if (!DEBUG_TYPES.has(node.type)) fail(`debug_node_not_supported_${node.type}`);
  if (node.type === 'click' && node.params.douyinPublication) fail('use_dedicated_douyin_publication_api');
  // Credentials belong to the server, never inline in an AI-authored definition.
  const clean = redactWorkflowData(node);
  if (JSON.stringify(clean) !== JSON.stringify(node)) fail('inline_credentials_not_allowed');
}
function snapshot(session: WorkflowSession, runtime: ManagedSession) {
  return {
    sessionId: session.id, workflowId: session.workflowId, sessionRevision: runtime.revision,
    updatedAt: session.workflow.updatedAt, browserInstance: runtime.port - 9221,
    currentStep: session.currentStep, totalSteps: session.workflow.nodes.length,
    status: runtime.stopped ? 'stopped' : runtime.operation?.status === 'running' ? 'running' : session.status, saving: Boolean(runtime.saving), operation: runtime.operation,
    expiresAt: runtime.expiresAt, vars: session.vars,
    history: session.history.map(h => ({ ...h, result: { success: h.result.success, error: h.result.error, log: h.result.log, output: h.result.output, durationMs: h.result.durationMs, stepSkipped: h.result.stepSkipped } })),
  };
}

async function startOperation(input: Record<string, unknown>, runAll: boolean) {
  const id = str(input.sessionId, 'sessionId');
  const { runtime, session } = managed(id);
  const requestId = str(input.requestId, 'requestId');
  if (requestId.length > 128) fail('requestId_too_long');
  const fingerprint = createHash('sha256').update(JSON.stringify({ input, runAll })).digest('hex');
  const old = runtime.requests.get(requestId);
  if (old) { if (old.fingerprint !== fingerprint) fail('requestId_conflict'); return { ...snapshot(session, runtime), operation: old, reused: true }; }
  editable(id, input.expectedRevision);
  if (runtime.stopped) fail('session_stopped_create_new_session_after_review');
  if (input.confirmExecution !== true) fail('confirmExecution_required_actions_may_modify_account');
  if (runtime.requests.size >= 200) fail('session_operation_limit_reached');
  const start = session.currentStep;
  if (start >= session.workflow.nodes.length) fail('no_pending_nodes');
  const selected = runAll ? session.workflow.nodes.slice(start) : [session.workflow.nodes[start]];
  selected.forEach(assertExecutable);
  const release = acquireSessionOperation(id);
  if (!release) fail('session_busy');
  const operation: Operation = { id: randomUUID(), fingerprint, status: 'running' };
  runtime.requests.set(requestId, operation); runtime.operation = operation;
  updateSession(id, { status: 'running' });
  // The client polls the operation; a transport disconnect must not replay an upload.
  void (async () => {
    try {
      for (let index = start; index < start + selected.length; index++) {
        if (runtime.stopped) { operation.status = 'stopped'; break; }
        const current = getSession(id)!;
        const original = current.workflow.nodes[index];
        // Bind every node to the session's task-owned page; no second CDP/AdsPower browser.
        const node = original.type === 'navigate' ? { ...original, params: { ...original.params, useAdsPower: false, adsManualCdpUrl: '', postClickEnabled: original.params.postClickEnabled ?? false } } : original;
        const context = { vars: { ...current.vars }, outputs: Object.assign({}, ...current.history.map(h => h.result.output ?? {})) };
        const result = await executeNode(current._page!, node, context);
        const failed = !result.success && !node.continueOnError;
        const nextStep = failed ? index : index + 1;
        updateSession(id, {
          vars: context.vars, currentStep: nextStep, lastExecutedStep: index,
          status: failed ? 'error' : nextStep === current.workflow.nodes.length ? 'done' : 'paused',
          history: [...current.history, { stepIndex: index, nodeType: node.type, label: node.label, result, executedAt: Date.now(), durationMs: result.durationMs }],
        });
        runtime.revision++;
        if (failed) { operation.status = 'error'; operation.error = result.error; break; }
      }
      if (operation.status === 'running') operation.status = runtime.stopped ? 'stopped' : 'done';
    } catch (error) {
      operation.status = runtime.stopped ? 'stopped' : 'error';
      operation.error = error instanceof Error ? error.message : 'workflow_execution_failed';
      updateSession(id, { status: 'error' });
    } finally {
      release();
      if (runtime.closing) await dispose(id); else touch(id, runtime);
    }
  })();
  return snapshot(getSession(id)!, runtime);
}

export async function callWorkflowTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  if (name === 'workflow_capabilities') return {
    owner: 'auto-parse', source: 'supabase', editor: '/workflows', debugSupportedNodes: [...DEBUG_TYPES],
    managedBrowserInstances: [1, 2], sessionIdleMinutes: 20, sessionSurvivesRestart: false,
    execution: 'task-owned tab, cross-process activity lock, async step/run and screenshot polling',
    publication: 'No implicit approval. Confirm execution only for user-authorized effects. Use the dedicated guarded Douyin API for Douyin publication.',
  };
  if (name === 'workflow_node_catalog') return NODE_CATALOG.filter(n => !input.type || n.type === input.type).map(n => ({ ...n, debugSupported: DEBUG_TYPES.has(n.type) }));
  if (name === 'workflow_list') {
    const page = await listWorkflowsPage({ page: Number(input.page || 1), limit: Number(input.limit || 20), q: typeof input.query === 'string' ? input.query : undefined });
    return { ...page, items: page.items.map(w => ({ id: w.id, name: w.name, description: w.description, updatedAt: w.updated_at, nodeCount: w.nodes?.length ?? 0 })) };
  }
  if (name === 'workflow_get') { const found = await getWorkflow(str(input.workflowId, 'workflowId')); if (!found) fail('workflow_not_found'); return found; }
  if (name === 'workflow_validate') return validateWorkflow(input.workflow);
  if (name === 'workflow_create') {
    assertWorkflowShape(input.workflow);
    if (JSON.stringify(redactWorkflowData(input.workflow)) !== JSON.stringify(input.workflow)) fail('inline_credentials_not_allowed');
    return createWorkflow({ ...input.workflow, id: undefined });
  }
  if (name === 'workflow_copy') return copyWorkflow(str(input.workflowId, 'workflowId'));
  if (name === 'workflow_update') {
    if (!isRecord(input.patch)) fail('patch_required');
    if (JSON.stringify(input.patch).includes('[REDACTED]') || JSON.stringify(redactWorkflowData(input.patch)) !== JSON.stringify(input.patch)) fail('do_not_write_redacted_or_inline_credentials');
    return updateWorkflow(str(input.workflowId, 'workflowId'), input.patch, str(input.expectedUpdatedAt, 'expectedUpdatedAt'));
  }
  if (name === 'workflow_open_session') {
    if (input.confirmBrowserControl !== true) fail('confirmBrowserControl_required');
    if (![1, 2].includes(Number(input.browserInstance))) fail('browserInstance_must_be_1_or_2');
    const workflowId = str(input.workflowId, 'workflowId'); assertWorkflowMutable(workflowId);
    const workflow = await getWorkflow(workflowId); if (!workflow) fail('workflow_not_found');
    assertWorkflowShape(workflow);
    const initialVars = vars(input.vars);
    const port = 9221 + Number(input.browserInstance);
    const release = await acquireManagedBrowserActivity(`http://127.0.0.1:${port}`);
    let browser: Browser | undefined;
    let page: Page | undefined;
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15000 });
      const context = browser.contexts()[0]; if (!context) fail('browser_context_missing');
      page = await context.newPage();
      const session = createSession({ workflowId, workflow, vars: initialVars, humanOptions: { ...DEFAULT_HUMAN_OPTIONS, idleSimulation: false, randomDelay: false }, lastExecutedStep: null, _page: page, _browser: browser, _managedByMcp: true });
      const runtime: ManagedSession = { browser, release, port, revision: 0, expiresAt: 0, stopped: false, closing: false, requests: new Map() };
      sessions().set(session.id, runtime); touch(session.id, runtime);
      return snapshot(session, runtime);
    } catch (error) { await page?.close().catch(() => {}); await browser?.close().catch(() => {}); await release(); throw error; }
  }
  if (name === 'workflow_run_step' || name === 'workflow_run') return startOperation(input, name === 'workflow_run');
  const id = str(input.sessionId, 'sessionId');
  const { runtime, session } = managed(id);
  if (name === 'workflow_get_session') {
    let observation: unknown;
    if (session._page && !session._page.isClosed()) observation = await session._page.evaluate(() => ({
      url: location.origin + location.pathname, title: document.title, text: document.body.innerText.slice(0,10000),
      fields: Array.from(document.querySelectorAll('input:not([type=password]),textarea,[contenteditable=true],button')).slice(0,100).map(e => ({ tag: e.tagName, type: e.getAttribute('type'), placeholder: e.getAttribute('placeholder'), id: e.id, className: e.getAttribute('class'), role: e.getAttribute('role'), text: e.tagName === 'BUTTON' ? e.textContent?.slice(0,100) : undefined })),
    })).catch(() => ({ error: 'page_unavailable' }));
    return { ...snapshot(session, runtime), observation, screenshot: input.includeScreenshot === false || !session._page ? undefined : await captureScreenshot(session._page) };
  }
  if (name === 'workflow_set_session_nodes') {
    editable(id, input.expectedRevision);
    const next = { ...session.workflow, nodes: input.nodes };
    assertWorkflowShape(next);
    if (JSON.stringify(next.nodes.slice(0, session.currentStep)) !== JSON.stringify(session.workflow.nodes.slice(0, session.currentStep))) fail('completed_nodes_are_frozen_open_new_session_to_retest');
    if (JSON.stringify(redactWorkflowData(next.nodes)) !== JSON.stringify(next.nodes)) fail('inline_credentials_not_allowed');
    updateSession(id, { workflow: next, vars: input.vars === undefined ? session.vars : { ...session.vars, ...vars(input.vars) } });
    runtime.revision++;
    return snapshot(getSession(id)!, runtime);
  }
  if (name === 'workflow_save_session') {
    editable(id, input.expectedRevision);
    const expectedUpdatedAt = str(input.expectedUpdatedAt, 'expectedUpdatedAt');
    const release = acquireSessionOperation(id);
    if (!release) fail('session_busy');
    runtime.saving = true;
    try {
      const saved = await updateWorkflow(session.workflowId, session.workflow, expectedUpdatedAt);
      updateSession(id, { workflow: saved }); runtime.revision++;
      return { workflow: saved, sessionRevision: runtime.revision };
    } finally {
      runtime.saving = false; release();
      if (runtime.closing) await dispose(id); else touch(id, runtime);
    }
  }
  if (name === 'workflow_stop' || name === 'workflow_close_session') {
    await dispose(id);
    return { sessionId: id, status: sessions().has(id) ? 'stopping' : 'closed', note: 'Only the task tab is closed; never the logged-in browser. Uncertain external effects must be reconciled before retry.' };
  }
  fail('unknown_tool');
}
