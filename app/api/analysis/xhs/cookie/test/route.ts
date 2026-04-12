import { NextResponse } from 'next/server';
import { getXhsUnread } from '@/lib/analysis/xhs-backend';
import { getXhsCookie } from '@/lib/analysis/xhs-cookie';

export async function GET() {
  const cookie = getXhsCookie();
  if (!cookie) {
    return NextResponse.json(
      { ok: false, valid: false, error: '未检测到登录信息，请先输入凭证 ID 或 Cookie' },
      { status: 401 }
    );
  }

  try {
    await getXhsUnread(cookie);
    return NextResponse.json({ ok: true, valid: true, message: '登录信息有效' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { ok: false, valid: false, error: `登录信息可能失效：${message}` },
      { status: 500 }
    );
  }
}
