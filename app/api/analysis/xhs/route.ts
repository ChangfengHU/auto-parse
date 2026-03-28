/**
 * POST /api/analysis/xhs
 * body: { url: string }
 * 纯 HTTP 解析小红书帖子（不使用 Playwright）
 */

import { NextResponse } from 'next/server';
import { fetchXhsPost } from '@/lib/analysis/xhs-fetch';
import { hasXhsCookie } from '@/lib/analysis/xhs-cookie';

export async function POST(req: Request) {
  const { url } = await req.json() as { url?: string };

  if (!url?.trim()) {
    return NextResponse.json({ error: '请输入链接' }, { status: 400 });
  }

  if (!hasXhsCookie()) {
    return NextResponse.json({ error: '请先设置小红书 Cookie' }, { status: 401 });
  }

  try {
    const data = await fetchXhsPost(url.trim());
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error }, { status: 500 });
  }
}
