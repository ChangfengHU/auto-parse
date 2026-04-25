import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getGeminiAdsDispatcherQueueInfo } from '@/lib/workflow/gemini-ads-dispatcher';

export const runtime = 'nodejs';

type Row = {
  id: string;
  status: string;
  created_at?: string;
  updated_at?: string;
  last_activity_at?: string;
  task_json?: Record<string, unknown>;
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

function supabaseHeaders() {
  return {
    apikey: SUPABASE_KEY as string,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
}

function clampLimit(n: number, def = 50) {
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

function clampPage(n: number, def = 1) {
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.max(1, Math.floor(n));
}

function normalizeTaskStatus(rawStatus: string, task: Record<string, unknown>) {
  const summary = (task.summary as Record<string, unknown> | undefined) || {};
  const total = Number(summary.total ?? 0);
  const pending = Number(summary.pending ?? 0);
  const running = Number(summary.running ?? 0);
  const success = Number(summary.success ?? 0);
  const failed = Number(summary.failed ?? 0);
  const cancelled = Number(summary.cancelled ?? 0);
  const done = success + failed + cancelled;

  if (total > 0 && pending === 0 && running === 0 && done >= total) {
    if (failed > 0) return 'failed';
    if (cancelled > 0 && success === 0) return 'cancelled';
    return 'success';
  }
  return rawStatus;
}

function toListItem(row: Row) {
  const task = row.task_json || {};
  const result = (task.result as Record<string, unknown> | undefined) || {};
  const imageUrls = Array.isArray(result.imageUrls)
    ? (result.imageUrls as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];
  const mediaUrls = Array.isArray(result.mediaUrls)
    ? (result.mediaUrls as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];
  const itemUrls =
    Array.isArray(task.items)
      ? (task.items as Array<Record<string, unknown>>)
          .flatMap((item) => {
            const oneImage = typeof item.primaryImageUrl === 'string' ? [item.primaryImageUrl] : [];
            const oneMedia = typeof item.primaryMediaUrl === 'string' ? [item.primaryMediaUrl] : [];
            const manyImages = Array.isArray(item.imageUrls)
              ? (item.imageUrls as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0)
              : [];
            const manyMedia = Array.isArray(item.mediaUrls)
              ? (item.mediaUrls as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0)
              : [];
            return [...oneImage, ...manyImages, ...oneMedia, ...manyMedia];
          })
          .filter((url, idx, arr) => arr.indexOf(url) === idx)
      : [];
  const previewUrls = (imageUrls.length > 0 ? imageUrls : mediaUrls.length > 0 ? mediaUrls : itemUrls).slice(0, 8);
  const rawSettings = (task.settings as Record<string, unknown> | undefined) || {};
  const settings = {
    instanceIds: Array.isArray(rawSettings.instanceIds)
      ? (rawSettings.instanceIds as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0)
      : [],
    workflowId: typeof rawSettings.workflowId === 'string' ? rawSettings.workflowId : undefined,
    maxAttemptsPerPrompt: Number(rawSettings.maxAttemptsPerPrompt ?? 0) || undefined,
  };
  const normalizedStatus = normalizeTaskStatus(row.status, task as Record<string, unknown>);
  return {
    id: row.id,
    status: normalizedStatus,
    createdAt: row.created_at || (task.createdAt as string | undefined) || null,
    updatedAt: row.updated_at || (task.updatedAt as string | undefined) || null,
    lastActivityAt: row.last_activity_at || (task.lastActivityAt as string | undefined) || null,
    startedAt: (task.startedAt as string | undefined) || null,
    endedAt: (task.endedAt as string | undefined) || null,
    summary: (task.summary as unknown) || null,
    settings,
    previewUrls,
    previewImageUrl: previewUrls[0] || null,
    queue: getGeminiAdsDispatcherQueueInfo(row.id),
  };
}

function persistRowsToDisk(rows: Row[]) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  try {
    const { ensureGeminiAdsDispatcherTaskCacheDir } = require('@/lib/workflow/gemini-ads-dispatcher-cache') as typeof import('@/lib/workflow/gemini-ads-dispatcher-cache');
    const dir = ensureGeminiAdsDispatcherTaskCacheDir();
    for (const row of rows) {
      if (!row?.id || !row?.task_json) continue;
      const payload = row.task_json as Record<string, unknown>;
      const taskId = typeof payload.id === 'string' && payload.id.trim() ? payload.id.trim() : row.id;
      if (!taskId) continue;
      const file = path.join(dir, `${taskId}.json`);
      fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
    }
  } catch {
    // ignore disk persistence failure
  }
}

async function listFromSupabase(input: { status?: string; q?: string; limit: number; cursor?: string; page?: number }) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/gemini_ads_dispatcher_tasks`);
  url.searchParams.set('select', 'id,status,created_at,updated_at,last_activity_at,task_json');
  url.searchParams.set('order', 'updated_at.desc');
  url.searchParams.set('limit', String(input.limit));

  if (input.status) {
    url.searchParams.set('status', `eq.${input.status}`);
  }

  if (input.q) {
    // MVP: only search by task id
    url.searchParams.set('id', `ilike.*${input.q}*`);
  }

  if (input.page && input.page > 1) {
    const offset = (input.page - 1) * input.limit;
    url.searchParams.set('offset', String(offset));
  } else if (input.cursor) {
    url.searchParams.set('updated_at', `lt.${input.cursor}`);
  }

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      ...supabaseHeaders(),
      Prefer: 'count=exact',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase query failed: HTTP ${res.status} ${text}`);
  }

  const rows = (await res.json()) as Row[];
  persistRowsToDisk(rows);
  const items = rows.map(toListItem);
  const nextCursor = rows.length > 0 ? rows[rows.length - 1].updated_at || null : null;
  const contentRange = res.headers.get('content-range') || '';
  const totalMatch = contentRange.match(/\/(\d+)$/);
  const total = totalMatch ? Number(totalMatch[1]) : null;
  const page = input.page ?? 1;
  const totalPages = total !== null ? Math.max(1, Math.ceil(total / input.limit)) : null;

  return { source: 'supabase', items, nextCursor, total, page, pageSize: input.limit, totalPages };
}

