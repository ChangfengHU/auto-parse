import path from 'node:path';
import type {Page} from 'playwright';
import {readWebPublication,reserveWebPublication,finishWebPublication} from './web-publication-ledger';
export const webPublicationRoot=()=>path.join(process.cwd(),'.data/wechat-web-publications');
export type WebPublishInput={mediaId:string;expectedAccount:string;requestId:string;expectedFingerprint:string;aiGenerated:boolean};
export function webPublishState(account:string,mediaId:string){return readWebPublication(webPublicationRoot(),account,mediaId);}
export function isFinalWechatPublish(url:string,method:string){try{const u=new URL(url);return u.origin==='https://mp.weixin.qq.com'&&u.pathname==='/cgi-bin/masssend'&&method==='POST'&&u.searchParams.get('is_release_publish_page')==='1'&&u.searchParams.get('for_check')!=='1'&&!u.searchParams.get('action');}catch{return false}}
export async function publishVerifiedEditor(page:Page,input:WebPublishInput,appId:number,fingerprint:string){
 if(input.aiGenerated!==true)throw Error('wechat_web_ai_declared_content_only');
 if(input.expectedFingerprint!==fingerprint)throw Error('wechat_web_draft_changed_prepare_again');
 const root=webPublicationRoot();
 const old=readWebPublication(root,input.expectedAccount,input.mediaId);
 if(old)return {status:old.state,requestId:old.requestId,reused:true,submitted:old.state==='submitted',note:'Existing intent; no second click.',receipt:old.receipt};
 reserveWebPublication(root,input.expectedAccount,input.mediaId,input.requestId);
 let sent=false,finished=false;
 const finish=(state:'submitted'|'unknown',receipt?:Record<string,unknown>)=>{
  if(finished)return;
  finishWebPublication(root,input.expectedAccount,input.mediaId,input.requestId,state,receipt);finished=true;
 };
 page.once('close',()=>{if(!finished){try{finish('unknown')}catch{}}});
 await page.route('**/cgi-bin/masssend**',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.pathname!=='/cgi-bin/masssend')return route.continue();
  const readonly=u.searchParams.get('for_check')==='1'||String(u.searchParams.get('action')||'').startsWith('check_')||u.searchParams.get('action')==='get_appmsg_copyright_stat';
  if(readonly)return route.continue();
  if(!isFinalWechatPublish(req.url(),req.method())||sent||finished){await route.abort();return}
  const body=new URLSearchParams(req.postData()||'');
  if(body.get('appmsgid')!==String(appId)){await route.abort();try{finish('unknown')}catch{};return}
  sent=true;
  try{
   const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:60000});
   const data=await response.json();
   const rawCode=data?.base_resp?.ret;
   const code=(typeof rawCode==='number'||typeof rawCode==='string'&&/^-?\d+$/.test(rawCode))?Number(rawCode):NaN;
   const receipt={appId,httpStatus:response.status(),wechatCode:Number.isFinite(code)?code:null,receivedAt:new Date().toISOString(),...(typeof data?.msg_id==='string'||typeof data?.msg_id==='number'?{messageId:String(data.msg_id)}:{})};
   if(response.ok()&&code===0)finish('submitted',receipt);else finish('unknown',receipt);
   await route.fulfill({response});
  }catch{try{finish('unknown')}catch{};await route.abort().catch(()=>{})}
 });
 try{
  await page.locator('.js_claim_source_desc:visible').click();
  const source=page.locator('.weui-desktop-dialog:visible').filter({hasText:'声明类型'});
  const ai=source.locator('label').filter({hasText:'内容由AI生成'});
  if(!await ai.locator('input').isChecked())await ai.click();
  await source.getByRole('button',{name:'确认',exact:true}).click();
  await page.locator('button.mass_send:visible').click();
  const dialog=page.locator('.weui-desktop-dialog:visible').filter({hasText:'发表贴图无需开启群发通知'});
  await dialog.waitFor({state:'visible',timeout:30000});
  await dialog.getByRole('button',{name:'发表',exact:true}).click();
  for(let n=0;n<45;n++){
   const record=readWebPublication(root,input.expectedAccount,input.mediaId);
   if(record?.state==='submitted'||record?.state==='unknown')return {status:record.state,submitted:record.state==='submitted',receipt:record.receipt,requestId:input.requestId};
   if(await page.getByText('扫码后，请联系管理员进行验证',{exact:true}).isVisible().catch(()=>false))
    return {status:'awaiting_admin_scan',submitted:false,requestId:input.requestId,keepSessionOpen:true,note:'Use workflow_get_session to view the verification QR. Keep this session open; do not resubmit. Closing or restarting leaves an uncertain intent.'};
   await page.waitForTimeout(1000);
  }
  return {status:'pending',submitted:false,requestSent:sent,requestId:input.requestId,keepSessionOpen:true,note:'Poll status; do not create another request.'};
 }catch{
  try{finish('unknown')}catch{}
  throw Error('wechat_web_publication_interrupted_check_status');
 }
}
