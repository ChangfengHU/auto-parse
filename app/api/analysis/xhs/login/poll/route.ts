import {NextResponse} from 'next/server';
import {pollXhsQr,xhsQrError} from '@/lib/analysis/xhs-login-utils';
import {setXhsCookie} from '@/lib/analysis/xhs-cookie';
import {upsertPlatformSession} from '@/lib/analysis/platform-session';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 const body=await req.json().catch(()=>null);
 if(typeof body?.loginId!=='string'||!/^[a-f0-9-]{36}$/.test(body.loginId))return NextResponse.json({ok:false,error:'登录会话已更新，请刷新页面后重新扫码'},{status:400});
 if(body.clientId&&!(typeof body.clientId==='string'&&/^xhs_[A-Za-z0-9_-]{8,100}$/.test(body.clientId)))return NextResponse.json({ok:false,error:'小红书凭证ID格式不正确'},{status:400});
 try{
  const result=await pollXhsQr(body.loginId);
  if(result.status_text==='success'&&result.cookies){
   const cookie=Object.entries(result.cookies).map(([k,v])=>k+'='+v).join('; ');
   setXhsCookie(cookie);
   if(body.clientId)await upsertPlatformSession('xhs',body.clientId,cookie);
  }
  const {cookies,...publicResult}=result;void cookies;
  return NextResponse.json(publicResult,{headers:{'Cache-Control':'no-store'}});
 }catch(error){const safe=xhsQrError(error);console.warn('[xhs-qr]',safe.reason);return NextResponse.json({ok:false,...safe},{status:503});}
}
