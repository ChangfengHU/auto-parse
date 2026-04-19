/**
 * 工作流任务本地短期持久化：每任务一个 JSON 文件，仅依赖 fs，无原生模块 / 无 SQLite 版本问题。
 *
 * 默认保留约 7 天（可配置 WORKFLOW_TASK_RETENTION_MS，至少 24h）。
 */

import fs from 'fs';
import path from 'path';

const LOG_PREFIX = '[wf-task]';

/** 与 task-store 中 WorkflowTask 一致，独立声明避免与 task-store 循环依赖 */
type PersistedTask = Record<string, unknown> & { taskId: string; startedAt: number };

function persistEnabled(): boolean {
  const v = process.env.WORKFLOW_TASK_PERSIST ?? process.env.WORKFLOW_TASK_SQLITE;
  if (v === '0' || v === 'false') return false;
  return true;
}

function retentionMs(): number {
  const raw = process.env.WORKFLOW_TASK_RETENTION_MS;
  if (raw && /^\d+$/.test(raw)) return Math.max(Number(raw), 24 * 60 * 60 * 1000);
  return 7 * 24 * 60 * 60 * 1000;
}

function dataDir(): string {
  const fromEnv = process.env.WORKFLOW_TASK_DATA_DIR ?? process.env.WORKFLOW_TASK_DB_PATH;
  if (fromEnv && fromEnv.trim()) {
    const p = fromEnv.trim();
    if (p.endsWith('.db')) return path.join(path.dirname(path.resolve(p)), 'workflow-tasks-json');
    return path.resolve(p);
  }
  return path.join(process.cwd(), '.data', 'workflow-tasks');
}

let dirReady = false;
let persistGiveUp = false;

function filePathForTask(taskId: string): string {
  const safe = taskId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(dataDir(), `${safe}.json`);
}

function ensureDirOnce(): boolean {
  if (persistGiveUp) return false;
  if (dirReady) return true;
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    dirReady = true;
    purgeExpiredOnce();
    console.log(LOG_PREFIX, JSON.stringify({ event: 'persist.ready', dataDir: dataDir() }));
    return true;
  } catch (e) {
    persistGiveUp = true;
    console.error(
      LOG_PREFIX,
      JSON.stringify({
        event: 'persist.init_failed',
        err: e instanceof Error ? e.message : String(e),
      })
    );
    return false;
  }
}

function purgeExpiredOnce(): void {
  const dir = dataDir();
  const cutoff = Date.now() - retentionMs();
  let purged = 0;
  try {
    const names = fs.readdirSync(dir);
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const fp = path.join(dir, name);
      try {
        const raw = fs.readFileSync(fp, 'utf8');
        const j = JSON.parse(raw) as { startedAt?: number };
        const started = typeof j.startedAt === 'number' ? j.startedAt : 0;
        if (started < cutoff) {
          fs.unlinkSync(fp);
          purged++;
        }
      } catch {
        fs.unlinkSync(fp);
        purged++;
      }
    }
    if (purged > 0) {
      console.log(
        LOG_PREFIX,
        JSON.stringify({ event: 'persist.purge', purged, retentionMs: retentionMs(), dataDir: dir })
      );
    }
  } catch {
    /* ignore */
  }
}

export function persistWorkflowTask(task: PersistedTask): void {
  if (!persistEnabled() || persistGiveUp) return;
  if (!ensureDirOnce()) return;
  try {
    const fp = filePathForTask(task.taskId);
    fs.writeFileSync(fp, JSON.stringify(task), 'utf8');
  } catch (e) {
    console.error(
      LOG_PREFIX,
      JSON.stringify({
        event: 'persist.write_failed',
        taskId: task.taskId,
        err: e instanceof Error ? e.message : String(e),
      })
    );
  }
}

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function persistWorkflowTaskDebounced(
  taskId: string,
  getTask: () => PersistedTask | undefined
): void {
  if (!persistEnabled() || persistGiveUp) return;
  const prev = debounceTimers.get(taskId);
  if (prev) clearTimeout(prev);
  debounceTimers.set(
    taskId,
    setTimeout(() => {
      debounceTimers.delete(taskId);
      const t = getTask();
      if (t) persistWorkflowTask(t);
    }, 450)
  );
}

export function loadWorkflowTask(taskId: string): PersistedTask | null {
  if (!persistEnabled() || persistGiveUp) return null;
  if (!ensureDirOnce()) return null;
  try {
    const fp = filePathForTask(taskId);
    if (!fs.existsSync(fp)) return null;
    const raw = fs.readFileSync(fp, 'utf8');
    const task = JSON.parse(raw) as PersistedTask;
    if (!task?.taskId || task.taskId !== taskId) return null;
    return task;
  } catch (e) {
    console.error(
      LOG_PREFIX,
      JSON.stringify({
        event: 'persist.read_failed',
        taskId,
        err: e instanceof Error ? e.message : String(e),
      })
    );
    return null;
  }
}

export function deleteWorkflowTaskRecord(taskId: string): void {
  if (!persistEnabled() || persistGiveUp) return;
  try {
    const fp = filePathForTask(taskId);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch (e) {
    console.error(
      LOG_PREFIX,
      JSON.stringify({
        event: 'persist.delete_failed',
        taskId,
        err: e instanceof Error ? e.message : String(e),
      })
    );
  }
}
