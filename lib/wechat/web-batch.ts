import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,openSync,readFileSync,writeFileSync,closeSync,fsyncSync,renameSync} from 'node:fs';
import path from 'node:path';
import {webDraftFingerprint} from './web-draft-fingerprint';

type Item = {mediaId:string;expectedFingerprint:string;aiGenerated:boolean;articleStatement?:string;notifyFollowers?:boolean;declareOriginal?:boolean;originalAuthor?:string;confirmOriginalAgreement?:boolean};
type Batch = {id:string;account:string;fingerprint:string;state:'running'|'completed'|'stopped';current:number;items:Array<Item & {title:string;state:'pending'|'starting'|'running'|'submitted'|'unknown'|'failed';sessionId?:string;error?:string}>;updatedAt:string};
type Deps = {getDraft:(id:string)=>Promise<Record<string,unknown>>;publish:(input:Record<string,unknown>)=>Promise<Record<string,unknown>>;publication:(account:string,id:string)=>Record<string,unknown>|undefined;session:(id:string)=>Promise<Record<string,unknown>>;close:(id:string)=>Promise<unknown>;assistance:(id:string)=>Promise<Record<string,unknown>>};
declare global {var __wechatBatchWorkers:Map<string,boolean>|undefined}
const workers=()=>global.__wechatBatchWorkers??=new Map<string,boolean>();
const root=()=>path.join(process.cwd(),'.data/wechat-web-batches');
function validAccount(x:unknown):asserts x is string {if(typeof x!=='string'||!/^gh_[a-zA-Z0-9]{12}$/.test(x))throw Error('wechat_web_invalid_account')}
function validId(x:unknown):asserts x is string {if(typeof x!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,100}$/.test(x))throw Error('wechat_batch_invalid_id')}
function file(account:string,id:string){validAccount(account);validId(id);const dir=root();mkdirSync(dir,{recursive:true,mode:0o700});return path.join(dir,createHash('sha256').update(account+'\0'+id).digest('hex')+'.json')}
function read(account:string,id:string):Batch|undefined{try{return JSON.parse(readFileSync(file(account,id),'utf8')) as Batch}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw Error('wechat_batch_ledger_unreadable')}}
function save(job:Batch,create=false){
 const f=file(job.account,job.id),tmp=create?f:f+'.'+randomUUID()+'.tmp';job.updatedAt=new Date().toISOString();
 const fd=openSync(tmp,'wx',0o600);try{writeFileSync(fd,JSON.stringify(job));fsyncSync(fd)}finally{closeSync(fd)}
 if(!create)renameSync(tmp,f);
 const d=openSync(root(),'r');try{fsyncSync(d)}finally{closeSync(d)}
}
function validateItems(items:unknown):Item[]{
 if(!Array.isArray(items)||items.length<2||items.length>8)throw Error('wechat_batch_size_invalid');
 const ids=new Set<string>();
 return items.map((x:unknown)=>{
  if(!x||typeof x!=='object'||Array.isArray(x))throw Error('wechat_batch_item_invalid');
  const a=x as Record<string,unknown>,keys=['mediaId','expectedFingerprint','aiGenerated','articleStatement','notifyFollowers','declareOriginal','originalAuthor','confirmOriginalAgreement'];
  if(Object.keys(a).some(k=>!keys.includes(k))||typeof a.mediaId!=='string'||!a.mediaId||a.mediaId.length>256||ids.has(a.mediaId)||typeof a.expectedFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(a.expectedFingerprint)||typeof a.aiGenerated!=='boolean')throw Error('wechat_batch_item_invalid');
  ids.add(a.mediaId);
  const statement=a.articleStatement===undefined?(a.aiGenerated?'ai_generated':'personal_opinion'):a.articleStatement;
  if(typeof statement!=='string'||!['ai_generated','official_media','fiction','personal_opinion','health','investment','none'].includes(statement)||(a.aiGenerated===true)!==(statement==='ai_generated'))throw Error('wechat_web_ai_statement_conflict');
  if(a.notifyFollowers!==undefined&&typeof a.notifyFollowers!=='boolean'||a.declareOriginal!==undefined&&typeof a.declareOriginal!=='boolean')throw Error('wechat_batch_item_invalid');
  if(a.declareOriginal===true&&(a.confirmOriginalAgreement!==true||typeof a.originalAuthor!=='string'||!a.originalAuthor.trim()||Array.from(a.originalAuthor).length>8))throw Error('wechat_web_original_author_and_agreement_required');
  return a as Item;
 });
}
async function inspect(id:string,deps:Deps){
 const raw=await deps.getDraft(id),items=raw.news_item;
 if(!Array.isArray(items)||items.length!==1)throw Error('wechat_batch_single_drafts_only');
 const a=items[0] as Record<string,unknown>;if(!a||!['news','newspic'].includes(String(a.article_type))||typeof a.title!=='string'||typeof a.thumb_media_id!=='string'||!a.thumb_media_id||typeof a.thumb_url!=='string'||!a.thumb_url)throw Error('wechat_batch_unsupported_draft');
 return {mediaId:id,title:a.title,articleType:String(a.article_type),fingerprint:webDraftFingerprint(items)};
}
export async function prepareBatch(input:Record<string,unknown>,deps:Deps){
 validAccount(input.expectedAccount);if(!Array.isArray(input.mediaIds)||input.mediaIds.length<2||input.mediaIds.length>8||input.mediaIds.some(x=>typeof x!=='string'||!x||x.length>256)||new Set(input.mediaIds).size!==input.mediaIds.length)throw Error('wechat_batch_size_invalid');
 const items=[];for(const id of input.mediaIds)items.push(await inspect(id as string,deps));
 return {expectedAccount:input.expectedAccount,items,note:'Preview only. Separate publications; scan requirements are determined by WeChat. No draft has been published.'};
}
export async function startBatch(input:Record<string,unknown>,deps:Deps){
 validAccount(input.expectedAccount);validId(input.requestId);if(input.confirmPublish!==true)throw Error('wechat_batch_confirmation_required');
 const entries=validateItems(input.items),fingerprint=createHash('sha256').update(JSON.stringify(entries)).digest('hex');
 const old=read(input.expectedAccount,input.requestId);
 if(old){if(old.fingerprint!==fingerprint)throw Error('wechat_batch_request_conflict');return {reused:true,...old}}
 const inspected=[];for(const item of entries){const a=await inspect(item.mediaId,deps);if(a.fingerprint!==item.expectedFingerprint)throw Error('wechat_batch_draft_changed');if(a.articleType==='newspic'&&(item.declareOriginal||item.notifyFollowers))throw Error('wechat_batch_newspic_setting_unsupported');if(deps.publication(input.expectedAccount,item.mediaId))throw Error('wechat_batch_existing_publication_check_status');inspected.push({...item,title:a.title,state:'pending' as const})}
 const job:Batch={id:input.requestId,account:input.expectedAccount,fingerprint,state:'running',current:0,items:inspected,updatedAt:new Date().toISOString()};
 try{save(job,true)}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw Error('wechat_batch_existing_request_check_status');throw e}
 const key=job.account+'\0'+job.id;workers().set(key,true);
 void run(job,deps).finally(()=>workers().delete(key));
 return {status:'running',requestId:job.id,items:job.items.map(x=>({mediaId:x.mediaId,title:x.title,state:x.state})),note:'Each item is an independent publication. WeChat may require another scan.'};
}
async function run(job:Batch,deps:Deps){
 try{
  for(let i=0;i<job.items.length;i++){
   job.current=i;const item=job.items[i];item.state='starting';save(job);
   let opened:Record<string,unknown>;
   try{opened=await deps.publish({...item,expectedAccount:job.account,requestId:job.id+':'+i,confirmPublish:true,title:undefined,state:undefined})}catch(e){item.state='unknown';item.error=e instanceof Error&&/^wechat_[a-z_]+$/.test(e.message)?e.message:'wechat_batch_start_outcome_unknown';job.state='stopped';save(job);return}
   if(typeof opened.sessionId!=='string'){item.state='unknown';item.error='wechat_batch_session_missing';job.state='stopped';save(job);return}
   item.sessionId=opened.sessionId;item.state='running';save(job);
   const until=Date.now()+20*60*1000;
   while(Date.now()<until){
    const record=deps.publication(job.account,item.mediaId);
    if(record?.state==='submitted'){item.state='submitted';save(job);await deps.close(item.sessionId).catch(()=>{});break}
    if(record?.state==='unknown'){item.state='unknown';item.error='wechat_publication_unknown';job.state='stopped';save(job);return}
    let session:Record<string,unknown>;try{session=await deps.session(item.sessionId)}catch{item.state='unknown';item.error='wechat_batch_session_lost';job.state='stopped';save(job);return}
    if(session.status==='error'||session.status==='stopped'){item.state=record?'unknown':'failed';item.error='wechat_batch_workflow_stopped';job.state='stopped';save(job);return}
    await new Promise(resolve=>setTimeout(resolve,4000));
   }
   if(item.state!=='submitted'){item.state='unknown';item.error='wechat_batch_wait_timeout';job.state='stopped';save(job);return}
  }
  job.state='completed';save(job);
 }catch{job.state='stopped';if(job.items[job.current]){job.items[job.current].state='unknown';job.items[job.current].error='wechat_batch_internal_error'}try{save(job)}catch{}}
}
export async function batchStatus(input:Record<string,unknown>,deps:Deps){
 validAccount(input.expectedAccount);validId(input.requestId);const job=read(input.expectedAccount,input.requestId);if(!job)return {found:false};
 const live=workers().has(job.account+'\0'+job.id);
 const item=job.items[job.current];let assistance:Record<string,unknown>|undefined;
 if(live&&item?.sessionId)try{assistance=await deps.assistance(item.sessionId)}catch{}
 return {found:true,...job,workerActive:live,status:job.state==='running'&&!live?'interrupted':job.state,assistance,note:'submitted means WeChat accepted a submission, not public visibility. If interrupted or unknown reconcile the original item; never resubmit blindly.'};
}
