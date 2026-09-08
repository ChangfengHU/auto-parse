import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';

const source = stripTypeScriptTypes(await readFile(new URL('../lib/workflow/nodes/navigate.ts', import.meta.url), 'utf8'), { mode: 'transform' })
  .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
for (const failure of [false, true]) test('manual CDP without profile ID: ' + (failure ? 'failure cleanup' : 'handoff to following nodes'), async () => {
  let connects = 0, pageCloses = 0, disconnects = 0;
  const page = { url: () => 'about:blank', goto: async () => { if (failure) throw Error('navigation_failed'); },
    bringToFront: async () => {}, waitForTimeout: async () => {}, close: async () => { pageCloses++; } };
  const browser = { contexts: () => [{ newPage: async () => page, pages: () => { throw Error('must_not_reuse_user_tab'); } }], close: async () => { disconnects++; } };
  const sandbox = { URL, Error, process: { env: {} }, setTimeout: fn => { fn(); },
    chromium: { connectOverCDP: async () => { connects++; return browser; } },
    fetch: () => { throw Error('manual_mode_must_not_probe_adspower'); }, captureScreenshot: async () => 'screenshot' };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const result = await sandbox.executeNavigate({}, { url: 'https://creator.douyin.com', useAdsPower: true, adsManualCdpUrl: 'http://127.0.0.1:9223' }, {});
  assert.equal(result.success, !failure); assert.equal(connects, 1);
  if (!failure) { assert.equal(result.newPage, page); assert.equal(result.newBrowser, browser); }
  assert.equal(pageCloses, failure ? 1 : 0); assert.equal(disconnects, failure ? 1 : 0);
});
