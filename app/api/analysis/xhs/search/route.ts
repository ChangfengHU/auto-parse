import { NextResponse } from 'next/server';
import { getXhsCookie } from '@/lib/analysis/xhs-cookie';

const PYTHON_API = 'http://127.0.0.1:1030';

export async function POST(req: Request) {
  try {
    const { keyword, page = 1 } = await req.json();
    if (!keyword) {
      return NextResponse.json({ error: 'Keyword is required' }, { status: 400 });
    }

    // 转发给远端 Python 服务
    const res = await fetch(`${PYTHON_API}/search?keyword=${encodeURIComponent(keyword)}&page=${page}`, {
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
    console.error('XHS Search API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
