import type {DouyinPublicationSettings} from '../workflow/douyin-settings';
import fs from 'node:fs';
import {channelContentsForWork,contentRecords} from './channel-content';
import type {WorkView} from './presentation';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';

export type VideoPlatform='douyin'|'xiaohongshu'|'wechat'|'x'|'channels'|'instagram'|'threads'|'facebook'|'tiktok';
export type DeliveryState='reserved'|'running'|'prepared'|'draft_saved'|'published'|'scheduled'|'failed'|'unknown';
export type DeliveryInput={platform:VideoPlatform;accountId:string;requestId:string;sourceUrl:string;title:string;description:string;topics:string[];aiGenerated:boolean;mode:'prepare'|'draft'|'publish';settings?:DouyinPublicationSettings;cover?:{verticalUrl?:string;horizontalUrl?:string}};
export type ArchivedVideo={sha256:string;bytes:number;savedAt:string;storage:'local_original'};
export type VideoDelivery={id:string;input:DeliveryInput;fingerprint:string;state:DeliveryState;createdAt:string;updatedAt:string;taskId?:string;receipt?:{workId?:string;url?:string;draftId?:string;moderation?:string;verifiedAt?:string};error?:string;archive?:ArchivedVideo;provenance?:string;sourceCreatedAt?:string;settingsVerification?:Record<string,unknown>};
export type VideoWork={id:string;title:string;sourceUrl:string;sha256:string|null;archive:ArchivedVideo|null;createdAt:string;updatedAt:string;deliveries:VideoDelivery[];description?:string;topics?:string[];aiGenerated?:boolean;sourceIds?:string[];retentionState?:string;retentionError?:string;reportedPlatformUrl?:string;referenceEvidence?:string};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const root=()=>process.env.VIDEO_WORKS_DATA_DIR||path.join(process.cwd(),'.data','video-work-center');
export const videoFileDirectory=()=>path.join(root(),'originals');
const records=()=>path.join(root(),'deliveries');
const platforms=['douyin','xiaohongshu','wechat','x','channels','instagram','threads','facebook','tiktok'];
export function videoSourceUrl(value:string){
 const u=new URL(value);
 if(u.protocol!=='https:'||!['cdn.vyibc.com','resource.vyibc.com'].includes(u.hostname)||u.username||u.password||u.port||u.search||u.hash||!u.pathname.toLowerCase().endsWith('.mp4'))throw Error('video_work_source_invalid');
 return u.href;
}
function atomic(file:string,value:unknown){
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 const temp=file+'.'+randomUUID()+'.tmp';let fd:number|undefined;
 try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,file);
 const d=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}}
 finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temp,{force:true})}
}
export function allVideoDeliveries():VideoDelivery[]{
 let names:string[];try{names=fs.readdirSync(records())}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e}
 return names.filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(n=>{try{return JSON.parse(fs.readFileSync(path.join(records(),n),'utf8')) as VideoDelivery}catch{throw Error('video_work_record_unreadable')}});
}
export function recordVideoDelivery(input:DeliveryInput,patch:Partial<Omit<VideoDelivery,'id'|'input'|'fingerprint'|'createdAt'>>={}):VideoDelivery{
 if(!platforms.includes(input.platform)||!/^[A-Za-z0-9_.-]{1,100}$/.test(input.accountId)||!/^[A-Za-z0-9_.-]{1,120}$/.test(input.requestId)||!input.title.trim()||input.title.length>500||input.description.length>20000||!Array.isArray(input.topics)||input.topics.some(t=>typeof t!=='string'))throw Error('video_work_input_invalid');
 const clean={...input,sourceUrl:videoSourceUrl(input.sourceUrl)};
 const id=hash([input.platform,input.accountId,input.requestId,input.mode].join('\n')),fingerprint=hash(JSON.stringify(clean));
 const file=path.join(records(),id+'.json');
 let old:VideoDelivery|undefined;
 try{old=JSON.parse(fs.readFileSync(file,'utf8'))}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw Error('video_work_record_unreadable')}
 if(old&&old.fingerprint!==fingerprint)throw Error('video_work_request_conflict');
 const now=new Date().toISOString();
 const state=(old?.state==='published'||old?.state==='scheduled'||old?.state==='draft_saved')?old.state:patch.state||old?.state||'reserved';
 const next:VideoDelivery={...old,...patch,id,input:clean,fingerprint,createdAt:old?.createdAt||now,updatedAt:old&&Object.keys(patch).every(k=>k==='archive')?old.updatedAt:now,state};
 if(old?.receipt)next.receipt={...old.receipt,...patch.receipt};
 atomic(file,next);const registered=registerVideoWork({...clean,origin:'publisher'},true);if(next.archive&&!registered.record.archive)updateVideoRegistration(clean.sourceUrl,{archive:next.archive,retentionState:'retained'});return next;
}
export function patchVideoDelivery(id:string,patch:Partial<Omit<VideoDelivery,'id'|'input'|'fingerprint'|'createdAt'>>){
 if(!/^[a-f0-9]{64}$/.test(id))throw Error('video_work_id_invalid');
 const old=JSON.parse(fs.readFileSync(path.join(records(),id+'.json'),'utf8')) as VideoDelivery;
 return recordVideoDelivery(old.input,patch);
}
export function deliveryInputFromDouyin(input:{requestId:string;expectedAccountId:string;videoUrl:string;title:string;description?:string;topics?:string[];aiGenerated:boolean;prepareOnly?:boolean;settings?:DouyinPublicationSettings;cover?:{verticalUrl?:string;horizontalUrl?:string}}):DeliveryInput{
 return {platform:'douyin',accountId:input.expectedAccountId,requestId:input.requestId,sourceUrl:input.videoUrl,title:input.title,description:input.description||'',topics:input.topics||[],aiGenerated:input.aiGenerated,mode:input.prepareOnly?'prepare':'publish',...(input.cover?{cover:input.cover}:{}),...(input.settings?{settings:input.settings}:{})};
}
type TaskSnapshot={taskId:string;startedAt:number;status:string;publication?:{awemeId?:string;videoUrl?:string;moderation?:string};workflow:{nodes:Array<{params:Record<string,unknown>}>};steps:Array<{output?:Record<string,unknown>}>;errorMessage?:string};
export function syncVideoWorkflowTask(task:TaskSnapshot){
 const raw=task.workflow.nodes.map(n=>n.params.douyinPublication).find(Boolean) as Parameters<typeof deliveryInputFromDouyin>[0]|undefined;
 if(!raw)return null;
 const input=deliveryInputFromDouyin(raw),output=task.steps.map(s=>s.output).find(o=>o?.awemeId||o?.prepared);
 const receipt=task.publication||output;
 const uncertain=!!task.errorMessage?.includes('unknown')||fs.existsSync(path.join(process.cwd(),'.data','douyin-publications',hash(raw.expectedAccountId+':'+raw.requestId)+'.json'));
 const state:DeliveryState=receipt?.awemeId?(raw.settings?.scheduledAt?'scheduled':'published'):output?.prepared?'prepared':task.status==='running'?'running':task.status==='error'?(uncertain?'unknown':'failed'):task.status==='stopped'?'unknown':'unknown';
 return recordVideoDelivery(input,{taskId:task.taskId,state,sourceCreatedAt:new Date(task.startedAt).toISOString(),...receipt?.awemeId?{receipt:{workId:String(receipt.awemeId),url:String(receipt.videoUrl||'https://www.douyin.com/video/'+receipt.awemeId),moderation:String(receipt.moderation||'pending_or_unknown')}}:{},...task.errorMessage?{error:/^[a-z0-9_]+$/.test(task.errorMessage)?task.errorMessage:'workflow_failed_check_original_task'}:{},provenance:'auto_parse_workflow'});
}
export function deliveryByTaskId(taskId:string){return allVideoDeliveries().find(d=>d.taskId===taskId)||null}
export function listVideoWorks(options:{platform?:string;platforms?:string[];platformMatch?:'any'|'all';states?:string[];state?:DeliveryState|'registered'|'content_ready';accountId?:string;q?:string;offset?:number;limit?:number}={}){
 const all=allVideoDeliveries(),registered=registeredVideoWorks(),groups=new Map<string,VideoWork>();
 const sourceHashes=new Map<string,string>();for(const d of [...registered,...all.map(d=>({sourceUrl:d.input.sourceUrl,archive:d.archive}))])if(d.archive)sourceHashes.set(d.sourceUrl,d.archive.sha256);
 const visible=all.filter(d=>(!options.platform||d.input.platform===options.platform)&&(!options.accountId||d.input.accountId===options.accountId)),sources=new Set(visible.map(d=>d.input.sourceUrl));
 for(const r of registered){
  if((options.platform||options.accountId)&&!sources.has(r.sourceUrl))continue;
  const sha=r.archive?.sha256||sourceHashes.get(r.sourceUrl)||null,id=sha||hash(r.sourceUrl),old=groups.get(id);
  if(old){old.sourceIds?.push(r.id);continue}
  groups.set(id,{id,title:r.title,description:r.description,topics:r.topics,aiGenerated:r.aiGenerated,sourceUrl:r.sourceUrl,sourceIds:[r.id],retentionState:r.archive?'retained':r.retentionState,retentionError:r.retentionError,reportedPlatformUrl:r.reportedPlatformUrl,referenceEvidence:r.reportedPlatformUrl?'reported_not_verified':undefined,sha256:sha,archive:r.archive||null,createdAt:r.createdAt,updatedAt:r.updatedAt,deliveries:[]});
 }
 for(const d of visible){
  const sha=d.archive?.sha256||sourceHashes.get(d.input.sourceUrl)||null,id=sha||hash(d.input.sourceUrl),g=groups.get(id);
  if(!g)groups.set(id,{id,title:d.input.title,description:d.input.description,topics:d.input.topics,aiGenerated:d.input.aiGenerated,sourceUrl:d.input.sourceUrl,sourceIds:[hash(d.input.sourceUrl)],sha256:sha,archive:d.archive||null,createdAt:d.sourceCreatedAt||d.createdAt,updatedAt:d.updatedAt,deliveries:[d]});
  else{g.deliveries.push(d);if(!g.sourceIds?.includes(hash(d.input.sourceUrl)))g.sourceIds?.push(hash(d.input.sourceUrl));if(d.updatedAt>g.updatedAt)g.updatedAt=d.updatedAt;if((d.sourceCreatedAt||d.createdAt)<g.createdAt)g.createdAt=d.sourceCreatedAt||d.createdAt;if(d.archive)g.archive=d.archive}
 }
 const q=options.q?.trim().toLocaleLowerCase()||'',pool=contentRecords(),chosen=options.platforms||[],wanted=options.states?.length?options.states:options.state?[options.state]:[];
 const stateMatch=(w:WorkView,p?:string)=>{const ds=w.deliveries.filter(d=>!p||d.input.platform===p),cs=(w.channelContents||[]).filter(c=>!p||c.platform===p);return !wanted.length?ds.length>0||cs.length>0:wanted.some(s=>s==='content_ready'?cs.length>0:s==='registered'?!ds.length&&(p?cs.length>0:true):ds.some(d=>d.state===s))};
 const matching=[...groups.values()].map(w=>{const channelContents=channelContentsForWork(w,pool).filter(c=>(!options.platform||c.platform===options.platform)&&(!options.accountId||c.accountId===options.accountId));return {...w,channelContents,updatedAt:channelContents.reduce((a,c)=>c.updatedAt>a?c.updatedAt:a,w.updatedAt)}}).filter(w=>chosen.length?(options.platformMatch==='all'?chosen.every(p=>stateMatch(w,p)):chosen.some(p=>stateMatch(w,p))):!wanted.length||stateMatch(w)).filter(w=>!q||JSON.stringify([w.id,w.sourceUrl,w.sourceIds,w.title,w.description,w.topics,w.deliveries.map(d=>[d.input.title,d.input.description,d.input.accountId,d.taskId,d.receipt?.workId]),w.channelContents.map(c=>[c.title,c.description,c.accountId,c.topics])]).toLocaleLowerCase().includes(q)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 const offset=Math.max(0,Math.floor(options.offset||0)),limit=Math.min(100,Math.max(1,Math.floor(options.limit||20)));
 return {items:matching.slice(offset,offset+limit),total:matching.length,nextOffset:offset+limit<matching.length?offset+limit:null,retention:'permanent_until_explicit_owner_removal',workflowCacheIsArchive:false};
}
export function getVideoWork(id:string,platform?:string){
 if(!/^[a-f0-9]{64}$/.test(id))throw Error('video_work_id_invalid');
 let offset=0;for(;;){const page=listVideoWorks({platform,offset,limit:100});const found=page.items.find(w=>w.id===id||w.sourceIds?.includes(id)||hash(w.sourceUrl)===id||w.deliveries.some(d=>hash(d.input.sourceUrl)===id));if(found)return found;if(page.nextOffset===null)return null;offset=page.nextOffset;}
}
export async function retainVideoOriginal(sourceUrl:string,localFile:string){
 const matching=allVideoDeliveries().filter(d=>d.input.sourceUrl===sourceUrl);
 const registered=registeredVideoWorks().filter(r=>r.sourceUrl===sourceUrl);
 if(!matching.length&&!registered.length)return null;
 const stat=fs.statSync(localFile);if(!stat.isFile()||stat.size===0||stat.size>536870912)throw Error('video_work_file_size_invalid');
 const h=createHash('sha256');for await(const chunk of fs.createReadStream(localFile))h.update(chunk);
 const sha256=h.digest('hex'),dir=videoFileDirectory();fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const dest=path.join(dir,sha256+'.mp4');
 if(!fs.existsSync(dest)){
  const space=fs.statfsSync(dir);if(space.bavail*space.bsize<stat.size+134217728)throw Error('video_work_disk_space_insufficient');
  const temp=path.join(dir,sha256+'.'+randomUUID()+'.tmp');
  try{fs.copyFileSync(localFile,temp,fs.constants.COPYFILE_EXCL);fs.chmodSync(temp,0o600);const f=fs.openSync(temp,'r');try{fs.fsyncSync(f)}finally{fs.closeSync(f)};fs.renameSync(temp,dest)}
  finally{fs.rmSync(temp,{force:true})}
 }
 if(fs.statSync(dest).size!==stat.size)throw Error('video_work_archive_size_mismatch');
 const archive:ArchivedVideo={sha256,bytes:stat.size,storage:'local_original',savedAt:new Date().toISOString()};
 for(const d of matching)recordVideoDelivery(d.input,{archive});
 for(const r of registered)updateVideoRegistration(r.sourceUrl,{archive,retentionState:'retained',retentionError:undefined});
 await ensureVideoPoster(sha256).catch(()=>{});
 return archive;
}

export function syncWechatVideoDraft(record:{context?:{sourceAiGenerated?:boolean};input:{kind:string;requestId:string;expectedAccount:string;sourceUrl:string;title:string;description:string};state:string;receipt?:Record<string,unknown>;error?:{code:string};sessionId?:string;updatedAt?:string}){
 const p=record.input;if(p.kind!=='video')return null;
 const prior=allVideoDeliveries().find(d=>d.input.platform==='wechat'&&d.input.accountId===p.expectedAccount&&d.input.requestId===p.requestId&&d.input.mode==='draft');const source=registeredVideoWorks().find(w=>w.sourceUrl===p.sourceUrl);
 const state:DeliveryState=record.state==='completed'&&record.receipt?.saveResponseAccepted===true&&record.receipt?.nativeEditorReloadVerified===true?'draft_saved':['reserved','running','failed'].includes(record.state)?record.state as DeliveryState:'unknown';
 return recordVideoDelivery({platform:'wechat',accountId:p.expectedAccount,requestId:p.requestId,sourceUrl:p.sourceUrl,title:p.title,description:p.description,topics:[],aiGenerated:prior?.input.aiGenerated??record.context?.sourceAiGenerated??source?.aiGenerated??false,mode:'draft'},{state,...record.sessionId?{taskId:record.sessionId}:{},...record.updatedAt?{sourceCreatedAt:record.updatedAt}:{},receipt:record.receipt?.appMsgId?{draftId:String(record.receipt.appMsgId),verifiedAt:typeof record.receipt.verifiedAt==='string'?record.receipt.verifiedAt:undefined}:undefined,error:record.error?.code,provenance:'wechat_native_video_draft'});
}
export function retainedVideoPathForSource(sourceUrl:string){
 const record=allVideoDeliveries().find(d=>d.input.sourceUrl===sourceUrl&&d.archive)||registeredVideoWorks().find(r=>r.sourceUrl===sourceUrl&&r.archive);
 if(!record?.archive)return null;
 const file=path.join(videoFileDirectory(),record.archive.sha256+'.mp4');
 try{return fs.statSync(file).size===record.archive.bytes?file:null}catch{return null}
}

export const videoPosterPath=(sha256:string)=>{
 if(!/^[a-f0-9]{64}$/.test(sha256))throw Error('video_work_hash_invalid');
 return path.join(root(),'posters',sha256+'.jpg');
};
export async function ensureVideoPoster(sha256:string){
 const target=videoPosterPath(sha256);if(fs.existsSync(target))return target;
 fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
 const temp=target+'.'+randomUUID()+'.jpg';
 try{
  await promisify(execFile)('ffmpeg',['-nostdin','-v','error','-ss','0','-i',path.join(videoFileDirectory(),sha256+'.mp4'),'-frames:v','1','-vf','scale=640:640:force_original_aspect_ratio=decrease','-q:v','3','-y',temp],{timeout:20000,maxBuffer:65536});
  fs.chmodSync(temp,0o600);fs.renameSync(temp,target);return target;
 }finally{fs.rmSync(temp,{force:true})}
}

export type WorkRegistration={id:string;sourceUrl:string;title:string;description:string;topics:string[];aiGenerated:boolean;origin:'generated'|'historical'|'material'|'publisher';createdAt:string;updatedAt:string;archive?:ArchivedVideo;retentionState?:'registered'|'queued'|'running'|'retained'|'failed';retentionError?:string;reportedPlatformUrl?:string};
const workRecords=()=>path.join(root(),'works');
export function registeredVideoWorks():WorkRegistration[]{
 let files:string[];try{files=fs.readdirSync(workRecords())}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e}
 return files.filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>{try{return JSON.parse(fs.readFileSync(path.join(workRecords(),f),'utf8')) as WorkRegistration}catch{throw Error('video_work_registration_unreadable')}});
}
export function registerVideoWork(input:{sourceUrl:string;title:string;description?:string;topics?:string[];aiGenerated:boolean;origin?:WorkRegistration['origin'];reportedPlatformUrl?:string},publisherCapture=false){
 const sourceUrl=videoSourceUrl(input.sourceUrl);
 if(typeof input.title!=='string'||!input.title.trim()||input.title.length>500||typeof input.aiGenerated!=='boolean'||(input.description||'').length>20000||input.topics?.some(t=>typeof t!=='string'||t.length>100))throw Error('video_work_registration_invalid');
 if(input.reportedPlatformUrl&&!/^https:\/\/(?:www\.)?(?:douyin\.com\/video\/[0-9]+|mp\.weixin\.qq\.com\/s\/[A-Za-z0-9_-]+)\/?$/.test(input.reportedPlatformUrl))throw Error('video_work_platform_reference_invalid');
 const id=hash(sourceUrl),file=path.join(workRecords(),id+'.json');let previous:WorkRegistration|undefined;
 try{previous=JSON.parse(fs.readFileSync(file,'utf8'))}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw Error('video_work_registration_unreadable')}
 if(previous){
  if(!publisherCapture&&(previous.title!==input.title||previous.description!==(input.description||'')||previous.aiGenerated!==input.aiGenerated||JSON.stringify(previous.topics)!==JSON.stringify(input.topics||[])))throw Error('video_work_registration_conflict');
  return {record:previous,reused:true};
 }
 const now=new Date().toISOString(),record:WorkRegistration={id,sourceUrl,title:input.title,description:input.description||'',topics:input.topics||[],aiGenerated:input.aiGenerated,origin:input.origin||'generated',createdAt:now,updatedAt:now,retentionState:'registered',...(input.reportedPlatformUrl?{reportedPlatformUrl:input.reportedPlatformUrl}:{})};
 atomic(file,record);return {record,reused:false};
}
export function updateVideoRegistration(sourceUrl:string,patch:Partial<Pick<WorkRegistration,'archive'|'retentionState'|'retentionError'>>){
 const file=path.join(workRecords(),hash(sourceUrl)+'.json');const record=JSON.parse(fs.readFileSync(file,'utf8')) as WorkRegistration;
 atomic(file,{...record,...patch});return {...record,...patch};
}
