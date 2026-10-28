import {NextResponse} from 'next/server';
import {syncXhsBrowserLogin,xhsQrError} from '@/lib/analysis/xhs-login-utils';
import {setXhsCookie} from '@/lib/analysis/xhs-cookie';
import {upsertPlatformSession} from '@/lib/analysis/platform-session';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(req:Request){
 const body=await req.json().catch(()=>null);
 if(![1,2].includes(body?.browserInstance)||body?.confirmBrowserControl!==true)return NextResponse.json({ok:false,error:'请选择浏览器并确认同步'},{status:400});
 if(body.clientId&&!(typeof body.clientId==='string'&&/^xhs_[A-Za-z0-9_-]{8,100}$/.test(body.clientId)))return NextResponse.json({ok:false,error:'小红书凭证ID格式不正确'},{status:400});
 try{
  const result=await syncXhsBrowserLogin(body.browserInstance);
  const cookie=Object.entries(result.cookies).map(([k,v])=>k+'='+v).join('; ');
  setXhsCookie(cookie);
  if(body.clientId)await upsertPlatformSession('xhs',body.clientId,cookie);
  return NextResponse.json({ok:true,source:'browser',browserInstance:result.browserInstance,userId:result.userId,nickname:result.nickname},{headers:{'Cache-Control':'no-store'}});
 }catch(error){const safe=xhsQrError(error);console.warn('[xhs-browser-sync]',safe.reason);return NextResponse.json({ok:false,...safe},{status:503});}
}
