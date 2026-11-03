import {resolveWechatVerificationGrant} from '@/lib/wechat/web-verification-link';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store, max-age=0','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; connect-src 'self'; img-src blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"};
export async function GET(){
 const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>公众号发布验证</title><style>body{font:16px system-ui;text-align:center;margin:50px auto;padding:0 18px;max-width:480px;line-height:1.6}img{max-width:90%;height:auto}</style></head><body><h1>公众号发布验证</h1><p id="status">等待微信验证页面...</p><img id="qr" width="280" height="280" alt="公众号管理员验证二维码" hidden><p>请勿将此链接转发给他人。</p><script>
const grant=location.hash.slice(1), status=document.getElementById('status'),qr=document.getElementById('qr');let lastUrl='';
async function update(){try{const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant}),cache:'no-store'});if(r.status===410){status.textContent='验证链接已失效，请从 MCP 获取新的入口。';qr.hidden=true;return}if(!r.ok){status.textContent='等待微信二维码，或验证已经结束；请查询 MCP 发布状态。';qr.hidden=true}else{const blob=await r.blob(), next=URL.createObjectURL(blob);qr.src=next;qr.hidden=false;status.textContent='请用公众号管理员微信扫描二维码并确认。';if(lastUrl)URL.revokeObjectURL(lastUrl);lastUrl=next}}catch{status.textContent='验证页面暂时不可用，正在重试。'}setTimeout(update,5000)}if(/^[A-Za-z0-9_-]{43}$/.test(grant))update();else status.textContent='验证链接无效。';
</script></body></html>`;
 return new Response(html,{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
}
export async function POST(request:Request){
 const raw=await request.text();
 if(raw.length>256)return new Response('无效请求',{status:400,headers});
 let token='';try{const data=JSON.parse(raw);if(typeof data.grant==='string')token=data.grant}catch{return new Response('无效请求',{status:400,headers})}
 const session=resolveWechatVerificationGrant(token);
 if(!session?._page)return new Response('验证链接已失效。',{status:410,headers});
 const page=session._page;
 const valid=page.url().startsWith('https://mp.weixin.qq.com/') && await page.getByText('扫码后，请联系管理员进行验证',{exact:true}).isVisible().catch(()=>false);
 if(!valid)return new Response('二维码尚未显示或验证已结束。',{status:409,headers});
 const qr=page.locator('img.qrcode.js_qrcode:visible');
 if(await qr.count()!==1)return new Response('二维码暂不可用。',{status:409,headers});
 const png=await qr.screenshot({type:'png',timeout:5000}).catch(()=>undefined);
 return png?new Response(new Uint8Array(png),{headers:{...headers,'Content-Type':'image/png'}}):new Response('二维码暂不可用。',{status:409,headers});
}
