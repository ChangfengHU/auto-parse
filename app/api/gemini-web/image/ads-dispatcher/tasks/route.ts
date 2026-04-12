import fs from 'fs';
import os from 'os';
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

function toListItem(row: Row) {
  const task = row.task_json || {};
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at || (task.createdAt as string | undefined) || null,
    updatedAt: row.updated_at || (task.updatedAt as string | undefined) || null,
    lastActivityAt: row.last_activity_at || (task.lastActivityAt as string | undefined) || null,
    startedAt: (task.startedAt as string | undefined) || null,
    endedAt: (task.endedAt as string | undefined) || null,
    summary: (task.summary as unknown) || null,
    settings: (task.settings as unknown) || null,
    queue: getGeminiAdsDispatcherQueueInfo(row.id),
  };
}

async function listFromSupabase(input: { status?: string; q?: string; limit: number; cursor?: string }) {
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

  if (input.cursor) {
    url.searchParams.set('updated_at', `lt.${input.cursor}`);
  }

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: supabaseHeaders(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase query failed: HTTP ${res.status} ${text}`);
  }

  const rows = (await res.json()) as Row[];
  const items = rows.map(toListItem);
  const nextCursor = rows.length > 0 ? rows[rows.length - 1].updated_at || null : null;

  return { source: 'supabase', items, nextCursor };
}

function listFromDisk(input: { status?: string; q?: string; limit: number }) {
  const dir = path.join(os.tmpdir(), 'gemini-ads-dispatcher-task-cache');
  if (!fs.existsSync(dir)) {
    return { source: 'disk', items: [], nextCursor: null };
  }

  const candidates = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .filter((name) => name !== 'queue.json')
    .map((name) => path.join(dir, name));

  const parsed: Array<{ file: string; mtimeMs: number; task: any }> = [];
  for (const file of candidates) {
    try {
      const stat = fs.statSync(file);
      const task = JSON.parse(fs.readFileSync(file, 'utf8')) as any;
      parsed.push({ file, mtimeMs: stat.mtimeMs, task });
    } catch {
      // ignore
    }
  }

  parsed.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const filtered = parsed
    .map((p) => p.task)
    .filter((t) => t && typeof t.id === 'string')
    .filter((t) => (input.status ? t.status === input.status : true))
    .filter((t) => (input.q ? String(t.id).includes(input.q) : true))
    .slice(0, input.limit)
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

  return { source: 'disk', items: filtered, nextCursor: null };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') || undefined;
  const q = url.searchParams.get('q') || undefined;
  const limit = clampLimit(Number(url.searchParams.get('limit') || 0), 50);
  const cursor = url.searchParams.get('cursor') || undefined;

  if (isSupabaseConfigured()) {
    try {
      const out = await listFromSupabase({ status, q, limit, cursor });
      return NextResponse.json(out);
    } catch {
      // fall through to disk
    }
  }

  return NextResponse.json(listFromDisk({ status, q, limit }));
}
