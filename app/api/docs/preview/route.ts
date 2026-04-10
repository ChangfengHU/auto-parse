import { NextRequest, NextResponse } from 'next/server';

const OSS_BASE = process.env.OSS_PUBLIC_BASE_URL || 'http://articel.oss-cn-hangzhou.aliyuncs.com';

function normalizeKey(raw: string) {
  return raw.replace(/^\/+/, '');
}

export async function GET(req: NextRequest) {
  const key = normalizeKey(String(req.nextUrl.searchParams.get('key') || ''));
  if (!key) {
    return NextResponse.json({ success: false, error: '缺少 key 参数' }, { status: 400 });
  }

  const sourceUrl = `${OSS_BASE}/${encodeURI(key)}`;
  const upstream = await fetch(sourceUrl, { cache: 'no-store' });
  if (!upstream.ok) {
    return NextResponse.json(
      { success: false, error: `预览拉取失败: HTTP ${upstream.status}`, sourceUrl },
      { status: 502 }
    );
  }

  const content = await upstream.text();
  return new NextResponse(content, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': 'inline',
      'Cache-Control': 'no-store',
    },
  });
}

