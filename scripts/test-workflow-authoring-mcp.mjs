import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
function loader(mocks = {}, globals = {}) {
  const cache = new Map(), shared = {};
  function load(file) {
    if (file in mocks) return mocks[file];
    if (cache.has(file)) return cache.get(file).exports;
    const loadedModule = { exports: {} }; cache.set(file, loadedModule);
    const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const sandbox = { module: loadedModule, exports: loadedModule.exports, require: name => {
      if (name in mocks) return mocks[name];
      if (name.startsWith('.') || name.startsWith('@/')) {
        const target = (name.startsWith('@/') ? name.slice(2) : path.normalize(path.join(path.dirname(file), name))) + (name.endsWith('.ts') ? '' : '.ts');
        return load(target);
      }
      return require(name);
    }, global: shared, console, process, Buffer, URL, Request, Response, Headers, AbortSignal, setTimeout, clearTimeout, performance, structuredClone, crypto: globalThis.crypto, ...globals };
    vm.runInNewContext(source, sandbox, { filename: file });
    return loadedModule.exports;
  }
  return load;
}
const base = () => ({ id: 'draft', name: 'Test', vars: ['videoUrl'], nodes: [{ id: 'one', type: 'screenshot', params: {} }] });
const validation = loader()('lib/workflow/validation.ts');
test('workflow shape accepts drafts and rejects malformed nodes, variables and duplicate node IDs', () => {
  assert.equal(validation.validateWorkflow(base()).valid, true);
  assert.equal(validation.validateWorkflow({ ...base(), nodes: [] }).valid, true);
  for (const value of [null, [], { ...base(), nodes: {} }, { ...base(), vars: ['__proto__'] }, { ...base(), nodes: [{ type: 'unknown', params: {} }] }, { ...base(), nodes: [{ type: 'click', params: null }] }, { ...base(), nodes: [...base().nodes, ...base().nodes] }]) assert.equal(validation.validateWorkflow(value).valid, false);
});
test('wait configuration validates types and reports explicit continue policies', () => {
  assert.equal(validation.validateWorkflow({ ...base(), nodes: [{ type: 'click', params: {}, waitAfter: { enabled: true, timeout: -1 } }] }).valid, false);
  assert.equal(validation.validateWorkflow({ ...base(), nodes: [{ type: 'wait_condition', params: { timeoutAction: 'continue' } }] }).warnings.length, 1);
});
test('credentials are redacted recursively without stripping ordinary parameters', () => {
  const result = validation.redactWorkflowData({ nodes: [{ params: { adsApiKey: 'fixture-secret', password: 'fixture-password', title: 'public title', apiKey: '' } }] });
  assert.equal(JSON.stringify(result).includes('fixture-secret'), false);
  assert.equal(result.nodes[0].params.title, 'public title');
  assert.equal(result.nodes[0].params.apiKey, '');
});
test('protected original and approved publication copy cannot be mutated', () => {
  for (const id of ['douyin-publish', '34f421be-f97c-498a-9c80-5214564abd1c']) assert.throws(() => validation.assertWorkflowMutable(id), /protected/);
  assert.doesNotThrow(() => validation.assertWorkflowMutable('new-draft'));
});
function waiting({ text = '', visible = false, url = 'https://example.test/', invalidSelector = false } = {}) {
  let time = 0;
  const FakeDate = class extends Date { static now() { return time; } };
  const page = { url: () => url, waitForTimeout: async n => { time += n; }, locator: () => ({ innerText: async () => text, first: () => ({ isVisible: async () => { if (invalidSelector) throw Error('bad selector'); return visible; } }) }) };
  return { check: loader({}, { Date: FakeDate })('lib/workflow/wait-after.ts').checkWaitAfter, page };
}
test('unsatisfied positive postcondition fails rather than silently succeeding', async () => {
  const { check, page } = waiting();
  assert.equal((await check(page, { enabled: true, selector: '#ready', timeout: 1000 })).success, false);
});
test('failure keywords win even when a success URL matches', async () => {
  const { check, page } = waiting({ text: 'upload failed', url: 'https://example.test/done' });
  assert.equal((await check(page, { urlContains: 'done', failKeywords: ['failed'], timeout: 1000 })).success, false);
});
test('positive URL, visible element and keyword alternatives pass', async () => {
  for (const [input, config] of [[{ url: 'https://example.test/done' }, { urlContains: 'done' }], [{ visible: true }, { selector: '#ready' }], [{ text: 'ready' }, { successKeywords: ['ready'] }]]) {
    const { check, page } = waiting(input); assert.equal((await check(page, config)).success, true);
  }
});
test('delay-only and failure-only observation guards retain intended semantics', async () => {
  const { check, page } = waiting();
  assert.equal((await check(page, { delaySeconds: 1 })).success, true);
  assert.equal((await check(page, { failKeywords: ['failed'], timeout: 1000 })).success, true);
});
test('invalid selector is not proof of disappearance', async () => {
  const { check, page } = waiting({ invalidSelector: true });
  await assert.rejects(check(page, { selector: '[', action: 'disappeared' }), /bad selector/);
});
test('session operation mutex rejects overlap and releases safely', () => {
  const store = loader()('lib/workflow/session-store.ts');
  const release = store.acquireSessionOperation('session');
  assert.equal(typeof release, 'function'); assert.equal(store.acquireSessionOperation('session'), null);
  release(); const next = store.acquireSessionOperation('session'); assert.equal(typeof next, 'function');
  release(); assert.equal(store.acquireSessionOperation('session'), null); next();
});
test('screenshot capture failure cannot report success', async () => {
  const screenshot = loader({ 'lib/workflow/utils.ts': { captureScreenshot: async () => undefined } })('lib/workflow/nodes/screenshot.ts');
  assert.equal((await screenshot.executeScreenshot({}, {}, {})).success, false);
});
const contract = loader()('lib/workflow/mcp-contract.ts');
const env = { AUTO_PARSE_ADMIN_TOKEN: 'fixture-admin-credential-not-real' };
const token = contract.workflowMcpToken(env);
test('MCP token is endpoint-specific, fails closed and checks browser Origin', () => {
  const req = (authorization, origin) => new Request('https://auto-parse-v2.vyibc.com/api/workflows/mcp', { headers: { ...(authorization ? { authorization } : {}), ...(origin ? { origin } : {}) } });
  assert.equal(contract.authorizeWorkflowMcp(req(), {}), 503);
  assert.equal(contract.authorizeWorkflowMcp(req(), env), 401);
  assert.equal(contract.authorizeWorkflowMcp(req('Bearer '+env.AUTO_PARSE_ADMIN_TOKEN), env), 401);
  assert.equal(contract.authorizeWorkflowMcp(req('Bearer '+token), env), 200);
  assert.equal(contract.authorizeWorkflowMcp(req('Bearer '+token, 'https://evil.test'), env), 403);
});
test('tool arguments are validated server-side, including nested types and required confirmations', () => {
  const def = contract.WORKFLOW_MCP_TOOLS.find(x => x.name === 'workflow_run_step').inputSchema;
  const input = { sessionId: 's', requestId: 'r', expectedRevision: 0, confirmExecution: true };
  assert.equal(contract.validToolArguments(def, input), true);
  for (const bad of [{ ...input, confirmExecution: false }, { ...input, expectedRevision: '0' }, { ...input, extra: true }, { ...input, expectedRevision: -1 }]) assert.equal(contract.validToolArguments(def, bad), false);
});
test('workflow update uses an atomic database revision predicate', async () => {
  let patchUrl, patchBody;
  const workflow = { ...base(), updated_at: '2026-10-17T00:00:00Z', created_at: '2026-10-17T00:00:00Z' };
  const load = loader({}, { process: { env: { SUPABASE_URL: 'https://db.example.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture' } }, fetch: async (url, options) => {
    if (options?.method === 'PATCH') { patchUrl = String(url); patchBody = JSON.parse(options.body); return Response.json([]); }
    return Response.json([workflow]);
  } });
  await assert.rejects(load('lib/workflow/workflow-db.ts').updateWorkflow('draft', { name: 'changed' }, '2026-10-17T00:00:00Z'), /revision_conflict/);
  assert.equal(new URL(patchUrl).searchParams.get('updated_at'), 'eq.2026-10-17T00:00:00Z');
  assert.equal(patchBody.name, 'changed');
});
test('MCP protocol initialize, notifications, tools and image blocks', async () => {
  let calls = 0;
  const load = loader({ 'lib/workflow/mcp-service.ts': { callWorkflowTool: async () => { calls++; return { screenshot: 'data:image/png;base64,YWJj', ok: true }; } } }, { process: { env } });
  const route = load('app/api/workflows/mcp/route.ts');
  const request = body => new Request('https://auto-parse-v2.vyibc.com/api/workflows/mcp', { method: 'POST', headers: { authorization: 'Bearer '+token, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) });
  const init = await (await route.POST(request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 'future' } }))).json();
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal((await route.POST(request({ jsonrpc: '2.0', method: 'notifications/initialized' }))).status, 202);
  const result = await (await route.POST(request({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'workflow_get_session', arguments: { sessionId: 's' } } }))).json();
  assert.equal(result.result.content[1].type, 'image'); assert.equal(result.result.content[0].text.includes('YWJj'), false); assert.equal(calls, 1);
  const rejected = await (await route.POST(request({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'workflow_run_step', arguments: {} } }))).json();
  assert.equal(rejected.error.code, -32602); assert.equal(calls, 1);
});
test('managed debug preserves task tab ownership, request deduplication and browser lease', async () => {
  let executions = 0, released = 0, closed = 0, complete;
  const blocked = new Promise(resolve => { complete = resolve; });
  const page = { close: async () => { closed++; }, isClosed: () => false };
  const load = loader({
    playwright: { chromium: { connectOverCDP: async () => ({ contexts: () => [{ newPage: async () => page }], close: async () => {} }) } },
    'lib/workflow/workflow-db.ts': { getWorkflow: async () => base() },
    'lib/workflow/browser-activity.ts': { acquireManagedBrowserActivity: async () => async () => { released++; } },
    'lib/workflow/engine.ts': { executeNode: async () => { executions++; await blocked; return { success: true, log: [] }; } },
  });
  const service = load('lib/workflow/mcp-service.ts');
  const opened = await service.callWorkflowTool('workflow_open_session', { workflowId: 'draft', browserInstance: 1, confirmBrowserControl: true });
  const input = { sessionId: opened.sessionId, expectedRevision: 0, requestId: 'stable', confirmExecution: true };
  const first = await service.callWorkflowTool('workflow_run_step', input);
  const again = await service.callWorkflowTool('workflow_run_step', input);
  assert.equal(first.operation.id, again.operation.id); assert.equal(again.reused, true); assert.equal(executions, 1);
  await assert.rejects(service.callWorkflowTool('workflow_run_step', { ...input, requestId: 'overlap' }), /busy/);
  await assert.rejects(service.callWorkflowTool('workflow_run_step', { ...input, confirmExecution: false }), /requestId_conflict/);
  complete(); await delay(5);
  await service.callWorkflowTool('workflow_close_session', { sessionId: opened.sessionId });
  assert.equal(released, 1); assert.equal(closed, 1);
});

