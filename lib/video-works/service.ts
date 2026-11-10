import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {allVideoDeliveries,getVideoWork,listVideoWorks,registerVideoWork,updateVideoRegistration,retainVideoOriginal,retainedVideoPathForSource,syncVideoWorkflowTask,syncWechatVideoDraft,videoSourceUrl} from './store';
import {callWechatMediaTool} from '../workflow/wechat-media-service';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const pending=new Map<string,string>();let running=0;
function enqueue(sourceUrl:string){
 if(retainedVideoPathForSource(sourceUrl)||pending.has(sourceUrl))return;
 pending.set(sourceUrl,sourceUrl);updateVideoRegistration(sourceUrl,{retentionState:'queued'});pump();
}
function pump(){for(const [url,state] of pending){if(running>=2)break;if(state!=='running'){pending.set(url,'running');running++;void retain(url).finally(()=>{pending.delete(url);running--;pump()})}}}
async function retain(sourceUrl:string){
 let directory:string|undefined;
 try{
  updateVideoRegistration(sourceUrl,{retentionState:'running',retentionError:undefined});
  const response=await fetch(videoSourceUrl(sourceUrl),{redirect:'error',signal:AbortSignal.timeout(300000)});
  if(!response.ok||!response.body)throw Error('work_original_http_'+response.status);
  const length=Number(response.headers.get('content-length')||0);if(length>536870912)throw Error('work_original_too_large');
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'video-work-ingest-'));const space=fs.statfsSync(directory);
  if(space.bavail*space.bsize<(length||536870912)*2+268435456)throw Error('work_disk_space_insufficient');
  const file=path.join(directory,'original.mp4'),fd=fs.openSync(file,'wx',0o600);let size=0;
  const reader=response.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>536870912)throw Error('work_original_too_large');fs.writeSync(fd,value)}fs.fsyncSync(fd)}finally{await reader.cancel().catch(()=>{});fs.closeSync(fd)}
  const {stdout}=await promisify(execFile)('ffprobe',['-v','error','-show_entries','format=format_name:stream=codec_type','-of','json',file],{timeout:20000,maxBuffer:65536});
  const metadata=JSON.parse(stdout);if(!metadata.format?.format_name?.includes('mp4')||!metadata.streams?.some((s:{codec_type:string})=>s.codec_type==='video'))throw Error('work_original_not_mp4_video');
  await retainVideoOriginal(sourceUrl,file);
 }catch(e){try{updateVideoRegistration(sourceUrl,{retentionState:'failed',retentionError:e instanceof Error&&/^[a-z0-9_]+$/.test(e.message)?e.message:'work_original_retention_failed'})}catch{}}
 finally{if(directory)fs.rmSync(directory,{recursive:true,force:true})}
}
function work(id:unknown){const w=getVideoWork(String(id||''));if(!w)throw Error('video_work_not_found');return w}
export function registerIndependentWork(input:Record<string,unknown>){
 if(input.confirmRecord!==true)throw Error('work_registration_confirmation_required');
 const sourceUrl=videoSourceUrl(String(input.sourceUrl||'')),existing=getVideoWork(hash(sourceUrl));
 if(existing){if(!retainedVideoPathForSource(sourceUrl)){registerVideoWork({sourceUrl,title:existing.title,description:existing.description,topics:existing.topics,aiGenerated:existing.aiGenerated||false,origin:'historical'},true);enqueue(sourceUrl)}return {work:existing,reused:true,published:false}}
 const registered=registerVideoWork({sourceUrl,title:String(input.title||''),description:typeof input.description==='string'?input.description:undefined,topics:input.topics as string[]|undefined,aiGenerated:input.aiGenerated as boolean,origin:input.origin==='historical'?'historical':input.origin==='material'?'material':'generated',reportedPlatformUrl:typeof input.platformUrl==='string'?input.platformUrl:undefined});
 enqueue(sourceUrl);return {work:work(registered.record.id),reused:registered.reused,published:false,originalRetention:'asynchronous; poll get_video_work; registration is not publication'};
}
export function backfillIndependentWork(input:Record<string,unknown>){
 if(input.confirmRecord!==true)throw Error('work_registration_confirmation_required');
 if(input.taskId){
  const id=String(input.taskId);if(!/^[A-Za-z0-9-]{8,100}$/.test(id))throw Error('video_work_task_id_invalid');
  let task;try{task=JSON.parse(fs.readFileSync(path.join(process.cwd(),'.data','workflow-tasks',id+'.json'),'utf8'))}catch{throw Error('historical_task_unavailable_register_original_url_instead')}
  const delivery=syncVideoWorkflowTask(task);if(!delivery)throw Error('historical_task_not_supported_video');
  const w=work(hash(delivery.input.sourceUrl));if(!w.archive)enqueue(w.sourceUrl);return {work:w,recorded:true,externalActionsTriggered:false};
 }
 return {...registerIndependentWork({...input,origin:'historical'}),externalActionsTriggered:false};
}
function defaultWechatAccount(override:unknown){
 if(override!==undefined){if(typeof override!=='string'||!/^gh_[A-Za-z0-9]{12}$/.test(override))throw Error('wechat_original_account_id_required');return override}
 const configured=process.env.VIDEO_WORKS_DEFAULT_WECHAT_ACCOUNT;
 if(configured&&/^gh_[A-Za-z0-9]{12}$/.test(configured))return configured;
 const accounts=[...new Set(allVideoDeliveries().filter(d=>d.input.platform==='wechat'&&d.state==='draft_saved'&&/^gh_[A-Za-z0-9]{12}$/.test(d.input.accountId)).map(d=>d.input.accountId))];
 if(accounts.length!==1)throw Error('wechat_default_account_not_unique');
 return accounts[0];
}
export function prepareWorkWechatDraft(input:Record<string,unknown>){
 const w=work(input.workId),expectedAccount=defaultWechatAccount(input.expectedAccount);
 const old=w.deliveries.find(d=>d.input.platform==='wechat'&&d.input.accountId===expectedAccount);
 const title=typeof input.title==='string'?input.title:old?.input.title||w.title;
 const description=typeof input.description==='string'?input.description:old?.input.description??w.description??'';
 const needsAdaptation=!title.trim()||title!==title.trim()||/[\r\n]/.test(title)||Array.from(title).length>20||Array.from(description).length>300;
 const requestId='workdraft-'+hash(JSON.stringify([w.sha256||w.sourceUrl,expectedAccount,title,description])).slice(0,48);
 return {workId:w.id,expectedAccount,requestId,videoUrl:w.sourceUrl,title,description,needsAdaptation,originalRetained:!!w.archive,originalBytes:w.archive?.bytes||null,limits:{title:20,description:300,bytes:104857600},instructions:'Use stored source and known account. Agent rewrites overlong metadata, preserving meaning; never ask user to repeat existing assets. Saving only, never publicly publish.'};
}
export async function createWorkWechatDraft(input:Record<string,unknown>){
 if(input.confirmDraft!==true)throw Error('work_draft_confirmation_required');
 const p=prepareWorkWechatDraft(input);if(p.needsAdaptation)return {...p,status:'metadata_adaptation_required',created:false};
 if(!p.originalRetained)throw Error('work_original_not_retained_poll_work_first');
 if((p.originalBytes||0)>104857600)throw Error('wechat_original_exceeds_100mib_no_automatic_quality_loss');
 const previous=work(p.workId).deliveries.find(d=>d.input.platform==='wechat'&&d.input.accountId===p.expectedAccount&&d.input.title===p.title&&d.input.description===p.description);
 if(previous){const view=await callWechatMediaTool('wechat_media_draft_status',{requestId:previous.input.requestId,expectedAccount:p.expectedAccount}) as {status?:string;phase?:string;error?:{code?:string}};if(!(view.status==='failed'&&view.phase==='reserved'&&view.error?.code==='managed_browser_busy'))return {workId:p.workId,requestId:previous.input.requestId,expectedAccount:p.expectedAccount,result:view,reused:true,publiclyPublished:false,statusTool:'get_wechat_video_drafts'};p.requestId=previous.input.requestId;}
 const result=await callWechatMediaTool('wechat_create_video_draft',{requestId:p.requestId,expectedAccount:p.expectedAccount,videoUrl:p.videoUrl,title:p.title,description:p.description,confirmDraft:true});
 return {workId:p.workId,requestId:p.requestId,expectedAccount:p.expectedAccount,result,publiclyPublished:false,statusTool:'get_wechat_video_drafts'};
}
export async function getWorkWechatDrafts(input:Record<string,unknown>){
 const w=work(input.workId),records=w.deliveries.filter(d=>d.input.platform==='wechat'&&(!input.expectedAccount||d.input.accountId===input.expectedAccount)),items=[];
 for(const d of records){
  const view=await callWechatMediaTool('wechat_media_draft_status',{requestId:d.input.requestId,expectedAccount:d.input.accountId}) as {found?:boolean;status?:string;receipt?:Record<string,unknown>;error?:{code:string};updatedAt?:string};
  if(view.found)syncWechatVideoDraft({input:{kind:'video',requestId:d.input.requestId,expectedAccount:d.input.accountId,sourceUrl:d.input.sourceUrl,title:d.input.title,description:d.input.description},state:view.status||'unknown',receipt:view.receipt,error:view.error,updatedAt:view.updatedAt});
  items.push({requestId:d.input.requestId,expectedAccount:d.input.accountId,...view});
 }
 return {workId:w.id,items,publiclyPublished:false,completion:'completed with saveResponseAccepted and nativeEditorReloadVerified'};
}
export async function callVideoWorksTool(name:string,input:Record<string,unknown>){
 if(name==='list_video_works')return listVideoWorks({q:input.query as string|undefined,state:input.state as NonNullable<Parameters<typeof listVideoWorks>[0]>['state'],platform:input.platform as string|undefined,offset:input.offset as number|undefined,limit:input.limit as number|undefined});
 if(name==='get_video_work')return {work:work(input.workId),retentionProcess:'running/queued can require re-register after restart; local retention retry never republishes'};
 if(name==='register_video_work')return registerIndependentWork(input);
 if(name==='backfill_video_work')return backfillIndependentWork(input);
 if(name==='prepare_wechat_video_draft')return prepareWorkWechatDraft(input);
 if(name==='create_wechat_video_draft')return createWorkWechatDraft(input);
 if(name==='get_wechat_video_drafts')return getWorkWechatDrafts(input);
 throw Error('video_works_tool_not_allowed');
}
