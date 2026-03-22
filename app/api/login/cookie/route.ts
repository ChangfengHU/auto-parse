import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// 允许浏览器插件跨域调用
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

const COOKIE_FILE = path.join(process.cwd(), '.douyin-cookie.json');

function parseCookieStr(cookieStr: string) {
  return cookieStr.split(';').map(c => {
    const idx = c.indexOf('=');
    if (idx < 0) return null;
    return {
      name: c.slice(0, idx).trim(),
      value: c.slice(idx + 1).trim(),
      domain: '.douyin.com',
      path: '/',
      secure: true,
      sameSite: 'None' as const,
    };
  }).filter((c): c is NonNullable<typeof c> => !!(c?.name && c?.value));
}

// POST /api/login/cookie — 接收 cookie 字符串，解析后保存到本地文件
export async function POST(req: NextRequest) {
  try {
    const { cookieStr } = await req.json() as { cookieStr?: string };
    if (!cookieStr?.trim()) {
      return NextResponse.json({ error: '请提供 Cookie 字符串' }, { status: 400 });
    }

    const cookies = parseCookieStr(cookieStr);
    const hasSession = cookies.some(c => c.name === 'sessionid' || c.name === 'sessionid_ss');
    if (!hasSession) {
      return NextResponse.json({ error: 'Cookie 中未找到 sessionid，请确认复制完整' }, { status: 400 });
    }

    fs.writeFileSync(COOKIE_FILE, JSON.stringify({
      cookies,
      updatedAt: Date.now(),
      source: 'manual',
    }, null, 2));

    return NextResponse.json({ ok: true, cookieCount: cookies.length }, { headers: CORS_HEADERS });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500, headers: CORS_HEADERS });
  }
}