function listFromDisk(input: { status?: string; q?: string; limit: number; page?: number }) {
  const { getGeminiAdsDispatcherTaskCacheDir } = require('@/lib/workflow/gemini-ads-dispatcher-cache') as typeof import('@/lib/workflow/gemini-ads-dispatcher-cache');
  const dir = getGeminiAdsDispatcherTaskCacheDir();
  if (!fs.existsSync(dir)) {
    return { source: 'disk', items: [], nextCursor: null, total: 0, page: input.page ?? 1, pageSize: input.limit, totalPages: 1 };
  }

  const candidates = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .filter((name) => name !== 'queue.json')
    .map((name) => path.join(dir, name));

  const parsed: Array<{ file: string; mtimeMs: number; task: any }> = [];
  const nowMs = Date.now();
  for (const file of candidates) {
    try {
      const stat = fs.statSync(file);
      const task = JSON.parse(fs.readFileSync(file, 'utf8')) as any;
      const cacheUntilMs = typeof task?.cacheUntil === 'string' ? Date.parse(task.cacheUntil) : NaN;
      if (Number.isFinite(cacheUntilMs) && nowMs > cacheUntilMs) {
        try {
          fs.unlinkSync(file);
        } catch {
          // ignore cleanup failure
        }
        continue;
      }
      parsed.push({ file, mtimeMs: stat.mtimeMs, task });
    } catch {
      // ignore
    }
  }

  parsed.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const filteredTasks = parsed
    .map((p) => p.task)
    .filter((t) => t && typeof t.id === 'string')
    .filter((t) => (input.status ? t.status === input.status : true))
    .filter((t) => (input.q ? String(t.id).includes(input.q) : true));
  const page = input.page ?? 1;
  const total = filteredTasks.length;
  const totalPages = Math.max(1, Math.ceil(total / input.limit));
  const start = (page - 1) * input.limit;
  const pagedTasks = filteredTasks
    .slice(start, start + input.limit)
    .map((t) =>
      toListItem({
        id: t.id,
        status: t.status,
        created_at: t.createdAt,
        updated_at: t.updatedAt || null,
        last_activity_at: t.lastActivityAt,
        task_json: t,
      }),
    );

  return { source: 'disk', items: pagedTasks, nextCursor: null, total, page, pageSize: input.limit, totalPages };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') || undefined;
  const q = url.searchParams.get('q') || undefined;
  const limit = clampLimit(Number(url.searchParams.get('limit') || 0), 50);
  const cursor = url.searchParams.get('cursor') || undefined;
  const page = clampPage(Number(url.searchParams.get('page') || 1), 1);
  const localOnly = url.searchParams.get('local') === '1';

  if (localOnly) {
    const local = listFromDisk({ status, q, limit, page });
    if (local.total > 0 || !isSupabaseConfigured()) {
      return NextResponse.json(local);
    }
    try {
      const remote = await listFromSupabase({ status, q, limit, cursor, page });
      return NextResponse.json(remote);
    } catch {
      return NextResponse.json(local);
    }
  }

  if (isSupabaseConfigured()) {
    try {
      const out = await listFromSupabase({ status, q, limit, cursor, page });
      return NextResponse.json(out);
    } catch {
      // fall through to disk
    }
  }

  return NextResponse.json(listFromDisk({ status, q, limit, page }));
}
