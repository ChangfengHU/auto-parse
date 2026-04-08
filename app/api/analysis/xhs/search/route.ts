import { NextResponse } from 'next/server';
import { getXhsCookie } from '@/lib/analysis/xhs-cookie';
import { searchXhsNotes } from '@/lib/analysis/xhs-backend';

export async function POST(req: Request) {
  try {
    const { keyword, page = 1 } = await req.json();
    if (!keyword) {
      return NextResponse.json({ error: 'Keyword is required' }, { status: 400 });
    }
    const cookie = getXhsCookie();
    if (!cookie) {
      return NextResponse.json({ error: '请先设置小红书 Cookie' }, { status: 401 });
    }

    const data = await searchXhsNotes(cookie, keyword, Number(page) || 1);
    return NextResponse.json({ ok: true, data });
  } catch (error: unknown) {
    console.error('XHS Search API Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
