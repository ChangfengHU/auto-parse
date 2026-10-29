import {wechatFetch,wechatNetworkInfo,wechatTransportKey} from './http';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync,openSync,writeFileSync,renameSync,unlinkSync,closeSync} from 'node:fs';
import path from 'node:path';

type Config={appId:string;appSecret:string;name:string;assetHosts?:string[]};
type Json=Record<string,unknown>;
type Ledger={requestId:string;appId:string;operation:string;fingerprint:string;state:'submitting'|'completed'|'failed'|'unknown';updatedAt:string;result?:Json;error?:Json};
type DraftImage={imageMediaId?:string;imageUrl?:string};
type Article={articleType?:'news'|'newspic';images?:DraftImage[];title:string;content:string;author?:string;digest?:string;thumbMediaId?:string;coverImageUrl?:string;contentSourceUrl?:string;needOpenComment?:boolean;onlyFansCanComment?:boolean};
const API='https://api.weixin.qq.com/cgi-bin/';
const IMAGE_LIMIT=10*1024*1024;
const INLINE_IMAGE_LIMIT=1024*1024;
const defaultHosts=['resource.vyibc.com','cdn.vyibc.com','mmbiz.qpic.cn'];
let tokenCache:{appId:string;secretHash:string;transportKey:string;token:string;expires:number}|undefined;
let tokenFlight:Promise<string>|undefined;

