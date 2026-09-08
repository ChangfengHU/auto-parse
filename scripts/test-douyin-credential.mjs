// Node >= 22.13; exercises the actual TS node with isolated dependencies, no secrets/network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const read = file => readFileSync(new URL('../lib/workflow/' + file, import.meta.url), 'utf8');
const strip = source => stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const uid = '53017623213';
const credential = 'dy_test_only_not_real';
const cookie = 'sessionid=synthetic-test-value';

function setup({ status = 200, data = { status_code: 0, user: { uid, nickname: 'test' } },
  location, pageError, apiError, missingInput, storedCookie = cookie, storeError } = {}) {
  const events = [], injected = [], vars = {}, calls = [];
  const apiFetch = async () => {
    if (apiError) throw new Error('network');
    return { ok: status >= 200 && status < 300, status, json: async () => data };
  };
  const page = {
    goto: async url => { calls.push(url); if (pageError) throw new Error('network'); },
    url: () => location || 'https://creator.douyin.com/creator-micro/content/upload',
    evaluate: fn => vm.runInNewContext('(' + fn.toString() + ')()', { fetch: apiFetch, AbortSignal }),
    context: () => ({ addCookies: async value => { injected.push(...value); } }),
    locator: () => ({ first: () => ({ waitFor: async () => { if (missingInput) throw new Error('timeout'); } }) }),
  };
  const sandbox = { URL, AbortSignal, Date, console,
    captureScreenshot: async () => undefined,
    getPlatformSessionCookie: async () => storedCookie,
    process: { env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only' } },
    fetch: async () => {
      calls.push('store');
      if (storeError) throw new Error(cookie + ' ' + credential);
      return { ok: true, json: async () => storedCookie === null ? [] : [{ cookie_str: storedCookie }] };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(strip(read('douyin-creator-session.ts')) + '\n' + strip(read('nodes/credential-login.ts')) +
    '\n globalThis.execute = executeCredentialLogin;', sandbox);
  const run = (extra = {}) => sandbox.execute(page, {
    platform: 'douyin', credentialId: credential, verifyDouyinCreator: true, expectedAccountId: uid, ...extra,
  }, { vars, emit: (type, value) => events.push({ type, value }) });
  return { run, events, vars, injected, calls };
}

test('verified workflow node injects only Douyin cookies and emits no credential values', async () => {
  const fixture = setup(); const result = await fixture.run();
  assert.equal(result.success, true);
  assert.equal(result.output.creatorVerified, true);
  assert.equal(result.output.accountId, uid);
  assert.equal(fixture.injected[0].domain, '.douyin.com');
  assert.deepEqual(fixture.vars, {});
  const visible = JSON.stringify({ result, events: fixture.events, vars: fixture.vars });
  assert.ok(!visible.includes(cookie)); assert.ok(!visible.includes(credential));
});

for (const [name, options, error] of [
  ['expired login', { status: 401 }, 'creator_login_required'],
  ['forbidden creator', { status: 403 }, 'creator_access_denied'],
  ['API unavailable', { status: 503 }, 'creator_api_unavailable'],
  ['network unavailable', { apiError: true }, 'creator_api_unavailable'],
  ['page unavailable', { pageError: true }, 'creator_page_unreachable'],
  ['login redirect', { location: 'https://creator.douyin.com/login' }, 'creator_login_required'],
  ['foreign origin', { location: 'https://example.org/creator-micro' }, 'creator_login_required'],
  ['wrong account', { data: { status_code: 0, user: { uid: '99999999999' } } }, 'creator_account_mismatch'],
  ['missing UID', { data: { status_code: 0 } }, 'creator_response_invalid'],
  ['provider login rejection', { data: { status_code: 8 } }, 'creator_login_required'],
  ['no upload control', { missingInput: true }, 'creator_upload_unavailable'],
  ['missing credential', { storedCookie: null }, 'credential_not_found'],
  ['invalid cookies', { storedCookie: 'invalid' }, 'credential_cookie_invalid'],
  ['store error redacted', { storeError: true }, 'credential_preflight_failed'],
]) test(name + ' fails closed even when strict is false', async () => {
  const fixture = setup(options); const result = await fixture.run({ strict: false });
  assert.equal(result.success, false); assert.equal(result.error, error);
  assert.deepEqual(fixture.vars, {});
  assert.ok(!JSON.stringify({ result, events: fixture.events }).includes(cookie));
  assert.ok(!JSON.stringify(result).includes(credential));
});

for (const extra of [{ credentialId: '' }, { expectedAccountId: '' }, { expectedAccountId: '{{uid}}' }, { platform: 'gemini' }]) {
  test('invalid preflight input performs no browser or store action ' + JSON.stringify(extra), async () => {
    const fixture = setup(); const result = await fixture.run(extra);
    assert.equal(result.error, 'creator_verification_input_invalid');
    assert.equal(fixture.calls.length, 0); assert.equal(fixture.injected.length, 0);
  });
}

test('legacy empty credential still skips without network', async () => {
  const fixture = setup(); const result = await fixture.run({ verifyDouyinCreator: false, credentialId: '' });
  assert.equal(result.success, true); assert.equal(result.output.skipped, true);
  assert.equal(fixture.calls.length, 0);
});

test('legacy credential output and variable remain backward compatible', async () => {
  const fixture = setup(); const result = await fixture.run({ verifyDouyinCreator: false });
  assert.equal(result.success, true); assert.equal(result.output.credentialCookieStr, cookie);
  assert.equal(fixture.vars.credentialCookieStr, cookie);
  assert.deepEqual(fixture.calls, ['store']);
});
