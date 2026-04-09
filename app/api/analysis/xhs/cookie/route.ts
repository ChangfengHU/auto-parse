/**
 * GET  /api/analysis/xhs/cookie  — 查询 Cookie 状态
 * POST /api/analysis/xhs/cookie  — 设置 Cookie（手动输入 or 插件调用）
 * DELETE /api/analysis/xhs/cookie — 清除 Cookie
 */

import { NextResponse } from 'next/server';
import { setXhsCookie, getXhsCookie, clearXhsCookie, hasXhsCookie } from '@/lib/analysis/xhs-cookie';
import { upsertPlatformSession } from '@/lib/analysis/platform-session';

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
  const body = await req.json() as { cookie?: string; clientId?: string };
  const raw = body.cookie?.trim();
  if (!raw) return NextResponse.json({ error: 'cookie 不能为空' }, { status: 400 });

  setXhsCookie(raw);
  const clientId = body.clientId?.trim();
  if (clientId) {
    await upsertPlatformSession('xhs', clientId, raw);
  }
  return NextResponse.json({ ok: true, set: hasXhsCookie() });
}

export async function DELETE() {
  clearXhsCookie();
  return NextResponse.json({ ok: true });
}
