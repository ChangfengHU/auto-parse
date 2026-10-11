import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';

// Direct, host-local CDP only. A forwarded tunnel needs a lease on its owner host.
export async function acquireManagedBrowserActivity(endpoint: string, directory = '/run/linux-browser-vnc'): Promise<() => Promise<void>> {
  const url = new URL(endpoint);
  if (!['http:', 'ws:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !/^\d{4,5}$/.test(url.port) || Number(url.port) > 65535 || url.username || url.password || url.search || url.hash) {
    throw new Error('managed_browser_endpoint_invalid');
  }
  const lock = join(directory, `activity-${url.port}.lock`);
  // Never replace/unlink the inode shared by other services. Missing lock fails closed.
  if (!statSync(lock).isFile()) throw new Error('managed_browser_lock_missing');
  return new Promise((resolve, reject) => {
    const child = spawn('flock', ['--nonblock', '--no-fork', lock, 'sh', '-c', "printf 'locked\\n'; cat >/dev/null"],
      { stdio: ['pipe', 'pipe', 'ignore'] });
    let granted = false;
    const exited = new Promise<void>(done => child.once('exit', () => done()));
    const timer = setTimeout(() => { child.stdin.destroy(); child.kill(); reject(new Error('managed_browser_lock_timeout')); }, 5000);
    child.stdin.on('error', () => {});
    child.once('error', () => { clearTimeout(timer); child.stdin.destroy(); reject(new Error('managed_browser_lock_unavailable')); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (!granted) reject(new Error(code === 1 ? 'managed_browser_busy' : 'managed_browser_lock_unavailable'));
    });
    child.stdout.once('data', chunk => {
      if (String(chunk).trim() !== 'locked') { child.stdin.destroy(); child.kill(); return; }
      granted = true;
      clearTimeout(timer);
      let released = false;
      resolve(async () => { if (!released) { released = true; child.stdin.end(); } await exited; });
    });
  });
}
