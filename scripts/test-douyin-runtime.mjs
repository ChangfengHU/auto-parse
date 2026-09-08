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

test('isolation selection preserves legacy and disabled nodes; rejects shared browser switching', () => {
  const sandbox = { Error }; vm.createContext(sandbox);
  vm.runInContext(runtimeSource, sandbox);
  assert.equal(sandbox.needsIsolatedDouyinBrowser({ nodes: [{ type: 'material' }] }), false);
  assert.equal(sandbox.needsIsolatedDouyinBrowser({ nodes: [{ ...publish, disabled: true }] }), false);
  assert.equal(sandbox.needsIsolatedDouyinBrowser({ nodes: [publish] }), true);
  assert.throws(() => sandbox.needsIsolatedDouyinBrowser({ nodes: [publish, { type: 'navigate', params: { useAdsPower: true } }] }), /shared_browser_not_allowed/);
});

for (const mode of ['ok', 'held', 'unreachable', 'missing-node', 'missing-env', 'http-error', 'network-error']) {
  test('dispatch check: ' + mode, async () => {
    const sandbox = { Error, AbortSignal, process: { env: mode === 'missing-env' ? {} : { FLEET_NODE_ID: 'host-84' } },
      fetch: async () => {
        if (mode === 'network-error') throw new Error('network');
        return { ok: mode !== 'http-error', json: async () => ({ nodes: mode === 'missing-node' ? [] : [
          { id: 'host-84', reachable: mode !== 'unreachable', dispatchHeld: mode === 'held' },
        ] }) };
      },
    };
    vm.createContext(sandbox); vm.runInContext(runtimeSource, sandbox);
    if (mode === 'ok') await sandbox.verifyDouyinDispatch();
    else await assert.rejects(sandbox.verifyDouyinDispatch());
  });
}

for (const mode of ['isolated', 'legacy', 'held', 'page-error']) {
  test('actual task runner bootstrap: ' + mode, async () => {
    const events = [];
    const page = { on: () => {}, isClosed: () => false };
    const browser = { newPage: async () => {
      if (mode === 'page-error') throw new Error('page_failed');
      return page;
    }, close: async () => { events.push('browser-close'); } };
    const task = { workflowId: 'test', workflow: { nodes: mode === 'legacy' ? [{ type: 'material' }] : [publish] }, status: 'running', initialVars: {} };
    const sandbox = {
      Error, console: { error: () => {} },
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
    sandbox.verifyDouyinDispatch = async () => { events.push('dispatch-check'); if (mode === 'held') throw new Error('fleet_dispatch_unavailable'); };
    vm.runInContext(startSource, sandbox);
    await sandbox.startWorkflowAsync('test-id', task);
    if (mode === 'held') assert.deepEqual(events, ['dispatch-check', 'error']);
    if (mode === 'isolated') assert.deepEqual(events, ['dispatch-check', 'isolated-launch', 'run', 'done', 'browser-close']);
    if (mode === 'legacy') assert.deepEqual(events, ['persistent-context', 'run', 'done']);
    if (mode === 'page-error') assert.deepEqual(events, ['dispatch-check', 'isolated-launch', 'error', 'browser-close']);
  });
}
