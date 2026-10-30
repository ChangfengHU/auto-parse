import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
export const MEDIA_DRAFT_WORKFLOW='a5844b00-cd7b-442d-9e4f-8a5a18338b82';
export const MEDIA_MAX_BYTES=100*1024*1024;
export type MediaDraftInput={requestId:string;expectedAccount:string;kind:'video'|'podcast';sourceUrl:string;title:string;description:string};
export type MediaDraftRecord={input:MediaDraftInput;fingerprint:string;owner:string;state:'reserved'|'running'|'completed'|'failed'|'unknown';phase:string;updatedAt:string;materialSaved?:boolean;sessionId?:string;receipt?:Record<string,unknown>;error?:{code:string;message:string;hint:string}};
declare global {var __wechatMediaProcess:string|undefined}
const owner=()=>global.__wechatMediaProcess??=randomUUID();
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function mediaAssetUrl(value:unknown):URL{
 let u:URL;try{u=new URL(String(value))}catch{throw Error('media_asset_url_invalid')}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||!['resource.vyibc.com','cdn.vyibc.com'].includes(u.hostname))throw Error('media_asset_url_not_allowed');
 return u;
}
export function mediaDraftInput(kind:'video'|'podcast',raw:Record<string,unknown>):MediaDraftInput{
 if(raw.confirmDraft!==true)throw Error('media_draft_confirmation_required');
 const requestId=String(raw.requestId||''),expectedAccount=String(raw.expectedAccount||'');
 if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(requestId))throw Error('media_request_id_invalid');
 if(!/^gh_[A-Za-z0-9]{6,40}$/.test(expectedAccount))throw Error('media_expected_account_invalid');
 if(typeof raw.title!=='string'||!raw.title.trim()||raw.title!==raw.title.trim()||[...raw.title].length>20||/[\r\n]/.test(raw.title))throw Error('media_title_max_20_characters');
 if(raw.description!==undefined&&typeof raw.description!=='string')throw Error('media_description_invalid');
 const description=String(raw.description||'');
 if([...description].length>(kind==='video'?300:140))throw Error('media_description_too_long');
 return {requestId,expectedAccount,kind,sourceUrl:mediaAssetUrl(raw[kind==='video'?'videoUrl':'audioUrl']).href,title:raw.title,description};
}
const dir=()=>process.env.WECHAT_MEDIA_DRAFT_LEDGER||path.join(process.cwd(),'.runtime/wechat-media-drafts');
function file(account:string,id:string){return path.join(dir(),hash(account+'\n'+id)+'.json')}
function atomicSave(p:string,r:MediaDraftRecord){
 const temp=p+'.'+randomUUID()+'.tmp';let fd:number|undefined;
 try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(r));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,p);
 const d=fs.openSync(path.dirname(p),'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}}finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temp,{force:true})}
}
export function getMediaDraft(account:string,id:string):MediaDraftRecord|null{
 const p=file(account,id);let r:MediaDraftRecord;try{r=JSON.parse(fs.readFileSync(p,'utf8'))}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e}
 if(['reserved','running'].includes(r.state)&&r.owner!==owner())return {...r,state:'unknown',phase:'process_restarted',error:{code:'media_process_restarted',message:'服务重启，任务执行状态需核对。',hint:'不要更换 requestId 重提；按原请求及素材/草稿回执核对。'}};
 return r;
}
export function reserveMediaDraft(input:MediaDraftInput):{reused:boolean;record:MediaDraftRecord}{
 fs.mkdirSync(dir(),{recursive:true,mode:0o700});
 const fingerprint=hash(JSON.stringify(input)),p=file(input.expectedAccount,input.requestId);
 const existing=getMediaDraft(input.expectedAccount,input.requestId);
 if(existing){if(existing.fingerprint!==fingerprint)throw Error('media_request_id_conflict');return {reused:true,record:existing}}
 const record:MediaDraftRecord={input,fingerprint,owner:owner(),state:'reserved',phase:'reserved',updatedAt:new Date().toISOString()};
 let fd:number;try{fd=fs.openSync(p,'wx',0o600)}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')return reserveMediaDraft(input);throw e}
 try{fs.writeFileSync(fd,JSON.stringify(record));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
 const d=fs.openSync(dir(),'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
 return {reused:false,record};
}
export function updateMediaDraft(account:string,id:string,patch:Partial<MediaDraftRecord>){
 const p=file(account,id),lock=p+'.lock';const fd=fs.openSync(lock,'wx',0o600);
 try{
  const r=getMediaDraft(account,id);if(!r||r.owner!==owner())throw Error('media_task_owner_mismatch');
  if(['completed','failed','unknown'].includes(r.state))throw Error('media_task_terminal');
  const next={...r,...patch,input:r.input,fingerprint:r.fingerprint,owner:r.owner,updatedAt:new Date().toISOString()};atomicSave(p,next);return next;
 }finally{fs.closeSync(fd);fs.rmSync(lock,{force:true})}
}
export function mediaDraftView(record:MediaDraftRecord|null){
 if(!record)return {found:false};
 const {input,fingerprint,state,phase,updatedAt,materialSaved,receipt,error}=record;
 return {found:true,requestId:input.requestId,expectedAccount:input.expectedAccount,kind:input.kind,title:input.title,fingerprint,status:state,phase,updatedAt,materialSaved:!!materialSaved,receipt,error,published:false,statusTool:'wechat_media_draft_status',retry:'Repeat the same requestId to read existing state. Never use a new ID for an uncertain save.'};
}
export const MEDIA_DRAFT_CAPABILITIES={workflowId:MEDIA_DRAFT_WORKFLOW,tools:['wechat_create_video_draft','wechat_create_podcast_draft','wechat_media_draft_status'],async:true,concurrency:1,browserInstance:1,sourceHosts:['resource.vyibc.com','cdn.vyibc.com'],sourceUrl:'HTTPS without credentials, query or fragment; redirects revalidated',localLimits:{maxBytes:MEDIA_MAX_BYTES,maxTitleCharacters:20,maxVideoDescriptionCharacters:300,maxPodcastDescriptionCharacters:140,video:'MP4 H.264, optional AAC',audio:'MP3',maxDurationSeconds:3600},covers:{video:'first recommended video frame',podcast:'account avatar'},pollIntervalMs:5000,jobDeadlineMs:600000,recommendedCallTimeoutMs:30000,verification:'save response plus reloaded native editor; no playback or public publication claim',restart:'Receipts persist; unfinished jobs become unknown, never automatically replayed',publicPublication:false};
