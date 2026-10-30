import type {Page,Response} from 'playwright';
import type {NodeResult,WorkflowContext} from '../types';
import {getMediaDraft,updateMediaDraft,mediaDraftView} from '../../wechat/media-draft';
import {downloadMediaAsset} from '../../wechat/media-asset';
type Params={requestId:string;expectedAccount:string};
function waitReceipt(page:Page,path:string,accept:(value:Record<string,unknown>)=>boolean,timeout=90000){
 let listener:(r:Response)=>void;let timer:ReturnType<typeof setTimeout>;
 const promise=new Promise<Record<string,unknown>>((resolve,reject)=>{
  listener=async response=>{if(!response.url().includes(path)||response.request().method()!=='POST')return;
   try{const value=await response.json();if(accept(value)){clearTimeout(timer);page.off('response',listener);resolve(value)}}catch{}
  };
  page.on('response',listener);timer=setTimeout(()=>{page.off('response',listener);reject(Error('media_save_receipt_timeout'))},timeout);
 });
 // Register immediately so a click failure cannot cause an unhandled timeout.
 promise.catch(()=>{});
 return {promise,cancel:()=>{clearTimeout(timer);page.off('response',listener)}};
}
export async function executeWechatMediaDraft(root:Page,params:Params,ctx:WorkflowContext):Promise<NodeResult>{
 if(!ctx.managedPublicationAuthorized)throw Error('media_managed_browser_required');
 const record=getMediaDraft(params.expectedAccount,params.requestId);
 if(!record||record.state!=='reserved')throw Error('media_reserved_intent_required');
 const input=record.input,owned=new Set<Page>();let asset:Awaited<ReturnType<typeof downloadMediaAsset>>|undefined;
 let phase='checking_account',saving=false;
 const update=(p:Parameters<typeof updateMediaDraft>[2])=>updateMediaDraft(input.expectedAccount,input.requestId,p);
 const stage=(name:string)=>{phase=name;update({phase:name});ctx.emit?.('log','wechat_media_draft: '+name)};
 const track=(p:Page)=>{if(p===root||owned.has(p))return;owned.add(p);p.on('popup',track)};
 root.on('popup',track);
 // Only exact Save / Save as draft buttons are used below; no publication action is exposed.
 const protect=async(p:Page)=>{p.setDefaultTimeout(30000)};
 const home=async()=>{await root.goto('https://mp.weixin.qq.com/',{waitUntil:'domcontentloaded'});await root.waitForFunction(()=>!!(window as unknown as {wx?:{data?:{user_name?:string}}}).wx?.data?.user_name,{},{timeout:30000});
  const actual=await root.evaluate(()=>(window as unknown as {wx?:{data?:{user_name?:string}}}).wx?.data?.user_name);
  if(actual!==input.expectedAccount)throw Error('media_account_mismatch');
 };
 const editor=async()=>{
  await home();const popup=root.waitForEvent('popup');await root.getByText(input.kind==='video'?'视频':'播客',{exact:true}).click();const p=await popup;track(p);await protect(p);await p.waitForLoadState('domcontentloaded');
  const ready=input.kind==='video'?p.getByRole('button',{name:'本地上传',exact:true}):p.getByText('上传音频',{exact:true});
  await ready.waitFor({state:'visible',timeout:45000});return p;
 };
 try{
  update({state:'running',phase});await protect(root);await home();
  stage('downloading');asset=await downloadMediaAsset(input);
  const materialTitle='MCP'+(input.kind==='video'?'视频':'音频')+record.fingerprint.slice(0,12);
  update({receipt:{materialTitle,bytes:asset.size,durationSeconds:asset.duration}});
  let page=await editor();stage('uploading_material');
  if(input.kind==='video'){
   await page.getByRole('button',{name:'本地上传',exact:true}).waitFor({timeout:45000});
   const popup=page.waitForEvent('popup');await page.getByRole('button',{name:'本地上传',exact:true}).click();
   const material=await popup;track(material);await protect(material);await material.waitForLoadState('domcontentloaded');
   const notice=material.getByRole('button',{name:'知道了',exact:true});if(await notice.isVisible().catch(()=>false))await notice.click();
   stage('uploading_video_file');await material.locator('input[type=file][accept="video/*"]').setInputFiles(asset.filename);
   stage('waiting_video_upload');await material.getByText('视频上传成功，你可以继续编辑其它信息保存提交',{exact:true}).waitFor({timeout:180000});
   stage('loading_video_cover');
   await material.waitForFunction(()=>Array.from(document.querySelectorAll<HTMLImageElement>('.cover__options__item__image')).some(img=>img.offsetParent&&img.complete&&img.naturalWidth>0),{},{timeout:90000});
   stage('selecting_video_cover');
   const complete=material.getByRole('button',{name:'完成',exact:true});
   for(let attempt=0;attempt<3;attempt++){
    if(await complete.isVisible().catch(()=>false))break;
    await material.locator('.cover__options__item__image:visible').first().click();
    await complete.waitFor({state:'visible',timeout:10000}).catch(()=>{});
   }
   stage('cropping_video_cover');await material.waitForTimeout(3000);
   let cropStarted=false;
   const onCrop=(request:import('playwright').Request)=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/cgi-bin/cropimage')cropStarted=true};
   material.on('request',onCrop);
   try{
    for(let attempt=0;attempt<3;attempt++){
     if(!await complete.isVisible().catch(()=>false))break;
     if(!cropStarted)await complete.click();
     await complete.waitFor({state:'hidden',timeout:10000}).catch(()=>{});
     if(cropStarted)break;
    }
    await complete.waitFor({state:'hidden',timeout:90000});
   }finally{material.off('request',onCrop)}
   await material.waitForTimeout(2500); // Crop uploads asynchronously after the dialog closes.
   stage('editing_video_material_title');await material.locator('input.weui-desktop-form__input:visible').first().fill(materialTitle);
   stage('confirming_video_upload_rules');await material.locator('.video-setting__footer-link .weui-desktop-icon-checkbox').click();
   stage('saving_material');saving=true;
   await material.getByRole('button',{name:'保存',exact:true}).click();
   await material.getByText(materialTitle,{exact:true}).first().waitFor({timeout:90000});
   update({materialSaved:true});
   await material.close();await page.close();page=await editor();
   stage('selecting_material');
   // A fresh selector is required; the original material list is cached.
   let selected=false;
   for(let attempt=0;attempt<12;attempt++){
    const row=page.locator('.more-video__item').filter({hasText:materialTitle});
    await row.waitFor({state:'visible',timeout:15000}).catch(()=>{});
    if(await row.count()===1&&!((await row.getAttribute('class'))||'').includes('_disabled')){
     await row.locator('.weui-desktop-simple-video__mask').click();selected=true;break;
    }
    await page.waitForTimeout(5000);await page.close();page=await editor();
   }
   if(!selected)throw Error('media_video_transcoding_pending');
   await page.getByRole('button',{name:'确定',exact:true}).click();
  }else{
   await page.getByText('上传音频',{exact:true}).click({timeout:45000});
   stage('uploading_audio_file');await page.locator('input[type=file][id^=ftnUpload_]').setInputFiles(asset.filename);
   stage('selecting_audio_cover');await page.getByText('使用账号头像',{exact:true}).click();
   stage('waiting_audio_upload');
   await page.locator('.select_audio_cover .weui-desktop-loading').waitFor({state:'hidden',timeout:90000});
   stage('editing_audio_material_title');await page.getByPlaceholder('填写标题',{exact:true}).fill(materialTitle);
   stage('confirming_audio_upload_rules');await page.locator('.audio-upload-dialog_agreement .weui-desktop-icon-checkbox').click();
   const save=page.getByRole('button',{name:'保存',exact:true});
   await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.trim()==='保存'&&!b.disabled&&!b.className.includes('disabled')),{},{timeout:180000});
   stage('saving_material');saving=true;
   const receipt=waitReceipt(page,'/cgi-bin/operate_voice',v=>!!v.encode_file_id||!!(v.base_resp as {ret?:number})?.ret);
   let saved:Record<string,unknown>;try{await save.click();saved=await receipt.promise}finally{receipt.cancel()}
   if((saved.base_resp as {ret?:number})?.ret!==0)throw Error('media_audio_save_rejected_'+String((saved.base_resp as {ret?:number})?.ret));
   update({materialSaved:true,receipt:{...getMediaDraft(input.expectedAccount,input.requestId)?.receipt,audioFileId:saved.encode_file_id}});
   await page.close();page=await editor();stage('selecting_material');
   let selected=false;
   for(let attempt=0;attempt<12;attempt++){
    const item=page.getByText(materialTitle,{exact:true});
    await item.waitFor({state:'visible',timeout:15000}).catch(()=>{});
    if(await item.count()===1){await item.click();const insert=page.getByRole('button',{name:'插入',exact:true});if(await insert.isEnabled()&&!((await insert.getAttribute('class'))||'').includes('disabled')){await insert.click();selected=true;break}}
    await page.waitForTimeout(5000);await page.close();page=await editor();
   }
   if(!selected)throw Error('media_audio_transcoding_pending');
  }
  stage('editing_draft');
  await page.getByText(input.kind==='video'?'视频贴片':'可根据音频内容，自动生成时间轴',{exact:false}).first().waitFor();
  await page.locator('#title').fill(input.title);
  if(input.description){
   const description=page.locator('.ProseMirror[contenteditable=true]:visible');
   if(await description.count()!==1)throw Error('media_description_editor_ambiguous');
   await description.fill(input.description);
  }
  if(await page.locator('#title').inputValue()!==input.title)throw Error('media_title_readback_mismatch');
  stage('saving_draft');update({receipt:{...getMediaDraft(input.expectedAccount,input.requestId)?.receipt,draftSaveAttempted:true}});
  const receipt=waitReceipt(page,'/cgi-bin/operate_appmsg',v=>!!v.appMsgId||!!(v.base_resp as {ret?:number})?.ret);
  let saved:Record<string,unknown>;try{await page.getByRole('button',{name:'保存为草稿',exact:true}).click();saved=await receipt.promise}finally{receipt.cancel()}
  if((saved.base_resp as {ret?:number})?.ret!==0||!/^\d+$/.test(String(saved.appMsgId)))throw Error('media_draft_save_rejected_'+String((saved.base_resp as {ret?:number})?.ret));
  const appMsgId=String(saved.appMsgId);
  update({receipt:{...getMediaDraft(input.expectedAccount,input.requestId)?.receipt,appMsgId,saveResponseAccepted:true}});
  stage('verifying');
  await page.waitForFunction(id=>new URL(location.href).searchParams.get('appmsgid')===id,appMsgId,{timeout:30000});
  await page.reload({waitUntil:'domcontentloaded'});await page.locator('#title').waitFor();
  if(await page.locator('#title').inputValue()!==input.title||new URL(page.url()).searchParams.get('appmsgid')!==appMsgId)throw Error('media_saved_draft_readback_mismatch');
  if(input.description){
   const description=page.locator('.ProseMirror[contenteditable=true]:visible');
   if(await description.count()!==1||(await description.innerText()).trim()!==input.description.trim())throw Error('media_description_readback_mismatch');
  }
  let mediaIdentity:unknown;
  if(input.kind==='video'){
   const ids=await page.evaluate(()=>Array.from(new Set(document.documentElement.innerHTML.match(/wxv_[0-9]+/g)||[])));
   if(ids.length!==1)throw Error('media_video_identity_unverified');mediaIdentity=ids[0];
  }else{
   await page.getByText('可根据音频内容，自动生成时间轴',{exact:false}).waitFor();
   mediaIdentity=getMediaDraft(input.expectedAccount,input.requestId)?.receipt?.audioFileId;
   if(!mediaIdentity)throw Error('media_audio_identity_unverified');
  }
  const final=update({state:'completed',phase:'completed',receipt:{...getMediaDraft(input.expectedAccount,input.requestId)?.receipt,mediaIdentity,titleVerified:true,descriptionVerified:!!input.description,nativeEditorReloadVerified:true,verifiedAt:new Date().toISOString(),playbackVerified:false,publicPublicationVerified:false}});
  return {success:true,log:['media_draft_saved_and_reloaded'],output:mediaDraftView(final)};
 }catch(error){
  const message=error instanceof Error?error.message:'media_draft_failed';
  const code=/^media_[a-z0-9_]+$/.test(message)?message:'media_browser_step_failed';
  const current=getMediaDraft(input.expectedAccount,input.requestId);
  if(current&&!['completed','failed','unknown'].includes(current.state))update({state:saving?'unknown':'failed',phase,error:{code,message:'阶段 '+phase+' 未完成。'+message.split('\n').filter(line=>!/https?:|cookie|token|password/i.test(line)).slice(0,7).join(' ').slice(0,900),hint:saving?'保存可能已产生素材或草稿；核对已有回执，不换请求 ID 重提。':'未执行保存；检查登录、资源和当前页面后处理。'}});
  return {success:false,error:code,log:['media_draft_failed_at_'+phase],output:mediaDraftView(getMediaDraft(input.expectedAccount,input.requestId))};
 }finally{
  root.off('popup',track);for(const p of [...owned].reverse())if(!p.isClosed())await p.close().catch(()=>{});
  await asset?.cleanup();
 }
}
