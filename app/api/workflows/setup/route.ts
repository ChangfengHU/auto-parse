/**
 * POST /api/workflows/setup
 * 在 Supabase 中创建 rpa_workflows 表（需要 exec_sql RPC 权限）
 * 若 RPC 不可用，返回建表 SQL 让用户手动执行
 */
import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://okkgchwzppghiyfgmrlj.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ra2djaHd6cHBnaGl5ZmdtcmxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0OTY1NDA1MCwiZXhwIjoyMDY1MjMwMDUwfQ.tyKEsDr9lq2WtowiN0lBwKU2sxkKdRk6phBswiK88rE';

export const SETUP_SQL = `
CREATE TABLE IF NOT EXISTS rpa_workflows (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  nodes       JSONB NOT NULL DEFAULT '[]',
  vars        JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
-- 关闭 RLS（服务端 key 访问）
ALTER TABLE rpa_workflows DISABLE ROW LEVEL SECURITY;
`.trim();

export async function POST() {
  // 尝试通过 Supabase SQL 执行（若有 exec_sql RPC）
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql: SETUP_SQL }),
  });

  if (res.ok) {
    return NextResponse.json({ ok: true, message: '表创建成功' });
  }

  // RPC 不可用，返回 SQL 让用户手动执行
  return NextResponse.json({
    ok: false,
    message: '请在 Supabase Studio → SQL Editor 中执行以下 SQL',
    sql: SETUP_SQL,
  });
}

export async function GET() {
  return NextResponse.json({ sql: SETUP_SQL });
}
