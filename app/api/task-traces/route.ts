import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { taskTraceFile } from '@/lib/workflow/task-trace';

export const runtime = 'nodejs';

type SupabaseRow = {
  ts: string;
  event: string;
  payload: Record<string, unknown>;
};

type TraceEvent = {
  ts: string;
  event: string;
  payload: Record<string, unknown>;
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

function clampTail(n: number, def = 500) {
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.max(1, Math.min(5000, Math.floor(n)));
}

function parseJsonlTail(file: string, tail: number): TraceEvent[] {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  const picked = lines.slice(Math.max(0, lines.length - tail));

  const out: TraceEvent[] = [];
  for (const line of picked) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const ts = typeof obj.ts === 'string' ? obj.ts : '';
      const event = typeof obj.event === 'string' ? obj.event : '';
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'ts' || k === 'event') continue;
        payload[k] = v;
      }
      if (ts && event) out.push({ ts, event, payload });
    } catch {
      // ignore
    }
  }

  return out;
}

async function listFromSupabase(input: { namespace: string; taskId: string; tail: number }) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/gemini_task_traces`);
  url.searchParams.set('select', 'ts,event,payload');
  url.searchParams.set('namespace', `eq.${input.namespace}`);
  url.searchParams.set('task_id', `eq.${input.taskId}`);
  url.searchParams.set('order', 'ts.desc');
  url.searchParams.set('limit', String(input.tail));

  const res = await fetch(url.toString(), { method: 'GET', headers: supabaseHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase query failed: HTTP ${res.status} ${text}`);
  }

  const rows = (await res.json()) as SupabaseRow[];
  const events = rows
    .map((r) => ({ ts: r.ts, event: r.event, payload: r.payload || {} }))
    .reverse();
  return { source: 'supabase', events };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const namespace = url.searchParams.get('namespace') || url.searchParams.get('ns') || '';
  const taskId = url.searchParams.get('taskId') || url.searchParams.get('id') || '';
  const tail = clampTail(Number(url.searchParams.get('tail') || 0), 500);

  if (!namespace || !taskId) {
    return NextResponse.json({ error: 'Missing namespace/taskId' }, { status: 400 });
  }

  if (isSupabaseConfigured()) {
    try {
      const out = await listFromSupabase({ namespace, taskId, tail });
      return NextResponse.json({ namespace, taskId, ...out });
    } catch {
      // fall through to disk
    }
  }

  const file = taskTraceFile(namespace, taskId);
  const events = parseJsonlTail(file, tail);
  return NextResponse.json({ namespace, taskId, source: 'disk', file: path.relative(process.cwd(), file), events });
}
