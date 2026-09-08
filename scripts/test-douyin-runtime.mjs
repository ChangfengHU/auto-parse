import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';

const clean = source => stripTypeScriptTypes(source, { mode: 'transform' }).replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const runtimeSource = clean(await readFile(new URL('../lib/workflow/douyin-runtime.ts', import.meta.url), 'utf8'));
const cli = await readFile(new URL('../lib/workflow/workflow-task-cli.ts', import.meta.url), 'utf8');
const startSource = clean(cli.slice(cli.indexOf('async function startWorkflowAsync('), cli.indexOf('\nfunction buildTaskProgress(')));
const publish = { type: 'douyin_publish', params: {} };

test('failed workflow step persists its diagnostic screenshot', async () => {
  const source = await readFile(new URL('../lib/workflow/task-store.ts', import.meta.url), 'utf8');
  const fn = clean(source.slice(source.indexOf('export function setTaskStepError('), source.indexOf('export function setTaskStepSkipped(')));
  const task = { steps: [{}] };
  let persisted = false;
  const sandbox = { TASK_STORE: new Map([['task', task]]),
    parseWorkflowStepErrorMessage: () => ({ error_code: 'ERROR', error_msg: 'failed' }),
    persistWorkflowTask: value => { assert.equal(value, task); persisted = true; } };
  vm.createContext(sandbox); vm.runInContext(fn, sandbox);
  sandbox.setTaskStepError('task', 0, 'failed', 10, { screenshot: 'data:image/png;base64,test' });
  assert.equal(task.steps[0].screenshot, 'data:image/png;base64,test');
  assert.equal(task.steps[0].status, 'error');
  assert.equal(persisted, true);
});

test('isolation selection preserves legacy and disabled nodes; rejects shared browser switching', () => {
  const sandbox = { Error, URL }; vm.createContext(sandbox);
  vm.runInContext(runtimeSource, sandbox);
  assert.equal(sandbox.needsIsolatedDouyinBrowser({ nodes: [{ type: 'material' }] }), false);
  assert.equal(sandbox.needsIsolatedDouyinBrowser({ nodes: [{ ...publish, disabled: true }] }), false);
  assert.equal(sandbox.needsIsolatedDouyinBrowser({ nodes: [publish] }), true);
  assert.throws(() => sandbox.needsIsolatedDouyinBrowser({ nodes: [publish, { type: 'navigate', params: { useAdsPower: true } }] }), /shared_browser_not_allowed/);
});

for (const mode of ['isolated', 'legacy', 'held', 'unreachable', 'missing-node', 'missing-env', 'http-error', 'network-error', 'page-error']) {
  test('actual task runner bootstrap: ' + mode, async () => {
    const events = [];
    const page = { on: () => {}, isClosed: () => false };
    const browser = { newPage: async () => {
      if (mode === 'page-error') throw new Error('page_failed');
      return page;
    }, close: async () => { events.push('browser-close'); } };
    const task = { workflowId: 'test', workflow: { nodes: mode === 'legacy' ? [{ type: 'material' }] : [publish] }, status: 'running', initialVars: {} };
    const sandbox = {
      Error, URL, console: { error: () => {} },
      process: { env: mode === 'missing-env' ? {} : { FLEET_NODE_ID: 'host-84' } },
      fetch: async () => { throw new Error('local_workflow_must_not_call_fleet'); },
      shouldDeferNativePageBootstrap: () => false,
      chromium: { launch: async () => { events.push('isolated-launch'); return browser; } },
      getPersistentContext: async () => { events.push('persistent-context'); return { newPage: async () => page }; },
      wfTaskDiag: () => {}, getTask: () => task,
      registerTaskRuntime: () => {}, closeTaskRuntimeNow: async () => {}, clearTaskRuntime: () => {},
      runWorkflow: async () => { events.push('run'); return { success: true, outputs: {} }; },
      setTaskFinalVars: () => {}, mergeOutputsToFinalVars: () => ({}),
      updateTaskStatus: (_id, state) => { events.push(state); },
    };
    vm.createContext(sandbox); vm.runInContext(runtimeSource, sandbox);
    vm.runInContext(startSource, sandbox);
    await sandbox.startWorkflowAsync('test-id', task);
    if (!['legacy', 'page-error'].includes(mode)) assert.deepEqual(events, ['isolated-launch', 'run', 'done', 'browser-close']);
    if (mode === 'legacy') assert.deepEqual(events, ['persistent-context', 'run', 'done']);
    if (mode === 'page-error') assert.deepEqual(events, ['isolated-launch', 'error', 'browser-close']);
  });
}

