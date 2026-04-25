import { NextResponse } from 'next/server';
import { getXhsUnread } from '@/lib/analysis/xhs-backend';
import { getXhsCookie } from '@/lib/analysis/xhs-cookie';

function isCertificateVerifyError(message: string) {
  return message.includes('CERTIFICATE_VERIFY_FAILED') || message.includes('self-signed certificate');
}

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
    if (isCertificateVerifyError(message)) {
      return NextResponse.json(
        {
          ok: false,
          valid: false,
          error: `Python 请求小红书时证书校验失败，不代表登录信息失效。可在本地开发环境设置 XHS_SSL_VERIFY=false 后重启服务：${message}`,
          reason: 'certificate_verify_failed',
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { ok: false, valid: false, error: `登录信息可能失效：${message}` },
      { status: 500 }
    );
  }
}
