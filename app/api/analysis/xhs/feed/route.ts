import { NextResponse } from 'next/server';
import { getXhsCookie } from '@/lib/analysis/xhs-cookie';
import { getXhsFeed } from '@/lib/analysis/xhs-backend';

export async function GET() {
  const cookie = getXhsCookie();
  if (!cookie) {
    return NextResponse.json({ error: '请先设置小红书 Cookie' }, { status: 401 });
  }

  try {
    const data = await getXhsFeed(cookie);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    console.error('XHS Feed API Error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
