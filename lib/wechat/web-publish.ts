import path from 'node:path';
import type {Page} from 'playwright';
import {readWebPublication,reserveWebPublication,finishWebPublication} from './web-publication-ledger';
export const webPublicationRoot=()=>path.join(process.cwd(),'.data/wechat-web-publications');
export type WebPublishInput={mediaId:string;expectedAccount:string;requestId:string;expectedFingerprint:string;aiGenerated:boolean;articleStatement?:string;declareOriginal?:boolean;originalAuthor?:string;confirmOriginalAgreement?:boolean;notifyFollowers?:boolean};
export function webPublishState(account:string,mediaId:string){return readWebPublication(webPublicationRoot(),account,mediaId);}
export function isFinalWechatPublish(url:string,method:string){try{const u=new URL(url);return u.origin==='https://mp.weixin.qq.com'&&u.pathname==='/cgi-bin/masssend'&&method==='POST'&&u.searchParams.get('is_release_publish_page')==='1'&&u.searchParams.get('for_check')!=='1'&&!u.searchParams.get('action');}catch{return false}}
export async function publishVerifiedEditor(page:Page,input:WebPublishInput,appId:number,fingerprint:string,kind:'news'|'newspic'='newspic'){
 if(typeof input.aiGenerated!=='boolean')throw Error('wechat_web_ai_declaration_required');
 const sourceLabels:Record<string,string>={ai_generated:'内容由AI生成',official_media:'素材来源官方媒体/网络新闻',fiction:'内容剧情演绎，仅供娱乐',personal_opinion:'个人观点，仅供参考',health:'健康医疗分享，仅供参考',investment:'投资观点，仅供参考',none:'无需声明'};
 const statement=input.articleStatement||(input.aiGenerated?'ai_generated':'personal_opinion');
 if(!Object.hasOwn(sourceLabels,statement))throw Error('wechat_web_invalid_article_statement');
 if(input.aiGenerated!==(statement==='ai_generated'))throw Error('wechat_web_ai_statement_conflict');
 if(input.expectedFingerprint!==fingerprint)throw Error('wechat_web_draft_changed_prepare_again');
 if(kind==='newspic'&&input.notifyFollowers===true)throw Error('wechat_web_newspic_notification_unsupported');
 if(kind==='newspic'&&input.declareOriginal===true)throw Error('wechat_web_newspic_original_unsupported');
 if(input.declareOriginal===true&&(input.confirmOriginalAgreement!==true||typeof input.originalAuthor!=='string'||!input.originalAuthor.trim()||Array.from(input.originalAuthor).length>8))throw Error('wechat_web_original_author_and_agreement_required');
 const root=webPublicationRoot();
 const old=readWebPublication(root,input.expectedAccount,input.mediaId);
 if(old)return {status:old.state,requestId:old.requestId,reused:true,submitted:old.state==='submitted',note:'Existing intent; no second click.',receipt:old.receipt};
 reserveWebPublication(root,input.expectedAccount,input.mediaId,input.requestId,{notifyFollowers:input.notifyFollowers===true,aiGenerated:input.aiGenerated,articleStatement:statement,declareOriginal:input.declareOriginal===true,...(input.declareOriginal?{originalAuthor:input.originalAuthor}: {})});
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
  if(input.declareOriginal===true){
   const unset=page.locator('.js_unset_original_title:visible');
   if(await unset.count()!==1)throw Error('wechat_web_original_state_unverified');
   const trigger=page.locator('.js_original_apply:visible');if(await trigger.count()!==1)throw Error('wechat_web_original_control_ambiguous');
   await trigger.click();
   const original=page.locator('.weui-desktop-dialog:visible').filter({hasText:'微信公众平台原创声明及相关功能使用协议'});
   if(await original.count()!==1)throw Error('wechat_web_original_dialog_ambiguous');
   const textType=original.locator('input.js_original_type_radio').first();
   if(!await textType.isChecked())await textType.check({force:true});
   const author=original.locator('input.js_counter.js_author');if(await author.count()!==1)throw Error('wechat_web_original_author_ambiguous');
   await author.fill(input.originalAuthor!);if(await author.inputValue()!==input.originalAuthor)throw Error('wechat_web_original_author_mismatch');
   const agreement=original.locator('input.weui-desktop-form__checkbox');if(await agreement.count()!==1)throw Error('wechat_web_original_agreement_ambiguous');
   if(!await agreement.isChecked())await agreement.evaluate((element:HTMLInputElement)=>element.click());
   if(!await agreement.isChecked())throw Error('wechat_web_original_agreement_unchecked');
   await original.getByRole('button',{name:'确定',exact:true}).click();
   await original.waitFor({state:'hidden',timeout:15000});
   if(await unset.isVisible())throw Error('wechat_web_original_state_unverified');
  }
  await page.locator('.js_claim_source_desc:visible').click();
  const source=page.locator('.weui-desktop-dialog:visible').filter({hasText:'声明类型'});
  const selected=source.locator('label').filter({hasText:sourceLabels[statement]});
  if(await selected.count()!==1)throw Error('wechat_web_source_choice_unavailable');
  if(!await selected.locator('input').isChecked())await selected.click();
  if(!await selected.locator('input').isChecked())throw Error('wechat_web_source_choice_not_selected');
  await source.getByRole('button',{name:'确认',exact:true}).click();
  await page.locator('button.mass_send:visible').click();
  if(kind==='news'){
   const dialog=page.locator('.weui-desktop-dialog:visible').filter({hasText:'群发通知'});
   await dialog.waitFor({state:'visible',timeout:30000});
   const notify=dialog.locator('.mass_send__notify input[type=checkbox]');
   if(await notify.count()!==1)throw Error('wechat_web_news_notification_ambiguous');
   const wantsNotify=input.notifyFollowers===true;
   if(await notify.isChecked()!==wantsNotify)await dialog.locator('.mass_send__notify label.weui-desktop-switch').click();
   if(await notify.isChecked()!==wantsNotify)throw Error('wechat_web_news_notification_setting_mismatch');
   await dialog.getByRole('button',{name:'发表',exact:true}).click();
   if(!wantsNotify){const warning=page.locator('.weui-desktop-dialog:visible').filter({hasText:'未开启群发通知'});
   await warning.waitFor({state:'visible',timeout:30000});
   await warning.getByRole('button',{name:'继续发表',exact:true}).click();}
  }else{
   const dialog=page.locator('.weui-desktop-dialog:visible').filter({hasText:'发表贴图无需开启群发通知'});
   await dialog.waitFor({state:'visible',timeout:30000});
   await dialog.getByRole('button',{name:'发表',exact:true}).click();
  }
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
