// Staging acceptance: credentials arrive via stdin, never arguments or files.
// Creates and removes only its own empty test drafts. Never opens a browser.
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
let raw = ''; for await (const chunk of process.stdin) raw += chunk;
const config = JSON.parse(raw);
const endpoint = new URL(config.url || 'http://127.0.0.1:11008/api/workflows/mcp');
assert.ok(['127.0.0.1', 'localhost'].includes(endpoint.hostname), 'Canary verification is loopback-only');
const token = config.token || 'wfmcp_' + createHmac('sha256', config.adminToken).update('auto-parse-workflow-mcp:v1').digest('hex');
const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' };
let seq = 0;
async function rpc(method, params, withId = true) {
  const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', ...(withId ? { id: ++seq } : {}), method, params }), signal: AbortSignal.timeout(30000) });
  assert.equal(res.status, withId ? 200 : 202, 'Unexpected MCP HTTP status');
  return withId ? res.json() : undefined;
}
async function call(name, args = {}, expectedError = false) {
  const reply = await rpc('tools/call', { name, arguments: args });
  assert.ok(reply.result, 'Missing MCP result');
  assert.equal(Boolean(reply.result.isError), expectedError, 'Unexpected tool result for ' + name);
  return JSON.parse(reply.result.content.find(item => item.type === 'text').text);
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ids = [];
try {
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...headers, origin: 'https://untrusted.example' }, body: '{}' })).status, 403);
  const initialized = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'workflow-acceptance', version: '1' } });
  assert.equal(initialized.result.serverInfo.name, 'auto-parse-workflow');
  await rpc('notifications/initialized', {}, false);
  assert.equal((await fetch(endpoint, { headers })).status, 405);
  const listing = await rpc('tools/list', {});
  assert.equal(listing.result.tools.length, 16);
  const capabilities = await call('workflow_capabilities');
  assert.equal(capabilities.source, 'supabase');
  const catalog = await call('workflow_node_catalog');
  assert.ok(catalog.some(node => node.type === 'file_upload' && node.debugSupported));
  const originals = new Map();
  for (const id of ['douyin-publish', '34f421be-f97c-498a-9c80-5214564abd1c']) originals.set(id, digest(await call('workflow_get', { workflowId: id })));
  const draft = { name: '[MCP acceptance] temporary empty draft', description: 'Disposable non-executing acceptance fixture', vars: [], nodes: [] };
  assert.equal((await call('workflow_validate', { workflow: draft })).valid, true);
  const created = await call('workflow_create', { workflow: draft }); ids.push(created.id);
  assert.ok(created.updatedAt);
  assert.equal((await call('workflow_get', { workflowId: created.id })).name, draft.name);
  const changed = await call('workflow_update', { workflowId: created.id, expectedUpdatedAt: created.updatedAt, patch: { description: 'Revision acceptance fixture' } });
  assert.notEqual(changed.updatedAt, created.updatedAt);
  const stale = await call('workflow_update', { workflowId: created.id, expectedUpdatedAt: created.updatedAt, patch: { description: 'Must not overwrite' } }, true);
  assert.match(stale.error, /revision_conflict/);
  const copied = await call('workflow_copy', { workflowId: created.id }); ids.push(copied.id);
  assert.notEqual(copied.id, created.id);
  const page = await call('workflow_list', { query: '[MCP acceptance]', page: 1, limit: 20 });
  assert.ok(page.items.some(item => item.id === created.id));
  for (const [id, hash] of originals) assert.equal(digest(await call('workflow_get', { workflowId: id })), hash, 'Protected workflow changed');
  console.log(JSON.stringify({ ok: true, tools: listing.result.tools.length, protocol: true, auth: true, origin: true, catalog: true, sharedSupabaseCrud: true, staleWriteRejected: true, protectedWorkflowsUnchanged: true, browserOpened: false, uploaded: false, published: false }));
} finally {
  for (const id of ids) {
    const removed = await fetch(new URL('/api/workflows/' + encodeURIComponent(id), endpoint), { method: 'DELETE', headers: { authorization: headers.authorization }, signal: AbortSignal.timeout(30000) });
    assert.equal(removed.status, 200, 'Temporary fixture cleanup failed for ' + id);
  }
  if (ids.length) console.log(JSON.stringify({ removedTemporaryDrafts: ids.length }));
}
