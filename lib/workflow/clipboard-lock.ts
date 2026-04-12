import fs from 'fs/promises';
import os from 'os';
import path from 'path';

declare global {
  // In-process FIFO queue to serialize clipboard operations within the same Node.js process.
  // Cross-process safety is provided by the temp-dir lock below.
  // eslint-disable-next-line no-var
  var __doouyinClipboardQueue: Promise<void> | undefined;
}

export interface ClipboardLockOptions {
  /** When false, bypasses both in-process queue and cross-process lock. */
  enabled?: boolean;
  /** Max time to wait for the cross-process lock (ms). */
  timeoutMs?: number;
  /** If lock dir mtime is older than this, treat it as stale and remove (ms). */
  staleMs?: number;
  /** Poll interval while waiting for the lock (ms). */
  pollIntervalMs?: number;
  /** Lock name to support multiple independent locks if needed. */
  lockName?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireDirLock(lockDir: string, opts: Required<Pick<ClipboardLockOptions, 'timeoutMs' | 'staleMs' | 'pollIntervalMs'>>): Promise<() => Promise<void>> {
  const deadline = Date.now() + opts.timeoutMs;

  // mkdir is atomic on POSIX: either we create the dir (lock acquired) or get EEXIST.
  // This works across multiple Node.js processes on the same machine.
  // Note: this does not coordinate across different machines.
  while (true) {
    try {
      await fs.mkdir(lockDir);
      const metaPath = path.join(lockDir, 'meta.json');
      await fs
        .writeFile(
          metaPath,
          JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
          { encoding: 'utf8' }
        )
        .catch(() => {});

      return async () => {
        await fs.rm(lockDir, { recursive: true, force: true }).catch(() => {});
      };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== 'EEXIST') throw err;

      // If lock looks stale (process crashed / killed), remove it.
      const stat = await fs.stat(lockDir).catch(() => null);
      if (stat) {
        const age = Date.now() - stat.mtimeMs;
        if (age > opts.staleMs) {
          await fs.rm(lockDir, { recursive: true, force: true }).catch(() => {});
          continue;
        }
      }

      if (Date.now() > deadline) {
        throw new Error(`等待剪贴板锁超时（${opts.timeoutMs}ms）：${lockDir}`);
      }
      await sleep(opts.pollIntervalMs);
    }
  }
}

export async function withSystemClipboardLock<T>(fn: () => Promise<T>, options: ClipboardLockOptions = {}): Promise<T> {
  const enabled = options.enabled ?? true;
  if (!enabled) return fn();

  const lockName = (options.lockName || 'system-clipboard').trim() || 'system-clipboard';
  const lockDir = path.join(os.tmpdir(), `doouyin-${lockName}.lock`);

  const timeoutMs = Math.max(1000, options.timeoutMs ?? 60_000);
  const staleMs = Math.max(5000, options.staleMs ?? 120_000);
  const pollIntervalMs = Math.max(50, options.pollIntervalMs ?? 120);

  // In-process serialization first: reduces contention on the cross-process lock.
  const prev = global.__doouyinClipboardQueue || Promise.resolve();
  let releaseInProcess!: () => void;
  global.__doouyinClipboardQueue = new Promise<void>((resolve) => {
    releaseInProcess = resolve;
  });

  await prev;
  let releaseDir: (() => Promise<void>) | null = null;
  try {
    releaseDir = await acquireDirLock(lockDir, { timeoutMs, staleMs, pollIntervalMs });
    return await fn();
  } finally {
    await releaseDir?.().catch(() => {});
    releaseInProcess();
  }
}
