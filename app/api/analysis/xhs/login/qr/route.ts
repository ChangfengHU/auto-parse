import {NextResponse} from 'next/server';
import {createXhsQr,cancelXhsQr,xhsQrError} from '@/lib/analysis/xhs-login-utils';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){
 try{return NextResponse.json(await createXhsQr(),{headers:{'Cache-Control':'no-store'}});}
 catch(error){const safe=xhsQrError(error);console.warn('[xhs-qr]',safe.reason);return NextResponse.json({ok:false,...safe},{status:503});}
}
export async function DELETE(req:Request){
 const body=await req.json().catch(()=>null);
 if(typeof body?.loginId!=='string'||!/^[a-f0-9-]{36}$/.test(body.loginId))return NextResponse.json({error:'登录会话参数无效'},{status:400});
 await cancelXhsQr(body.loginId);return NextResponse.json({ok:true});
}
