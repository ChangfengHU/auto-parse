import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

// Cookie 超过 14 天视为可能已过期
const EXPIRE_DAYS = 14;

/** 用存储的 cookie 实际调用抖音 API，验证 session 是否仍有效
 *  使用 /web/api/media/aweme/post/ 接口：
 *  - status_code 0  → 已登录
 *  - status_code 8  → 未登录（session 失效）
 *  - 其他 / 超时   → 保守处理，不阻断
 */
async function validateCookieWithDouyin(cookieStr: string): Promise<{ valid: boolean; account: string | null }> {
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
    if (!res.ok) return { valid: true, account: null }; // 5xx 等异常保守处理
    const data = await res.json() as { status_code?: number };
    if (data?.status_code === 8) return { valid: false, account: null }; // 明确未登录
    if (data?.status_code === 0) return { valid: true,  account: null }; // 明确已登录
    return { valid: true, account: null }; // 其他 code 保守处理
  } catch {
    return { valid: true, account: null }; // 网络超时保守处理
  }
}

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
    const { valid: sessionValid, account: liveAccount } = await validateCookieWithDouyin(row.cookie_str);
    const account = liveAccount ?? row.account_name ?? null;

    if (!sessionValid) {
      return NextResponse.json({
        found: true,
        expired: true,
        cookieStr: null,
        message: '抖音 Session 已失效，请重新登录抖音后插件会自动同步',
      });
    }

    // session 有效
    const expired = ageDays > EXPIRE_DAYS;
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
