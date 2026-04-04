import { NextResponse } from 'next/server';
import { getXhsCookie } from '@/lib/analysis/xhs-cookie';

export async function GET() {
  const cookie = getXhsCookie();
  if (!cookie) {
    return NextResponse.json({ error: '请先设置小红书 Cookie' }, { status: 401 });
  }

  try {
    const res = await fetch('http://127.0.0.1:1030/feed', {
      headers: {
        'X-XHS-Cookie': cookie,
        'Accept': 'application/json',
      },
      cache: 'no-store'
    });
    
    if (!res.ok) {
      throw new Error(`Python API returned ${res.status}`);
    }
    
    const data = await res.json();
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    console.error('XHS Feed API Error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
