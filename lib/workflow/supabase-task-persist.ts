type Json = Record<string, unknown>;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

function headers(extra?: Record<string, string>) {
  return {
    apikey: SUPABASE_KEY as string,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation,resolution=merge-duplicates',
    ...extra,
  };
}

export function upsertAdsDispatcherTaskSnapshot(task: {
  id: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  lastActivityAt?: string;
  [k: string]: unknown;
}) {
  if (!isConfigured()) return;
  const row = {
    id: task.id,
    status: task.status,
    created_at: task.createdAt || undefined,
    updated_at: task.updatedAt || new Date().toISOString(),
    last_activity_at: task.lastActivityAt || undefined,
    task_json: task as Json,
  };

  void fetch(`${SUPABASE_URL}/rest/v1/gemini_ads_dispatcher_tasks?on_conflict=id`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(row),
  }).catch(() => {});
}

export function insertTaskTraceEvent(input: {
  namespace: string;
  taskId: string;
  ts: string;
  event: string;
  payload: Json;
}) {
  if (!isConfigured()) return;
  const row = {
    namespace: input.namespace,
    task_id: input.taskId,
    ts: input.ts,
    event: input.event,
    payload: input.payload,
  };

  void fetch(`${SUPABASE_URL}/rest/v1/gemini_task_traces`, {
    method: 'POST',
    headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify(row),
  }).catch(() => {});
}

/**
 * [NEW] 从 Supabase 获取调度任务快照（用于二级缓存回源）
 */
export async function getAdsDispatcherTaskSnapshot(taskId: string): Promise<Json | null> {
  if (!isConfigured()) return null;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/gemini_ads_dispatcher_tasks?id=eq.${taskId}&select=task_json`,
      {
        method: 'GET',
        headers: headers(),
      }
    );

    if (!res.ok) {
      if (res.status !== 404) {
        console.error(`[Supabase] Failed to fetch task ${taskId}: ${res.statusText}`);
      }
      return null;
    }

    const list = await res.json();
    if (Array.isArray(list) && list.length > 0) {
      return list[0].task_json as Json;
    }
    return null;
  } catch (error) {
    console.error(`[Supabase] Error fetching task ${taskId}:`, error);
    return null;
  }
}
