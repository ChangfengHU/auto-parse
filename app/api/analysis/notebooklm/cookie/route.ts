/**
 * GET  /api/analysis/notebooklm/cookie?clientId=nl_xxx  — 获取 storage_state.json
 * POST /api/analysis/notebooklm/cookie                  — 存储 storage_state.json
 */
import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TABLE = 'douyin_sessions';

function headers() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId')?.trim();
  if (!clientId) return NextResponse.json({ error: '缺少 clientId' }, { status: 400 });

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${TABLE}?client_id=eq.${encodeURIComponent(clientId)}&select=cookie_str&limit=1`,
    { headers: headers() }
  );
  if (!res.ok) return NextResponse.json({ error: 'Supabase 查询失败' }, { status: 502 });

  const rows = await res.json() as Array<{ cookie_str?: string }>;
  const raw = rows[0]?.cookie_str?.trim();
  if (!raw) return NextResponse.json({ error: '未找到该 clientId 的认证信息' }, { status: 404 });

  // raw 是 storage_state.json 的 JSON 字符串
  try {
    const storageState = JSON.parse(raw);
    return NextResponse.json({ ok: true, storage_state: storageState });
  } catch {
    return NextResponse.json({ error: '数据格式错误' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { storage_state?: object; clientId?: string };
  const { storage_state, clientId } = body;

  if (!storage_state || !clientId) {
    return NextResponse.json({ error: 'storage_state 和 clientId 不能为空' }, { status: 400 });
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=client_id`,
    {
      method: 'POST',
      headers: { ...headers(), Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        client_id: clientId.trim(),
        cookie_str: JSON.stringify(storage_state),
        updated_at: new Date().toISOString(),
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: `Supabase 写入失败: ${err}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true, clientId });
}
