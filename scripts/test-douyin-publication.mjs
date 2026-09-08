import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';

const ledgerSource = stripTypeScriptTypes(await fs.readFile(new URL('../lib/workflow/douyin-publication-ledger.ts', import.meta.url), 'utf8'), { mode: 'transform' });
const ledger = await import('data:text/javascript;base64,' + Buffer.from(ledgerSource).toString('base64'));
const nodeSource = stripTypeScriptTypes(await fs.readFile(new URL('../lib/workflow/nodes/douyin-publish.ts', import.meta.url), 'utf8'), { mode: 'transform' })
  .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const runtimeSource = stripTypeScriptTypes(await fs.readFile(new URL('../lib/workflow/douyin-runtime.ts', import.meta.url), 'utf8'), { mode: 'transform' })
  .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const url = 'https://creator.douyin.com/web/api/media/aweme/create/';
const uid = '53017623213';
const videoUrl = 'https://resource.vyibc.com/sunlight-minute-final-20260906.mp4';
const validBody = { status_code: 0, aweme_id: '1234567890123456789' };

for (const [name, u, method, status, body, accepted] of [
  ['create', url, 'POST', 200, validBody, true],
  ['create v2', url.replace('create/', 'create_v2/'), 'POST', 200, validBody, true],
  ['foreign origin', url.replace('creator.douyin.com', 'example.org'), 'POST', 200, validBody, false],
  ['wrong endpoint', url.replace('create/', 'post/'), 'POST', 200, validBody, false],
  ['unknown version', url.replace('create/', 'create_v3/'), 'POST', 200, validBody, false],
  ['wrong method', url, 'GET', 200, validBody, false],
  ['HTTP failure', url, 'POST', 500, validBody, false],
  ['provider failure', url, 'POST', 200, { ...validBody, status_code: 8 }, false],
  ['missing ID', url, 'POST', 200, { status_code: 0 }, false],
  ['unsafe numeric ID', url, 'POST', 200, { status_code: 0, aweme_id: 1234567890123456789 }, false],
]) test('receipt proof: ' + name, () => assert.equal(Boolean(ledger.publicationReceipt(u, method, status, body)), accepted));

test('reservation is exclusive and uncertain outcome survives restart', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'douyin-ledger-test-'));
  try {
    const { key, fingerprint } = ledger.publicationIdentity('request-test-01', uid, videoUrl, 'test', true);
    assert.equal(await ledger.readPublication(dir, key, fingerprint), null);
    const results = await Promise.allSettled([ledger.reservePublication(dir, key, fingerprint), ledger.reservePublication(dir, key, fingerprint)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    await assert.rejects(ledger.readPublication(dir, key, fingerprint), /submission_unknown/);
    await assert.rejects(ledger.readPublication(dir, key, 'different'), /publication_request_conflict/);
    const receipt = ledger.publicationReceipt(url, 'POST', 200, validBody);
    await ledger.finishPublication(dir, key, fingerprint, receipt);
    assert.equal((await ledger.readPublication(dir, key, fingerprint)).receipt.awemeId, validBody.aweme_id);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('AI disclosure is part of request fingerprint and unsafe asset origin is rejected', () => {
  assert.notEqual(ledger.publicationIdentity('request-test-01', uid, videoUrl, 'test', true).fingerprint,
    ledger.publicationIdentity('request-test-01', uid, videoUrl, 'test', false).fingerprint);
  assert.throws(() => ledger.publicationIdentity('request-test-01', uid, 'https://example.org/file.mp4', 'test'), /video_url_invalid/);
});

for (const mode of ['success', 'ai-success', 'ai-control-missing', 'upload-failed', 'content-failed', 'held', 'account-mismatch', 'missing-preflight', 'unknown-receipt', 'hold-before-submit']) {
  test('actual workflow node: ' + mode, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'douyin-publication-test-'));
    let clicks = 0, fleetCalls = 0, declarations = 0;
    const success = ['success', 'ai-success', 'held', 'hold-before-submit'].includes(mode);
    const params = { requestId: 'request-test-01', expectedAccountId: uid, videoUrl, title: 'test', aiGenerated: mode.startsWith('ai-'), confirmPublish: true };
    const context = { vars: {}, outputs: { creatorVerified: true, accountId: uid, uploadedSourceUrl: videoUrl, title: 'test' }, emit: () => {} };
    if (mode === 'missing-preflight') context.outputs = {};
    const sandbox = { ...ledger, path, URL, AbortSignal, Error, process: { cwd: () => dir, env: { FLEET_NODE_ID: 'host-84' } },
      fetch: async () => { fleetCalls++; throw new Error('local_workflow_must_not_call_fleet'); },
    };
    vm.createContext(sandbox); vm.runInContext(runtimeSource + '\n' + nodeSource + '\n globalThis.execute = executeDouyinPublish;', sandbox);
    const locator = { count: async () => 1, fill: async () => {}, first() { return this; },
      innerText: async () => mode === 'upload-failed' ? '上传失败' : mode === 'content-failed' ? '上传成功 检测通过 审核不通过' : '上传成功 检测通过',
      filter() { return { count: async () => mode === 'ai-control-missing' ? 0 : 1,
        locator: () => ({ click: async () => { declarations++; } }) }; },
    };
    const button = { count: async () => 1, isEnabled: async () => true, click: async () => { clicks++; } };
    const response = { url: () => url, request: () => ({ method: () => 'POST' }), status: () => 200,
      json: async () => mode === 'unknown-receipt' ? { status_code: 0 } : validBody };
    const page = {
      url: () => 'https://creator.douyin.com/creator-micro/content/post',
      evaluate: async () => mode === 'account-mismatch' ? '99999999999' : uid,
      waitForFunction: async () => {}, locator: () => locator,
      getByRole: (_role, options) => options.name === '发布' ? button : { isVisible: async () => false, click: async () => {} },
      getByText: () => ({ click: async () => {}, waitFor: async () => {} }),
      waitForResponse: async predicate => { assert.equal(predicate(response), true); return response; },
    };
    try {
      const result = await sandbox.execute(page, params, context);
      assert.equal(result.success, success);
      assert.equal(fleetCalls, 0, 'local publication never depends on Fleet dispatch state');
      assert.equal(clicks, success || mode === 'unknown-receipt' ? 1 : 0);
      assert.equal(declarations, mode === 'ai-success' ? 1 : 0);
      if (success || mode === 'unknown-receipt') {
        const replay = await sandbox.execute(page, params, context);
        assert.equal(replay.success, success);
        assert.equal(clicks, 1, 'replay must never click again');
        if (success) assert.equal(replay.output.reused, true);
        else assert.match(replay.error, /submission_unknown/);
      }
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
}
