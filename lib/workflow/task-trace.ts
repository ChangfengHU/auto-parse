import fs from 'fs';
import path from 'path';

export type TaskTracePayload = Record<string, unknown>;

const TRACE_ROOT_DIR = process.env.GEMINI_TASK_TRACE_DIR
  ? path.resolve(process.cwd(), process.env.GEMINI_TASK_TRACE_DIR)
  : path.join(process.cwd(), '.task-traces');

const DEFAULT_TRACE_RETENTION_MS = 24 * 60 * 60 * 1000;

export function taskTraceRetentionMs() {
  return Number(process.env.GEMINI_TASK_TRACE_RETENTION_MS || DEFAULT_TRACE_RETENTION_MS);
}

function namespaceDir(namespace: string) {
  return path.join(TRACE_ROOT_DIR, namespace);
}

export function taskTraceFile(namespace: string, taskId: string) {
  return path.join(namespaceDir(namespace), `${taskId}.jsonl`);
}

export function taskTraceFileRelative(absPath: string) {
  try {
    const rel = path.relative(process.cwd(), absPath);
    return rel.startsWith('..') ? absPath : rel;
  } catch {
    return absPath;
  }
}

import { insertTaskTraceEvent } from './supabase-task-persist';

export function appendTaskTrace(namespace: string, taskId: string, event: string, payload: TaskTracePayload = {}) {
  const ts = new Date().toISOString();
  try {
    const file = taskTraceFile(namespace, taskId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const line = JSON.stringify({ ts, event, ...payload });
    fs.appendFileSync(file, `${line}\n`, 'utf8');
  } catch {
    // ignore trace logging failures
  }

  // Best-effort persistence (do not block main workflow)
  try {
    insertTaskTraceEvent({ namespace, taskId, ts, event, payload });
  } catch {
    // ignore
  }
}

export function pruneTaskTraces(namespace: string, retentionMs = taskTraceRetentionMs(), maxDeletes = 200) {
  try {
    const dir = namespaceDir(namespace);
    if (!fs.existsSync(dir)) return;

    const now = Date.now();
    const entries = fs.readdirSync(dir).map((name) => path.join(dir, name));

    let deleted = 0;
    for (const file of entries) {
      if (!file.endsWith('.jsonl')) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      if (now - stat.mtimeMs > retentionMs) {
        try {
          fs.unlinkSync(file);
          deleted += 1;
        } catch {
          // ignore
        }
      }
      if (deleted >= maxDeletes) break;
    }
  } catch {
    // ignore cleanup failures
  }
}
