import { NextResponse } from 'next/server';
import { getXhsCookie } from '@/lib/analysis/xhs-cookie';
import { getXhsUnread } from '@/lib/analysis/xhs-backend';

export async function GET() {
  try {
    const cookie = getXhsCookie();
    if (!cookie) {
      return NextResponse.json({ error: '请先设置小红书 Cookie' }, { status: 401 });
    }

    const data = await getXhsUnread(cookie);
    return NextResponse.json({ ok: true, data });
  } catch (error: unknown) {
    console.error('XHS Unread API Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