test('saving excludes edits and execution, and closing defers lease cleanup until save completes', async () => {
  let complete, released = 0;
  const blocked = new Promise(resolve => { complete = resolve; });
  const page = { close: async () => {}, isClosed: () => false };
  const load = loader({
    playwright: { chromium: { connectOverCDP: async () => ({ contexts: () => [{ newPage: async () => page }], close: async () => {} }) } },
    'lib/workflow/workflow-db.ts': { getWorkflow: async () => base(), updateWorkflow: async () => { await blocked; return base(); } },
    'lib/workflow/browser-activity.ts': { acquireManagedBrowserActivity: async () => async () => { released++; } },
    'lib/workflow/engine.ts': { executeNode: async () => { throw Error('must_not_execute'); } },
  });
  const service = load('lib/workflow/mcp-service.ts');
  const opened = await service.callWorkflowTool('workflow_open_session', { workflowId: 'draft', browserInstance: 1, confirmBrowserControl: true });
  const input = { sessionId: opened.sessionId, expectedRevision: 0 };
  const saving = service.callWorkflowTool('workflow_save_session', { ...input, expectedUpdatedAt: 'revision-one' });
  await assert.rejects(service.callWorkflowTool('workflow_set_session_nodes', { ...input, nodes: base().nodes }), /busy/);
  await assert.rejects(service.callWorkflowTool('workflow_run_step', { ...input, requestId: 'do-not-run', confirmExecution: true }), /busy/);
  const closing = await service.callWorkflowTool('workflow_close_session', { sessionId: opened.sessionId });
  assert.equal(closing.status, 'stopping'); assert.equal(released, 0);
  complete(); await saving;
  assert.equal(released, 1);
});

