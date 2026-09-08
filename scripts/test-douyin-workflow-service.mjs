import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const transformed = async name => stripTypeScriptTypes(await fs.readFile(new URL('../lib/workflow/' + name, import.meta.url), 'utf8'), { mode: 'transform' });
const ledger = await import('data:text/javascript;base64,' + Buffer.from(await transformed('douyin-publication-ledger.ts')).toString('base64'));
const cover = (await transformed('douyin-cover.ts')).replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const source = (await transformed('douyin-workflow-service.ts')).replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const types = ['material','navigate','qrcode','navigate','file_upload','wait_condition','text_input','scroll','wait_condition','click','click','wait_condition','screenshot'];
const input = { requestId: 'preview-test-12345', expectedAccountId: '53017623213',
  videoUrl: 'https://resource.vyibc.com/example.mp4', title: 'Title', description: 'Description',
  topics: ['动画'], aiGenerated: true, prepareOnly: true, confirmPublish: false };

test('approved workflow snapshot keeps original unchanged, preview cannot publish, retries deduplicate', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'douyin-workflow-test-'));
  const workflow = { id: '34f421be-f97c-498a-9c80-5214564abd1c', nodes: types.map(type => ({ type, params: {} })) };
  workflow.nodes[1].params.adsManualCdpUrl = 'http://127.0.0.1:9223';
  const baseline = structuredClone(workflow);
  let calls = 0, snapshot;
  const sandbox = { ...fs, ...ledger, path, URL, Buffer, structuredClone, process: { cwd: () => dir },
    getWorkflow: async () => workflow, getWorkflowTask: () => ({ status: 'done' }),
    startWorkflowTask: async request => { calls++; snapshot = request.workflow; return { taskId: 'test-task', status: 'running' }; },
  };
  vm.createContext(sandbox); vm.runInContext(cover + '\n' + source, sandbox);
  try {
    const first = await sandbox.startDouyinWorkflow(input);
    const retry = await sandbox.startDouyinWorkflow(input);
    assert.equal(first.taskId, retry.taskId); assert.equal(calls, 1);
    assert.deepEqual(workflow, baseline);
    assert.equal(snapshot.nodes[9].params.douyinPublication.confirmPublish, false);
    assert.equal(snapshot.nodes[9].params.douyinPublication.prepareOnly, true);
    assert.equal(snapshot.nodes[11].disabled, true);
    assert.equal(snapshot.nodes[4].params.transferMode, 'buffer');
    await assert.rejects(sandbox.startDouyinWorkflow({ ...input, description: 'different' }), /request_conflict/);
    await assert.rejects(sandbox.startDouyinWorkflow({ ...input, prepareOnly: false }), /confirmation_required/);
    await assert.rejects(sandbox.startDouyinWorkflow({ ...input, cover: { verticalUrl: 'http://127.0.0.1/secret.jpg' } }), /cover_url_invalid/);
    assert.equal(calls, 1);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
