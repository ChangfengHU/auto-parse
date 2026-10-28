import {randomUUID,createHash} from 'node:crypto';
import {chromium,type Browser,type Page} from 'playwright';
import {acquireManagedBrowserActivity} from '../workflow/browser-activity';

const TTL=240000;
const ENDPOINT='http://127.0.0.1:9222';
type LoginState='waiting'|'scanned'|'verifying'|'success'|'expired'|'failed';
type Login={id:string;trace:string;page:Page;browser:Browser;release:()=>Promise<void>;expiresAt:number;state:LoginState;userId?:string;cookies?:Record<string,string>;url?:string;timer?:ReturnType<typeof setTimeout>;closed:boolean;finishing?:Promise<void>;error?:string};
declare global{var __xhsBrowserQrLogins:Map<string,Login>|undefined;}
const logins=()=>global.__xhsBrowserQrLogins??=new Map<string,Login>();
const site=(host:string)=>host==='xiaohongshu.com'||host.endsWith('.xiaohongshu.com');
function diagnostic(s:Login,event:string){console.info('[xhs-qr]',JSON.stringify({trace:s.trace,event,state:s.state}));}
async function release(s:Login){
 if(s.closed)return;s.closed=true;
 await s.page.close().catch(()=>{});await s.browser.close().catch(()=>{});await s.release();
}
function retain(s:Login){
 if(s.timer)clearTimeout(s.timer);
 s.timer=setTimeout(()=>{logins().delete(s.id);void release(s);},60000);s.timer.unref?.();
}
async function observe(s:Login,url:string,body:unknown){
 const u=new URL(url);if(!site(u.hostname)||!body||typeof body!=='object')return;
 const j=body as {success?:boolean;code?:number;data?:Record<string,unknown>},data=j.data;
 if(u.pathname==='/api/qrcode/userinfo'&&j.success===false){s.state='failed';s.error='官方登录状态检查失败，请刷新二维码重试';diagnostic(s,'upstream_poll_failed');await release(s);retain(s);return;}
 if(!j.success||!data)return;
 if(u.pathname==='/api/qrcode/userinfo'){
  if(data.codeStatus===1)s.state='scanned';
  else if(data.codeStatus===2)s.state='verifying';
 }
 if(u.pathname==='/api/sns/web/v2/user/me'&&data.guest===false&&typeof data.user_id==='string'&&data.user_id){
  s.userId=data.user_id;diagnostic(s,'identity_verified');
 }
}
export async function createXhsQr(){
 const unlock=await acquireManagedBrowserActivity(ENDPOINT);
 let browser:Browser|undefined,page:Page|undefined,s:Login|undefined;
 try{
  browser=await chromium.connectOverCDP(ENDPOINT,{timeout:15000});
  page=await browser.contexts()[0].newPage();
  const id=randomUUID();s={id,trace:createHash('sha256').update(id).digest('hex').slice(0,10),page,browser,release:unlock,expiresAt:Date.now()+TTL,state:'waiting',closed:false};
  const current=s;
  page.on('response',response=>{
   const url=new URL(response.url());if(!site(url.hostname)||!['/api/qrcode/userinfo','/api/sns/web/v2/user/me'].includes(url.pathname))return;
   void response.json().then(j=>observe(current,response.url(),j)).catch(()=>{});
  });
  await page.goto('https://www.xiaohongshu.com/login',{waitUntil:'domcontentloaded',timeout:40000});
  for(let n=0;n<40;n++){
   if(current.userId)break;
   const image=page.locator('img.qrcode-img');
   if(await image.count()===1&&await image.isVisible()){
    const src=await image.getAttribute('src');
    if(src&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src)){current.url=src;break;}
   }
   await page.waitForTimeout(250);
  }
  if(!current.url&&!current.userId)throw Error('xhs_browser_qr_unavailable');
  logins().set(id,current);
  current.timer=setTimeout(()=>{current.state='expired';diagnostic(current,'expired');void release(current).finally(()=>retain(current));},TTL);current.timer.unref?.();
  diagnostic(current,'created');
  return {ok:true,loginId:id,url:current.url??null,expiresAt:current.expiresAt,backend:'browser',status_text:current.userId?'verifying':'waiting'};
 }catch(e){
  if(s)await release(s);else{await page?.close().catch(()=>{});await browser?.close().catch(()=>{});await unlock();}
  throw e;
 }
}
export async function pollXhsQr(loginId:string){
 const s=logins().get(loginId);
 if(!s)return{ok:true,status_text:'expired',error:'二维码已失效，请刷新二维码'};
 if(s.cookies)return{ok:true,status_text:'success',user_id:s.userId,cookies:s.cookies};
 if(s.state==='expired'||s.state==='failed')return{ok:true,status_text:s.state,error:s.error||'二维码已过期，请刷新二维码'};
 if(Date.now()>=s.expiresAt){s.state='expired';await release(s);retain(s);return{ok:true,status_text:'expired',error:'二维码已过期，请刷新二维码'};}
 if(s.page.isClosed()){s.state='failed';s.error='登录页面已关闭，请刷新二维码';await release(s);retain(s);return{ok:true,status_text:'failed',error:s.error};}
 if(s.userId){
  s.finishing??=(async()=>{
   const cookies=await s.page.context().cookies('https://www.xiaohongshu.com');
   const data=Object.fromEntries(cookies.filter(c=>site(c.domain.replace(/^\./,''))).map(c=>[c.name,c.value]));
   if(!data.web_session||!data.a1)throw Error('xhs_browser_session_incomplete');
   s.cookies=data;s.state='success';diagnostic(s,'completed');await release(s);retain(s);
  })().catch(async()=>{s.state='failed';s.error='登录状态未能保存，请刷新二维码重试';await release(s);retain(s);});
  await s.finishing;
  return s.cookies?{ok:true,status_text:'success',user_id:s.userId,cookies:s.cookies}:{ok:true,status_text:'failed',error:s.error};
 }
 return{ok:true,status_text:s.state,expiresAt:s.expiresAt};
}
export async function cancelXhsQr(loginId:string){
 const s=logins().get(loginId);if(!s)return;
 logins().delete(loginId);if(s.timer)clearTimeout(s.timer);diagnostic(s,'cancelled');await release(s);
}
export function xhsQrError(error:unknown){
 const code=error instanceof Error?error.message:'xhs_browser_qr_failed';
 return {reason:/^[a-z_]+$/.test(code)?code:'xhs_browser_qr_failed',error:code==='managed_browser_busy'?'登录浏览器正在使用，请稍后重试':code==='xhs_browser_qr_unavailable'?'未能加载官方登录二维码，请稍后重试':code==='xhs_browser_not_logged_in'?'所选浏览器尚未登录小红书，请先登录后再同步':'登录服务暂不可用，请稍后重试'};
}

