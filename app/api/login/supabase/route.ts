import { NextRequest, NextResponse } from 'next/server';
import { validateDouyinSession } from '@/lib/parse/douyin-session';
import { assertSupabaseRestConfig, parseSupabaseError } from '@/lib/supabase/rest-config';

/**
 * GET /api/login/supabase?clientId=dy_xxx
 * 从 Supabase 查询登录信息，并实时验证 session 有效性
 */
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId')?.trim();
  if (!clientId) {
    return NextResponse.json({ error: '缺少 clientId 参数' }, { status: 400 });
  }

  try {
    const { url: SUPABASE_URL, key: SUPABASE_SERVICE_KEY } = assertSupabaseRestConfig();
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/douyin_sessions?client_id=eq.${encodeURIComponent(clientId)}&select=*&limit=1`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );

    if (!res.ok) {
      return NextResponse.json({ error: await parseSupabaseError(res) }, { status: 500 });
    }

    const rows = await res.json() as Array<{
      client_id: string;
      cookie_str: string;
      account_name: string | null;
      updated_at: string;
    }>;

    if (!rows.length) {
      return NextResponse.json({ found: false, message: '未找到该凭证的登录信息，请先安装插件并同步' });
    }

    const row = rows[0];
    const ageDays = (Date.now() - new Date(row.updated_at).getTime()) / (1000 * 60 * 60 * 24);

    // 检查 sessionid 是否存在
    if (!row.cookie_str.includes('sessionid=')) {
      return NextResponse.json({
        found: true,
        expired: true,
        message: 'Cookie 中无 sessionid，请重新用插件同步',
      });
    }

    // 实时调用抖音 API 验证 session 是否有效
    const { loggedIn: sessionValid } = await validateDouyinSession(row.cookie_str);
    const account = row.account_name ?? null;

    if (!sessionValid) {
      return NextResponse.json({
        found: true,
        expired: true,
        cookieStr: null,
        message: '抖音 Session 已失效，请重新登录抖音后插件会自动同步',
      });
    }

    // session 有效
    return NextResponse.json({
      found: true,
      expired: false,
      account,
      updatedAt: row.updated_at,
      ageDays: Math.floor(ageDays),
      cookieStr: row.cookie_str,
      message: `✓ 登录有效${account ? `（${account}）` : ''}，${Math.floor(ageDays * 24)} 小时前同步`,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
