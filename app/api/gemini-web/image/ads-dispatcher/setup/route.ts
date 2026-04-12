/**
 * GET/POST /api/gemini-web/image/ads-dispatcher/setup
 * Create Supabase tables for ads-dispatcher task manager.
 */
import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const runtime = 'nodejs';

export const SETUP_SQL = `
-- Task snapshot table (one row per dispatcher task)
CREATE TABLE IF NOT EXISTS gemini_ads_dispatcher_tasks (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ,
  task_json JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS gemini_ads_dispatcher_tasks_status_idx
  ON gemini_ads_dispatcher_tasks(status);
CREATE INDEX IF NOT EXISTS gemini_ads_dispatcher_tasks_updated_at_idx
  ON gemini_ads_dispatcher_tasks(updated_at DESC);
CREATE INDEX IF NOT EXISTS gemini_ads_dispatcher_tasks_created_at_idx
  ON gemini_ads_dispatcher_tasks(created_at DESC);

ALTER TABLE gemini_ads_dispatcher_tasks DISABLE ROW LEVEL SECURITY;

-- Unified trace events table (works for dispatcher/batch/ha...)
CREATE TABLE IF NOT EXISTS gemini_task_traces (
  id BIGSERIAL PRIMARY KEY,
  namespace TEXT NOT NULL,
  task_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  event TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS gemini_task_traces_task_ts_idx
  ON gemini_task_traces(namespace, task_id, ts);

ALTER TABLE gemini_task_traces DISABLE ROW LEVEL SECURITY;
`.trim();

async function execSql(sql: string) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`exec_sql failed: HTTP ${res.status} ${text}`);
  }
}

export async function POST() {
  try {
    await execSql(SETUP_SQL);
    return NextResponse.json({ ok: true, message: 'tables created' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message, sql: SETUP_SQL }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ sql: SETUP_SQL });
}
