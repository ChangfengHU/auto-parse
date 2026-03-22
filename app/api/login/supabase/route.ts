import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://okkgchwzppghiyfgmrlj.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ra2djaHd6cHBnaGl5ZmdtcmxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0OTY1NDA1MCwiZXhwIjoyMDY1MjMwMDUwfQ.tyKEsDr9lq2WtowiN0lBwKU2sxkKdRk6phBswiK88rE';

// Cookie 超过 14 天视为可能已过期
const EXPIRE_DAYS = 14;

/**
 * GET /api/login/supabase?clientId=dy_xxx
 * 从 Supabase 查询登录信息，返回有效性状态和 cookieStr
 */
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId')?.trim();
  if (!clientId) {
    return NextResponse.json({ error: '缺少 clientId 参数' }, { status: 400 });
  }

  try {
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
      return NextResponse.json({ error: `Supabase 请求失败: ${res.status}` }, { status: 500 });
    }

    const rows = await res.json() as Array<{
      client_id: string;
      cookie_str: string;
      account: string | null;
      user_agent: string | null;
      updated_at: string;
    }>;

    if (!rows.length) {
      return NextResponse.json({ found: false, message: '未找到该凭证的登录信息，请先安装插件并同步' });
    }

    const row = rows[0];
    const updatedAt = new Date(row.updated_at);
    const ageDays = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);
    const expired = ageDays > EXPIRE_DAYS;

    // 检查 sessionid 是否存在
    const hasSession = row.cookie_str.includes('sessionid=');
    if (!hasSession) {
      return NextResponse.json({
        found: true,
        expired: true,
        message: 'Cookie 中无 sessionid，请重新用插件同步',
      });
    }

    return NextResponse.json({
      found: true,
      expired,
      account: row.account ?? null,
      updatedAt: row.updated_at,
      ageDays: Math.floor(ageDays),
      cookieStr: expired ? null : row.cookie_str,
      message: expired
        ? `已同步 ${Math.floor(ageDays)} 天，Cookie 可能已过期，建议重新同步`
        : `登录信息有效（${row.account ? `${row.account}，` : ''}${Math.floor(ageDays)} 天前同步）`,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