/** Import only a first-party, non-guest identity from an explicitly selected local browser. */
export async function syncXhsBrowserLogin(instance:number){
 if(![1,2].includes(instance))throw Error('xhs_browser_instance_invalid');
 const endpoint='http://127.0.0.1:'+String(9221+instance);
 const unlock=await acquireManagedBrowserActivity(endpoint);
 let browser:Browser|undefined,page:Page|undefined;
 try{
  browser=await chromium.connectOverCDP(endpoint,{timeout:15000});
  page=await browser.contexts()[0].newPage();
  let identity:{userId:string;nickname?:string}|undefined;
  page.on('response',response=>{
   const u=new URL(response.url());if(!site(u.hostname)||u.pathname!=='/api/sns/web/v2/user/me')return;
   void response.json().then((j:{success?:boolean;data?:{guest?:boolean;user_id?:string;nickname?:string}})=>{
    if(j.success&&j.data?.guest===false&&typeof j.data.user_id==='string'&&j.data.user_id)identity={userId:j.data.user_id,nickname:typeof j.data.nickname==='string'?j.data.nickname:undefined};
   }).catch(()=>{});
  });
  await page.goto('https://www.xiaohongshu.com/explore',{waitUntil:'domcontentloaded',timeout:35000});
  for(let n=0;n<24&&!identity;n++)await page.waitForTimeout(250);
  if(!identity)throw Error('xhs_browser_not_logged_in');
  const data=await page.context().cookies('https://www.xiaohongshu.com');
  const cookies=Object.fromEntries(data.filter(c=>site(c.domain.replace(/^\./,''))).map(c=>[c.name,c.value]));
  if(!cookies.web_session||!cookies.a1)throw Error('xhs_browser_session_incomplete');
  return{...identity,cookies,browserInstance:instance};
 }finally{await page?.close().catch(()=>{});await browser?.close().catch(()=>{});await unlock();}
}
