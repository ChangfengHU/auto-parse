import { NextResponse } from 'next/server';
import { getXhsCookie } from '@/lib/analysis/xhs-cookie';

const PYTHON_API = 'http://127.0.0.1:1030';

export async function GET() {
  try {
    const res = await fetch(`${PYTHON_API}/unread`, {
      method: 'GET',
      headers: {
        'X-XHS-Cookie': getXhsCookie() || '',
      },
    });
    
    if (!res.ok) {
      throw new Error(`Python API returned ${res.status}`);
    }
    
    const data = await res.json();
    return NextResponse.json({ ok: true, data });
  } catch (error: any) {
    console.error('XHS Unread API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
