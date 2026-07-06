import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;

type Code2SessionRequest = {
  appid?: string;
  secret?: string;
  code?: string;
};

export async function POST(req: NextRequest) {
  const expectedToken = process.env.SUQU_WECHAT_PROXY_TOKEN || process.env.R2_UPLOAD_TOKEN || process.env.UPLOAD_TOKEN || '';
  const auth = req.headers.get('authorization') || '';
  if (!expectedToken || auth !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json()) as Code2SessionRequest;
  const appid = String(body.appid || '').trim();
  const secret = String(body.secret || '').trim();
  const code = String(body.code || '').trim();
  if (!appid || !secret || !code) {
    return NextResponse.json({ ok: false, message: 'appid, secret and code are required' }, { status: 400 });
  }

  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', appid);
  url.searchParams.set('secret', secret);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');

  const resp = await fetch(url.toString(), { cache: 'no-store' });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    return NextResponse.json({ ok: false, message: `wechat http ${resp.status}`, data }, { status: 502 });
  }

  return NextResponse.json(data);
}
