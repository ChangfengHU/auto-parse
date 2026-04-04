/**
 * POST /api/analysis/xhs
 * body: { url: string }
 * 纯 HTTP 解析小红书帖子（不使用 Playwright）
 */

import { NextResponse } from 'next/server';
import { fetchXhsPost } from '@/lib/analysis/xhs-fetch';

export async function POST(req: Request) {
  const { url } = await req.json() as { url?: string };

  if (!url?.trim()) {
    return NextResponse.json({ error: '请输入链接' }, { status: 400 });
  }

  const isXhsLink = url.includes('xiaohongshu.com') || url.includes('xhslink.com');
  if (!isXhsLink) {
    return NextResponse.json({ 
      error: '该输入似乎不是有效的小红书链接。如果您想搜索内容，请使用“全网搜爆款”功能。',
      suggestion: 'search'
    }, { status: 400 });
  }

  try {
    const data = await fetchXhsPost(url.trim());
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error }, { status: 500 });
  }
}