export class WechatImageError extends Error{
 constructor(public readonly code:string,public readonly hint:string,public readonly imageIndex?:number,public readonly httpStatus?:number){super(code);this.name='WechatImageError';}
}
export class WechatApiError extends Error{
 constructor(public readonly code:number,public readonly message:string,public readonly egressIp?:string,public imageIndex?:number){super(message);this.name='WechatApiError';}
}
function config():Config{
 let value:Config;
 try{value=JSON.parse(readFileSync(process.env.WECHAT_DRAFT_CONFIG||path.join(process.cwd(),'.runtime/wechat-drafts/config.json'),'utf8'));}
 catch{throw Error('wechat_not_configured');}
 if(!/^wx[a-fA-F0-9]{16}$/.test(value.appId)||!/^[a-fA-F0-9]{32}$/.test(value.appSecret))throw Error('wechat_invalid_config');
 return value;
}
function safeError(data:Json){
 const code=Number(data.errcode);
 const hints:Record<number,string>={
  40164:'请在公众号后台IP白名单中添加服务出口IP。',
  40125:'公众号AppSecret无效，请核对配置。',
  40013:'公众号AppID无效。',48001:'该公众号未获此接口权限，请在公众号后台核对接口权限。',
  48002:'该公众号无权进行此操作。',40007:'素材media_id无效，请使用本公众号的永久封面素材。',
  45009:'微信接口调用额度已达上限。',40014:'微信接口令牌无效，请稍后重试。',
  42001:'微信接口令牌过期，请稍后重试。',45008:'图文数量超过微信限制。',
 };
 const match=String(data.errmsg||'').match(/invalid ip (\d{1,3}(?:\.\d{1,3}){3})/);
 return new WechatApiError(Number.isFinite(code)?code:-1,hints[code]||'微信拒绝了该请求，请依据错误码检查接口权限、素材和内容参数。',match?.[1]);
}
async function requestJson(url:URL,init:RequestInit={}):Promise<Json>{
 let response:Response;
 try{response=await wechatFetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(25000)});}
 catch(error){if(error instanceof Error&&error.message.startsWith('wechat_proxy_'))throw error;throw Error('wechat_transport_result_unknown');}
 if(!response.ok)throw Error('wechat_http_result_unknown');
 let data:Json;
 try{data=await response.json();}catch{throw Error('wechat_response_result_unknown');}
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('wechat_response_result_unknown');
 if(data.errcode&&Number(data.errcode)!==0)throw safeError(data);
 return data;
}
async function accessToken(c:Config){
 const secretHash=createHash('sha256').update(c.appSecret).digest('hex'),transportKey=wechatTransportKey();
 if(tokenCache?.appId===c.appId&&tokenCache.secretHash===secretHash&&tokenCache.transportKey===transportKey&&tokenCache.expires>Date.now()+120000)return tokenCache.token;
 // One configured account per process; stable_token(force_refresh:false) does not invalidate other consumers.
 if(tokenFlight)return tokenFlight;
 tokenFlight=(async()=>{
  const data=await requestJson(new URL(API+'stable_token'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'client_credential',appid:c.appId,secret:c.appSecret,force_refresh:false})});
  if(typeof data.access_token!=='string'||!Number.isFinite(Number(data.expires_in)))throw Error('wechat_invalid_token_response');
  tokenCache={appId:c.appId,secretHash,transportKey,token:data.access_token,expires:Date.now()+Number(data.expires_in)*1000};
  return tokenCache.token;
 })();
 try{return await tokenFlight;}finally{tokenFlight=undefined;}
}
async function api(c:Config,endpoint:string,body?:Json,form?:FormData){
 const url=new URL(API+endpoint);url.searchParams.set('access_token',await accessToken(c));
 try{return await requestJson(url,form?{method:'POST',body:form}:body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});}
 catch(error){if(error instanceof WechatApiError&&[40014,42001].includes(error.code))tokenCache=undefined;throw error;}
}
function requestId(value:unknown){
 if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value))throw Error('wechat_invalid_request_id');
 return value;
}
function ledgerPath(c:Config,id:string){
 const root=path.join(process.cwd(),'.data/wechat-drafts',c.appId);
 mkdirSync(root,{recursive:true,mode:0o700});
 return path.join(root,createHash('sha256').update(id).digest('hex')+'.json');
}
function readLedger(file:string):Ledger|undefined{
 try{return JSON.parse(readFileSync(file,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw Error('wechat_ledger_unreadable_do_not_retry');}
}
function writeLedger(file:string,data:Ledger){
 const tmp=file+'.'+randomUUID()+'.tmp';
 writeFileSync(tmp,JSON.stringify(data),{mode:0o600,flag:'wx'});renameSync(tmp,file);
}
function errorResult(error:unknown):Json{
 return error instanceof WechatApiError?{error:'wechat_api_error',code:error.code,message:error.message,...error.egressIp?{egressIp:error.egressIp}:{},...error.imageIndex?{imageIndex:error.imageIndex}:{}}:
  error instanceof WechatImageError?{error:error.code,code:error.code,hint:error.hint,...error.imageIndex?{imageIndex:error.imageIndex}:{},...error.httpStatus?{httpStatus:error.httpStatus}:{}}:
  {error:error instanceof Error&&/^wechat_[a-z_]+$/.test(error.message)?error.message:'wechat_operation_failed'};
}
async function mutate(c:Config,id:string,operation:string,input:unknown,work:()=>Promise<Json>):Promise<Json>{
 const file=ledgerPath(c,id),fingerprint=createHash('sha256').update(JSON.stringify({operation,input})).digest('hex');
 let fd:number;
 try{fd=openSync(file+'.lock','wx',0o600);}catch{throw Error('wechat_request_busy_or_interrupted_check_status');}
 try{
  const old=readLedger(file);
  if(old&&(old.fingerprint!==fingerprint||old.operation!==operation))throw Error('wechat_request_id_conflict');
  if(old?.state==='completed')return {...old.result,replayed:true,requestId:id};
  if(old&&(old.state==='submitting'||old.state==='unknown'))throw Error('wechat_submission_unknown_check_original_request');
  const entry:Ledger={requestId:id,appId:c.appId,operation,fingerprint,state:'submitting',updatedAt:new Date().toISOString()};
  // Durable intent before the first external mutation. A crash retains this boundary.
  writeLedger(file,entry);
  try{
   const result=await work();writeLedger(file,{...entry,state:'completed',updatedAt:new Date().toISOString(),result});
   return {...result,requestId:id,replayed:false};
  }catch(error){
   // Business API rejection is definitive. Network/server/parse/write failures are not.
   const uncertain=!(error instanceof WechatApiError)&&!(error instanceof WechatImageError)&&!(error instanceof Error&&/^wechat_(invalid_|unsupported_|untrusted_|image_|html_|article_|cover_|empty_|too_)/.test(error.message));
   writeLedger(file,{...entry,state:uncertain?'unknown':'failed',updatedAt:new Date().toISOString(),error:errorResult(error)});
   throw error;
  }
 }finally{closeSync(fd);unlinkSync(file+'.lock');}
}
function assetUrl(c:Config,value:unknown){
 if(typeof value!=='string')throw Error('wechat_invalid_image_url');
 let url:URL;try{url=new URL(value);}catch{throw Error('wechat_invalid_image_url');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)throw Error('wechat_invalid_image_url');
 const hosts=c.assetHosts||defaultHosts;
 if(!hosts.includes(url.hostname))throw Error('wechat_untrusted_image_host_use_resource_or_cdn_vyibc');
 return url;
}
async function imageBytes(c:Config,value:unknown,limit:number){
 let url=assetUrl(c,value);
 for(let hop=0;hop<4;hop++){
  let res:Response;
  try{res=await wechatFetch(url,{redirect:'manual',signal:AbortSignal.timeout(20000)});}catch{throw Error('wechat_image_download_failed');}
  if(res.status>=300&&res.status<400){const next=res.headers.get('location');await res.body?.cancel();if(!next)throw Error('wechat_image_redirect_invalid');url=assetUrl(c,new URL(next,url).href);continue;}
  if(!res.ok)throw new WechatImageError('wechat_image_download_http_error','检查图片链接和素材服务器状态。',undefined,res.status);
  if(!res.body)throw new WechatImageError('wechat_image_download_empty','图片响应为空，请检查链接。');
  if(Number(res.headers.get('content-length'))>limit){await res.body.cancel();throw new WechatImageError('wechat_image_too_large','图片大小超过上传限制。');}
  const reader=res.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit){await reader.cancel();throw new WechatImageError('wechat_image_too_large','图片大小超过上传限制。');}chunks.push(part.value);}}
  finally{reader.releaseLock();}
  const bytes=Buffer.concat(chunks);
  const jpeg=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const gif=bytes.subarray(0,6).equals(Buffer.from('GIF87a'))||bytes.subarray(0,6).equals(Buffer.from('GIF89a'));
  if(!jpeg&&!png&&!(gif&&limit===IMAGE_LIMIT))throw new WechatImageError('wechat_unsupported_image_format','图片格式不受支持或文件内容不是有效图片。');
  return {bytes,type:jpeg?'image/jpeg':png?'image/png':'image/gif',ext:jpeg?'jpg':png?'png':'gif'};
 }
 throw Error('wechat_image_too_many_redirects');
}
async function upload(c:Config,url:string,purpose:'cover'|'inline'|'newspic',id:string){
 assetUrl(c,url);
 // Authenticate before writing a mutation intent when credentials/IP are not ready.
 await accessToken(c);
 return mutate(c,id,'upload_image',{url,purpose},async()=>{
  const image=await imageBytes(c,url,purpose==='inline'?INLINE_IMAGE_LIMIT:IMAGE_LIMIT),form=new FormData();
  form.set('media',new Blob([new Uint8Array(image.bytes)],{type:image.type}),'image.'+image.ext);
  const result=await api(c,purpose!=='inline'?'material/add_material?type=image':'media/uploadimg',undefined,form);
  if(purpose!=='inline'&&typeof result.media_id!=='string'||purpose==='inline'&&typeof result.url!=='string')throw Error('wechat_upload_response_result_unknown');
  return {purpose,...result};
 });
}
function validateArticles(value:unknown,c:Config):Article[]{
 if(!Array.isArray(value)||value.length<1||value.length>8)throw Error('wechat_invalid_articles_count');
 return value.map(raw=>{
  if(!raw||typeof raw!=='object')throw Error('wechat_invalid_article');
  const a=raw as Article;
  if(typeof a.title!=='string'||!a.title.trim()||Array.from(a.title).length>32)throw Error('wechat_invalid_article_title');
  if(typeof a.content!=='string'||!a.content.trim()||a.content.length>=20000||Buffer.byteLength(a.content)>=1024*1024)throw Error('wechat_invalid_article_content');
  if(a.author!==undefined&&(typeof a.author!=='string'||Array.from(a.author).length>8))throw Error('wechat_invalid_article_author');
  if(a.digest!==undefined&&(typeof a.digest!=='string'||Array.from(a.digest).length>120))throw Error('wechat_invalid_article_digest');
  if(a.articleType!==undefined&&a.articleType!=='news'&&a.articleType!=='newspic')throw Error('wechat_invalid_article_type');
  if(a.articleType==='newspic'){
   if(Array.from(a.title).length>32)throw Error('wechat_invalid_article_title');
   if(/<[^>]*>/.test(a.content))throw Error('wechat_invalid_newspic_plain_text');
   if(a.thumbMediaId!==undefined||a.coverImageUrl!==undefined)throw Error('wechat_cover_newspic_uses_first_image');
   if(!Array.isArray(a.images)||a.images.length<1||a.images.length>20)throw Error('wechat_invalid_newspic_images_count');
   const images=a.images.map(image=>{
    if(!image||typeof image!=='object'||Array.isArray(image))throw Error('wechat_invalid_newspic_image');
    if(Object.keys(image).some(key=>key!=='imageMediaId'&&key!=='imageUrl'))throw Error('wechat_invalid_newspic_image');
    if(Boolean(image.imageMediaId)===Boolean(image.imageUrl))throw Error('wechat_invalid_newspic_image_requires_one_id_or_url');
    if(image.imageMediaId&&(typeof image.imageMediaId!=='string'||image.imageMediaId.length>256))throw Error('wechat_invalid_image_media_id');
    if(image.imageUrl)assetUrl(c,image.imageUrl);
    return {...image};
   });
   return {...a,images};
  }
  if(a.images!==undefined)throw Error('wechat_invalid_news_images_use_html');
  if(Boolean(a.thumbMediaId)===Boolean(a.coverImageUrl))throw Error('wechat_cover_requires_exactly_one_media_id_or_url');
  if(a.thumbMediaId&&(typeof a.thumbMediaId!=='string'||a.thumbMediaId.length>256))throw Error('wechat_invalid_cover_media_id');
  if(a.coverImageUrl)assetUrl(c,a.coverImageUrl);
  if(a.contentSourceUrl){let u:URL;try{u=new URL(a.contentSourceUrl);}catch{throw Error('wechat_invalid_source_url');}if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('wechat_invalid_source_url');}
  // Reject active content; WeChat remains the final HTML formatter.
  if(/<(script|iframe|object|embed|form|input|svg|video|audio|link|meta|base)\b|\bon\w+\s*=|javascript\s*:|data-src\s*=|srcset\s*=/i.test(a.content))throw Error('wechat_html_unsupported_active_content');
  const images=[...a.content.matchAll(/<img\b[^>]*>/gi)];
  if(images.length>30)throw Error('wechat_too_many_inline_images');
  for(const tag of images){const src=tag[0].match(/\bsrc\s*=\s*(["'])(.*?)\1/i);if(!src||src[2].includes('&'))throw Error('wechat_html_image_requires_quoted_https_src');assetUrl(c,src[2]);}
  return {...a};
 });
}
async function createDraft(c:Config,input:Json){
 const id=requestId(input.requestId);
 if(input.confirmDraft!==true)throw Error('wechat_draft_confirmation_required');
 const articles=validateArticles(input.articles,c);
 // Whitelist/auth failures cause no ledger mutation or image upload.
 await accessToken(c);
 return mutate(c,id,'create_draft',articles,async()=>{
  const prepared:Json[]=[];
  for(let index=0;index<articles.length;index++){
   const a=articles[index];
   if(a.articleType==='newspic'){
    const imageList:Json[]=[];
    for(let image=0;image<a.images!.length;image++){
     const source=a.images![image];
     let mediaId=source.imageMediaId;
     if(!mediaId){try{mediaId=String((await upload(c,source.imageUrl!,'newspic',id+':image:'+index+':'+image)).media_id);}catch(error){if(error instanceof WechatImageError)throw new WechatImageError(error.code,error.hint,image+1,error.httpStatus);if(error instanceof WechatApiError)error.imageIndex=image+1;throw error;}}
     imageList.push({image_media_id:mediaId});
    }
    prepared.push({article_type:'newspic',title:a.title,content:a.content,image_info:{image_list:imageList},...(a.author?{author:a.author}:{}),...(a.needOpenComment!==undefined?{need_open_comment:a.needOpenComment?1:0}:{}),...(a.onlyFansCanComment!==undefined?{only_fans_can_comment:a.onlyFansCanComment?1:0}:{})});
    continue;
   }
   let thumb=a.thumbMediaId;
   if(!thumb){const cover=await upload(c,a.coverImageUrl!,'cover',id+':cover:'+index);thumb=String(cover.media_id);}
   let content=a.content;const sources=[...new Set([...content.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi)].map(m=>m[2]))];
   for(let image=0;image<sources.length;image++){
    const source=sources[image];
    if(new URL(source).hostname==='mmbiz.qpic.cn')continue;
    const saved=await upload(c,source,'inline',id+':inline:'+index+':'+image);
    if(typeof saved.url!=='string'||new URL(saved.url).hostname!=='mmbiz.qpic.cn')throw Error('wechat_image_upload_url_invalid');
    content=content.split(source).join(saved.url);
   }
   prepared.push({title:a.title,content,author:a.author||'',digest:a.digest||'',thumb_media_id:thumb,content_source_url:a.contentSourceUrl||'',need_open_comment:a.needOpenComment?1:0,only_fans_can_comment:a.onlyFansCanComment?1:0});
  }
  const draft=await api(c,'draft/add',{articles:prepared});
  if(typeof draft.media_id!=='string'||!draft.media_id)throw Error('wechat_draft_response_result_unknown');
  return {status:'draft_saved',media_id:draft.media_id,account:{appId:c.appId,name:c.name},articleCount:articles.length,createdAt:new Date().toISOString(),published:false};
 });
}
export async function callWechatDraftTool(name:string,input:Json):Promise<Json>{
 const c=config();
 if(name==='wechat_capabilities')return {platform:'wechat',account:{appId:c.appId,name:c.name},transport:'official_https_api',network:wechatNetworkInfo(),browserRequired:false,draftOnly:false,publicPublish:'official_api_requires_account_permission',massSend:false,formats:['news_html','newspic'],newspic:{imageLimit:20,contentMaxCharsExclusive:20000,contentMaxBytesExclusive:1048576,contentOverflow:'reject',upstreamLimit:'WeChat may apply stricter limits; no silent truncation',firstImageIsCover:true,animatedGifVerified:false,livePhoto:false},inlineImageMaxBytes:INLINE_IMAGE_LIMIT,articleLimit:8,imageMaxBytes:IMAGE_LIMIT,imageFormats:['jpeg','png','gif'],inlineImageFormats:['jpeg','png'],recommendedTimeoutMs:120000,titleMaxChars:{news:32,newspic:32},assetHosts:c.assetHosts||defaultHosts,tokenStrategy:'stable_token_force_refresh_false',requestLedger:'restart_durable_single_host',unknownResult:'Check original request and official draft list; never blindly resubmit.',limits:'Account official API permissions and service egress IP whitelist are required. Draft saved is not public publication.'};
 if(name==='wechat_account_status'){const count=await api(c,'draft/count');return {ok:true,account:{appId:c.appId,name:c.name},draftCount:count.total_count,checkedAt:new Date().toISOString()};}
 if(name==='wechat_upload_image'){
  if(input.purpose!=='cover'&&input.purpose!=='inline'&&input.purpose!=='newspic')throw Error('wechat_invalid_image_purpose');
  return upload(c,String(input.imageUrl),input.purpose,requestId(input.requestId));
 }
 if(name==='wechat_create_draft')return createDraft(c,input);
 if(name==='wechat_delete_draft'||name==='wechat_publish_draft'){
  const id=requestId(input.requestId),mediaId=input.mediaId;
  if(typeof mediaId!=='string'||!mediaId||mediaId.length>256)throw Error('wechat_invalid_media_id');
  const isDelete=name==='wechat_delete_draft';
  if(isDelete?input.confirmDelete!==true:input.confirmPublish!==true)throw Error(isDelete?'wechat_delete_confirmation_required':'wechat_publish_confirmation_required');
  await accessToken(c);
  return mutate(c,id,isDelete?'delete_draft':'publish_draft',{mediaId},async()=>{
   const send=async()=>{
    const result=await api(c,isDelete?'draft/delete':'freepublish/submit',{media_id:mediaId});
    if(!isDelete&&(typeof result.publish_id!=='string'&&typeof result.publish_id!=='number'))throw Error('wechat_publish_response_result_unknown');
    return isDelete?{status:'draft_deleted',media_id:mediaId}:{status:'submitted',media_id:mediaId,publish_id:result.publish_id,note:'Submission is not final publication; check publishing status.'};
   };
   if(isDelete)return send();
   // One durable publication intent per account+draft, even if callers change requestId.
   return mutate(c,'publish-draft:'+createHash('sha256').update(mediaId).digest('hex'),'publish_draft_once',{mediaId},send);
  });
 }
 if(name==='wechat_publish_status'){if(typeof input.publishId!=='string'||!input.publishId||input.publishId.length>128)throw Error('wechat_invalid_publish_id');return api(c,'freepublish/get',{publish_id:input.publishId});}
 if(name==='wechat_draft_request_status'){
  const entry=readLedger(ledgerPath(c,requestId(input.requestId)));
  return entry?{found:true,...entry}:{found:false,requestId:input.requestId};
 }
 if(name==='wechat_list_drafts'){
  const offset=input.offset??0,count=input.count??20;
  if(!Number.isInteger(offset)||Number(offset)<0||!Number.isInteger(count)||Number(count)<1||Number(count)>20)throw Error('wechat_invalid_pagination');
  const raw=await api(c,'draft/batchget',{offset,count,no_content:input.includeContent===true?0:1});
  if(input.normalized!==true)return raw;
  const items=Array.isArray(raw.item)?raw.item:[];return {totalCount:raw.total_count,itemCount:raw.item_count,items:items.map((row:Json)=>({mediaId:row.media_id,updatedAt:row.update_time,articles:(row.content as Json)?.news_item??[]}))};
 }
 if(name==='wechat_get_draft'){
  if(typeof input.mediaId!=='string'||!input.mediaId||input.mediaId.length>256)throw Error('wechat_invalid_media_id');
  const raw=await api(c,'draft/get',{media_id:input.mediaId});
  if(input.normalized!==true)return raw;
  return {mediaId:input.mediaId,createdAt:raw.create_time,updatedAt:raw.update_time,articles:raw.news_item??[]};
 }
 throw Error('wechat_tool_not_allowed');
}
