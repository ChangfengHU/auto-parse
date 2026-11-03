import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireManagedBrowserActivity } from '../lib/workflow/browser-activity.ts';

const dir = await mkdtemp(join(tmpdir(), 'managed-browser-wait-'));
const endpoint = 'http://127.0.0.1:9222';
await writeFile(join(dir, 'activity-9222.lock'), '');
try {
  const release = await acquireManagedBrowserActivity(endpoint, dir);
  await assert.rejects(acquireManagedBrowserActivity(endpoint, dir), /managed_browser_busy/);
  const started = Date.now();
  const waiting = acquireManagedBrowserActivity(endpoint, dir, 3);
  setTimeout(() => void release(), 500);
  const releaseNext = await waiting;
  assert.ok(Date.now() - started >= 350, 'waiter must wait for the existing holder');
  await assert.rejects(acquireManagedBrowserActivity(endpoint, dir, 1), /managed_browser_busy/);
  await releaseNext();
  const releaseFinal = await acquireManagedBrowserActivity(endpoint, dir, 1);
  await releaseFinal();
  await assert.rejects(acquireManagedBrowserActivity(endpoint, dir, 31), /managed_browser_wait_invalid/);
  console.log('managed browser bounded wait and release: passed');
} finally {
  await rm(dir, {recursive: true, force: true});
}