const remoteLogin = { type: 'credential_login', params: { platform: 'douyin', verifyDouyinCreator: true, useExistingBrowser: true } };
test('remote endpoint is server-owned, loopback-only and requires binary uploads', () => {
  const sandbox = { URL, Error }; vm.createContext(sandbox); vm.runInContext(runtimeSource, sandbox);
  const workflow = { nodes: [remoteLogin, publish] };
  assert.equal(sandbox.remoteDouyinEndpoint(workflow, 'http://127.0.0.1:19224'), 'http://127.0.0.1:19224/');
  for (const endpoint of [undefined, 'https://example.com', 'http://127.0.0.1:19224?token=x', 'http://user:secret@127.0.0.1:19224']) {
    assert.throws(() => sandbox.remoteDouyinEndpoint(workflow, endpoint), /remote_browser_/);
  }
  assert.throws(() => sandbox.remoteDouyinEndpoint({ nodes: [remoteLogin, { type: 'file_upload', params: {} }] }, 'http://127.0.0.1:19224'), /workflow_invalid/);
  const release = sandbox.acquireRemoteDouyinBrowser('http://127.0.0.1:19224');
  assert.throws(() => sandbox.acquireRemoteDouyinBrowser('http://127.0.0.1:19224/'), /busy/);
  release(); sandbox.acquireRemoteDouyinBrowser('http://127.0.0.1:19224')();
});

for (const failure of [false, true]) test('remote runtime owns only a new tab; releases lease on ' + (failure ? 'failure' : 'success'), async () => {
  const events = [];
  const page = { on: () => {}, isClosed: () => false, close: async () => events.push('task-tab-close') };
  const original = { close: async () => { throw Error('must_not_close_user_tab'); } };
  const browser = { contexts: () => [{ pages: () => [original], newPage: async () => { events.push('new-task-tab'); return page; } }], close: async () => events.push('disconnect') };
  const task = { workflowId: 'remote-test', workflow: { nodes: [remoteLogin, publish] }, status: 'running', initialVars: {} };
  const sandbox = { URL, Error, console: { error: () => {} }, process: { env: { WORKFLOW_REMOTE_CDP_URL: 'http://127.0.0.1:19224' } },
    chromium: { connectOverCDP: async () => browser, launch: () => { throw Error('must_not_launch'); } },
    shouldDeferNativePageBootstrap: () => false, wfTaskDiag: () => {}, getTask: () => task,
    registerTaskRuntime: (_id, p, b) => { assert.equal(p, page); assert.equal(b, browser); },
    closeTaskRuntimeNow: () => page.close(), clearTaskRuntime: () => {},
    runWorkflow: async () => { if (failure) throw Error('test_failure'); return { success: true, outputs: {} }; },
    setTaskFinalVars: () => {}, mergeOutputsToFinalVars: () => ({}), updateTaskStatus: (_id, state) => events.push(state) };
  vm.createContext(sandbox); vm.runInContext(runtimeSource + '\n' + startSource, sandbox);
  await sandbox.startWorkflowAsync('remote-task', task);
  assert.deepEqual(events, ['new-task-tab', failure ? 'error' : 'done', 'task-tab-close', 'disconnect']);
  sandbox.acquireRemoteDouyinBrowser('http://127.0.0.1:19224')();
});
