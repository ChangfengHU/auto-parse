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

test('creation parser preserves exact unquoted long IDs and accepts item_id', () => {
  const body = ledger.parseCreationBody('{"status_code":0,"item_id":7683141951113219337}');
  assert.equal(body.item_id, '7683141951113219337');
  assert.equal(ledger.publicationReceipt(url, 'POST', 200, body).awemeId, '7683141951113219337');
});

test('readback requires exact work, account, title, time and a unique native list item', () => {
  const expected = { awemeId: '7683141951113219337', accountId: uid, title: 'test', startedAt: 100000, completedAt: 110000 };
  const item = { aweme_id: expected.awemeId, author: { uid }, desc: 'test', create_time: 105, duration: 60011, status: {} };
  const body = { status_code: 0, aweme_list: [item] };
  assert.equal(ledger.creatorListReceipt(body, expected).verificationSource, 'creator_work_list');
  for (const change of [{ author: { uid: '99999' } }, { desc: 'other' }, { create_time: 1 },
    { duration: 0 }, { status: { is_delete: true } }, { aweme_id: '99999999999' }]) {
    assert.equal(ledger.creatorListReceipt({ ...body, aweme_list: [{ ...item, ...change }] }, expected), null);
  }
  assert.equal(ledger.creatorListReceipt({ ...body, aweme_list: [item, item] }, expected), null);
  assert.equal(ledger.creatorListReceipt({ ...body, status_code: 1 }, expected), null);
});

test('Semi Radio selected class is authoritative when hidden native input stays unchecked', () => {
  const expression = nodeSource.match(/const selected = ([\s\S]*?);\n/)?.[1];
  assert.ok(expression);
  const selected = vm.runInNewContext('(' + expression + ')');
  const element = checked => ({ classList: { contains: name => checked && name === 'semi-radio-checked' },
    getAttribute: () => null, querySelector: () => ({ checked: false }) });
  assert.equal(selected(element(true)), true);
  assert.equal(selected(element(false)), false);
});

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

for (const mode of ['prepare-only', 'success', 'live-session', 'live-session-wrong-account', 'ai-success', 'ai-control-missing', 'ai-not-selected', 'upload-failed', 'content-failed', 'held', 'account-mismatch', 'missing-preflight', 'unknown-receipt', 'hold-before-submit']) {
  test('actual workflow node: ' + mode, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'douyin-publication-test-'));
    let clicks = 0, fleetCalls = 0, declarations = 0;
    const success = ['success', 'live-session', 'ai-success', 'held', 'hold-before-submit'].includes(mode);
    const params = { requestId: 'request-test-01', expectedAccountId: uid, videoUrl, title: 'test', aiGenerated: mode.startsWith('ai-'), confirmPublish: true };
    if (mode === 'prepare-only') { params.prepareOnly = true; params.confirmPublish = false; }
    const context = { vars: {}, outputs: { creatorVerified: true, accountId: uid, uploadedSourceUrl: videoUrl, title: 'test' }, emit: () => {} };
    if (mode === 'missing-preflight') context.outputs = {};
    if (mode.startsWith('live-session')) {
      params.verifyCurrentSession = true;
      delete context.outputs.creatorVerified; delete context.outputs.accountId;
    }
    const sandbox = { ...ledger, path, URL, AbortSignal, Error, process: { cwd: () => dir, env: { FLEET_NODE_ID: 'host-84' } },
      captureScreenshot: async () => undefined,
      fetch: async () => { fleetCalls++; throw new Error('local_workflow_must_not_call_fleet'); },
    };
    vm.createContext(sandbox); vm.runInContext(runtimeSource + '\n' + nodeSource + '\n globalThis.execute = executeDouyinPublish;', sandbox);
    const locator = { count: async () => 1, fill: async () => {}, first() { return this; },
      innerText: async () => mode === 'upload-failed' ? '上传失败' : mode === 'content-failed' ? '上传成功 检测通过 审核不通过' : '上传成功 检测通过',
      filter() { return { count: async () => mode === 'ai-control-missing' ? 0 : 1,
        click: async () => { declarations++; },
        elementHandle: async () => ({}),
        evaluate: async fn => fn.toString().includes('classList.contains') ? mode !== 'ai-not-selected' : [],
        locator: () => ({ click: async () => { declarations++; }, elementHandle: async () => ({}), isChecked: async () => mode !== 'ai-not-selected' }) }; },
    };
    const button = { count: async () => 1, isEnabled: async () => true, click: async () => { clicks++; } };
    let editorText = 'test';
    const editor = { ...locator, first() { return this; }, click: async () => {}, press: async key => {
      if (key === 'Backspace') editorText = '';
    }, innerText: async () => editorText, fill: async value => { editorText += value; } };
    const response = { url: () => url, request: () => ({ method: () => 'POST' }), status: () => 200,
      text: async () => JSON.stringify(mode === 'unknown-receipt' ? { status_code: 0 } : validBody),
      json: async () => mode === 'unknown-receipt' ? { status_code: 0 } : validBody };
    const page = {
      url: () => 'https://creator.douyin.com/creator-micro/content/post',
      evaluate: async () => ['account-mismatch', 'live-session-wrong-account'].includes(mode) ? '99999999999' : uid,
      waitForFunction: async () => {}, locator: selector => selector === '[contenteditable="true"]' ? editor : locator,
      getByRole: (_role, options) => options.name === '发布' ? button : { isVisible: async () => false, click: async () => {} },
      getByText: text => ({ click: async () => {},
        waitFor: async () => { assert.notEqual(text, '内容由AI生成', 'applied label has multiple matches and must be narrowed'); },
        and() { return { first() { return { waitFor: async () => {} }; } }; },
      }),
      waitForResponse: async predicate => { assert.equal(predicate(response), true); return response; },
    };
    try {
      const result = await sandbox.execute(page, params, context);
      if (mode === 'prepare-only') {
        assert.equal(result.success, true);
        assert.equal(result.output.prepared, true);
        assert.equal(clicks, 0);
        assert.equal(fleetCalls, 0);
        await assert.rejects(fs.access(path.join(dir, '.data/douyin-publications')));
        return;
      }
      assert.equal(result.success, success);
      assert.equal(fleetCalls, 0, 'local publication never depends on Fleet dispatch state');
      assert.equal(clicks, success || mode === 'unknown-receipt' ? 1 : 0);
      assert.equal(declarations, ['ai-success', 'ai-not-selected'].includes(mode) ? 1 : 0);
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
