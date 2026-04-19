import { NextRequest, NextResponse } from 'next/server';
import { pollXhsQr } from '@/lib/analysis/xhs-login-utils';
import { setXhsCookie } from '@/lib/analysis/xhs-cookie';
import { upsertPlatformSession } from '@/lib/analysis/platform-session';

export async function POST(req: NextRequest) {
  try {
    const { qr_id, code, a1, webid, cookies, clientId } = await req.json();
    
    if (!qr_id || !code || !a1 || !webid || !cookies) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const result = await pollXhsQr(qr_id, code, a1, webid, cookies);
    
    if (result.ok && result.cookies) {
      if (result.status_text === 'success') {
        const cookieStr = Object.entries(result.cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join('; ');
        
        setXhsCookie(cookieStr);
        
        if (clientId) {
          try {
            await upsertPlatformSession('xhs', clientId, cookieStr);
          } catch (dbErr) {
            console.error('Failed to sync XHS session to Supabase:', dbErr);
          }
        }
      }
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Poll XHS QR Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
