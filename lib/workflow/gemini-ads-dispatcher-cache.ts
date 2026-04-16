import fs from 'fs';
import os from 'os';
import path from 'path';

export function getGeminiAdsDispatcherTaskCacheDir() {
  const configured = String(process.env.GEMINI_ADS_DISPATCHER_TASK_CACHE_DIR || '').trim();
  if (configured) return configured;
  // Use a stable, repo-relative directory so multiple Next.js workers share the same cache.
  return path.join(process.cwd(), 'temp', 'gemini-ads-dispatcher-task-cache');
}

export function ensureGeminiAdsDispatcherTaskCacheDir() {
  const dir = getGeminiAdsDispatcherTaskCacheDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getGeminiAdsDispatcherQueueLockDir() {
  // Keep lock dir colocated with cache dir to ensure cross-worker mutual exclusion.
  return path.join(getGeminiAdsDispatcherTaskCacheDir(), 'queue.lock');
}

// Legacy location (macOS TMPDIR differs per process; keep for possible one-off debugging)
export function getLegacyGeminiAdsDispatcherTaskCacheDir() {
  return path.join(os.tmpdir(), 'gemini-ads-dispatcher-task-cache');
}
