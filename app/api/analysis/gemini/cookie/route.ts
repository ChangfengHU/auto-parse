/**
 * GET  /api/analysis/gemini/cookie  — 查询 Cookie 状态
 * POST /api/analysis/gemini/cookie  — 设置 Cookie（手动输入 or 插件调用）
 * DELETE /api/analysis/gemini/cookie — 清除 Cookie
 */

import { NextResponse } from 'next/server';
import { setGeminiCookie, getGeminiCookie, clearGeminiCookie, hasGeminiCookie } from '@/lib/analysis/gemini-cookie';
import { upsertPlatformSession } from '@/lib/analysis/platform-session';

export async function GET() {
  const cookie = getGeminiCookie();
  if (!cookie) return NextResponse.json({ set: false });

  return NextResponse.json({
    set: true,
    preview: cookie.slice(0, 40) + (cookie.length > 40 ? '...' : ''),
  });
}

export async function POST(req: Request) {
  const body = await req.json() as { cookie?: string; clientId?: string };
  const raw = body.cookie?.trim();
  if (!raw) return NextResponse.json({ error: 'cookie 不能为空' }, { status: 400 });

  setGeminiCookie(raw);
  const clientId = body.clientId?.trim();
  if (clientId) {
    await upsertPlatformSession('gemini', clientId, raw);
  }
  return NextResponse.json({ ok: true, set: hasGeminiCookie() });
}

export async function DELETE() {
  clearGeminiCookie();
  return NextResponse.json({ ok: true });
}