test('completed prefix tolerates JSON object key order but rejects actual edits', async () => {
  const page = { close: async () => {}, isClosed: () => false };
  const load = loader({
    playwright: { chromium: { connectOverCDP: async () => ({ contexts: () => [{ newPage: async () => page }], close: async () => {} }) } },
    'lib/workflow/workflow-db.ts': { getWorkflow: async () => base() },
    'lib/workflow/browser-activity.ts': { acquireManagedBrowserActivity: async () => async () => {} },
    'lib/workflow/engine.ts': { executeNode: async () => ({ success: true, log: [] }) },
  });
  const service = load('lib/workflow/mcp-service.ts');
  const opened = await service.callWorkflowTool('workflow_open_session', { workflowId: 'draft', browserInstance: 1, confirmBrowserControl: true });
  await service.callWorkflowTool('workflow_run_step', { sessionId: opened.sessionId, expectedRevision: 0, requestId: 'ordered-prefix', confirmExecution: true });
  await delay(10);
  const state = await service.callWorkflowTool('workflow_get_session', {sessionId:opened.sessionId,includeScreenshot:false}).catch(()=>null);
  // The page mock intentionally has no DOM observation; runtime revision is one after completion.
  const nodes = [{params:{},type:'screenshot',id:'one'},{id:'next',type:'screenshot',params:{}}];
  const changed = await service.callWorkflowTool('workflow_set_session_nodes', {sessionId:opened.sessionId,expectedRevision:state?.sessionRevision ?? 1,nodes});
  await assert.rejects(service.callWorkflowTool('workflow_set_session_nodes', {sessionId:opened.sessionId,expectedRevision:changed.sessionRevision,nodes:[{...nodes[0],label:'tampered'},nodes[1]]}),/completed_nodes_are_frozen/);
  await service.callWorkflowTool('workflow_close_session',{sessionId:opened.sessionId});
});
