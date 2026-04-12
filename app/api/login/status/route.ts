import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * 用存储的 cookie 调用抖音 creator API 验证 session
 * - status_code 0 → 已登录
 * - status_code 8 → 未登录（session 失效）
 * - 其他/超时   → 保守处理，不阻断
 */
async function validateSession(cookieStr: string): Promise<{ loggedIn: boolean; account: string | null }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(
      'https://creator.douyin.com/web/api/media/aweme/post/?count=1&cursor=0',
      {
        headers: {
          Cookie: cookieStr,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Referer: 'https://creator.douyin.com/',
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    if (!res.ok) return { loggedIn: true, account: null }; // 5xx 保守处理
    const data = await res.json() as { status_code?: number };
    if (data?.status_code === 8) return { loggedIn: false, account: null };
    if (data?.status_code === 0) return { loggedIn: true,  account: null };
    return { loggedIn: true, account: null };
  } catch {
    return { loggedIn: true, account: null }; // 超时保守处理
  }
}

/**
 * GET /api/login/status?clientId=dy_xxx
 *
 * 通过插件凭证查询抖音登录状态（实时验证 session）
 *
 * 响应示例（已登录）：
 * { "loggedIn": true, "clientId": "dy_xxx", "account": "用户名", "updatedAt": "...", "message": "已登录（已验证）" }
 *
 * 响应示例（未登录）：
 * { "loggedIn": false, "clientId": "dy_xxx", "message": "Session 已失效，请重新登录抖音后插件会自动同步" }
 *
 * 响应示例（凭证无效）：
 * { "loggedIn": false, "clientId": "dy_xxx", "message": "未找到该凭证，请先安装插件并同步" }
 */
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId')?.trim();
  if (!clientId) {
    return NextResponse.json(
      { error: '缺少 clientId 参数，用法：GET /api/login/status?clientId=dy_xxx' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    // 1. 从 Supabase 取 cookie
    const sbRes = await fetch(
      `${SUPABASE_URL}/rest/v1/douyin_sessions?client_id=eq.${encodeURIComponent(clientId)}&select=cookie_str,account_name,updated_at&limit=1`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    if (!sbRes.ok) {
      return NextResponse.json(
        { error: `Supabase 查询失败: ${sbRes.status}` },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    const rows = await sbRes.json() as Array<{
      cookie_str: string;
      account_name: string | null;
      updated_at: string;
    }>;

    if (!rows.length) {
      return NextResponse.json({
        loggedIn: false,
        clientId,
        message: '未找到该凭证，请先安装插件并同步',
      }, { headers: CORS_HEADERS });
    }

    const row = rows[0];

    // 2. 基础检查：cookie 里有没有 sessionid
    if (!row.cookie_str.includes('sessionid=')) {
      return NextResponse.json({
        loggedIn: false,
        clientId,
        updatedAt: row.updated_at,
        message: 'Cookie 中无 sessionid，请重新登录抖音后插件会自动同步',
      }, { headers: CORS_HEADERS });
    }

    // 3. 实时验证 session
    const { loggedIn } = await validateSession(row.cookie_str);
    const account = row.account_name ?? null;
    const ageDays = (Date.now() - new Date(row.updated_at).getTime()) / (1000 * 60 * 60 * 24);

    if (!loggedIn) {
      return NextResponse.json({
        loggedIn: false,
        clientId,
        updatedAt: row.updated_at,
        message: 'Session 已失效，请重新登录抖音后插件会自动同步',
      }, { headers: CORS_HEADERS });
    }

    return NextResponse.json({
      loggedIn: true,
      clientId,
      account,
      updatedAt: row.updated_at,
      ageDays: Math.floor(ageDays),
      message: `已登录（已验证）${account ? `，账号：${account}` : ''}，${Math.floor(ageDays * 24)} 小时前同步`,
    }, { headers: CORS_HEADERS });

  } catch (e) {
    return NextResponse.json(
      { error: String(e) },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
