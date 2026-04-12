/**
 * GET  /api/analysis/xhs/cookie  — 查询 Cookie 状态
 * POST /api/analysis/xhs/cookie  — 按凭证 ID 或直接 Cookie 注入
 * DELETE /api/analysis/xhs/cookie — 清除 Cookie
 */

import { NextResponse } from 'next/server';
import { setXhsCookie, getXhsCookie, clearXhsCookie, hasXhsCookie } from '@/lib/analysis/xhs-cookie';
import { getPlatformSessionCookie, upsertPlatformSession } from '@/lib/analysis/platform-session';

export async function GET() {
  const cookie = getXhsCookie();
  if (!cookie) return NextResponse.json({ set: false });

  // 简单展示 cookie 的前20字符，不暴露完整值
  return NextResponse.json({
    set: true,
    preview: cookie.slice(0, 40) + (cookie.length > 40 ? '...' : ''),
  });
}

export async function POST(req: Request) {
  const body = await req.json() as { clientId?: string; cookie?: string };
  const rawCookie = body.cookie?.trim();
  const clientId = body.clientId?.trim();

  if (rawCookie) {
    setXhsCookie(rawCookie);
    if (clientId) {
      await upsertPlatformSession('xhs', clientId, rawCookie);
    }
    return NextResponse.json({ ok: true, set: hasXhsCookie(), source: 'cookie' });
  }

  if (!clientId) {
    return NextResponse.json(
      { error: 'cookie 或 clientId 至少提供一个（示例 clientId：xhs_4cbc57e24e94447a912c0f8acc2ed2b9）' },
      { status: 400 }
    );
  }

  const cookie = await getPlatformSessionCookie('xhs', clientId);
  if (!cookie) {
    return NextResponse.json({ error: `未找到凭证 ${clientId} 对应的登录信息` }, { status: 404 });
  }

  setXhsCookie(cookie);
  return NextResponse.json({ ok: true, set: hasXhsCookie(), clientId, source: 'credential' });
}

export async function DELETE() {
  clearXhsCookie();
  return NextResponse.json({ ok: true });
}
