import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';

const source = stripTypeScriptTypes(await readFile(new URL('../lib/workflow/nodes/click.ts', import.meta.url), 'utf8'), { mode: 'transform' })
  .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
for (const invalid of [false, true]) test('explicit publication click ' + (invalid ? 'rejects mixed targets' : 'delegates to receipt-aware workflow executor'), async () => {
  let calls = 0;
  const page = {}, ctx = {}, params = { text: '发布', douyinPublication: { requestId: 'request-test', confirmPublish: true } };
  if (invalid) params.selector = 'button';
  const sandbox = { executeDouyinPublish: async (p, config, context) => {
    calls++; assert.equal(p, page); assert.equal(context, ctx); assert.equal(config.verifyCurrentSession, true);
    assert.equal(config.requestId, 'request-test'); return { success: true };
  } };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const result = await sandbox.executeClick(page, params, ctx);
  assert.equal(result.success, !invalid); assert.equal(calls, invalid ? 0 : 1);
});
