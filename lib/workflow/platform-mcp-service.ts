import {callWechatMediaTool} from './wechat-media-service';
import {MEDIA_DRAFT_CAPABILITIES} from '../wechat/media-draft';
import {webPublishState} from '../wechat/web-publish';
import {callWechatDraftTool} from '../wechat/draft-service';
import {WECHAT_DRAFT_TOOLS} from '../wechat/draft-contract';
import {callWorkflowTool} from './mcp-service';
import {getSession} from './session-store';
import {startDouyinWorkflow,DOUYIN_WORKFLOW_ID} from './douyin-workflow-service';
import {getWorkflowTask,getWorkflowTaskSummary} from './workflow-task-cli';
import {reconcileDouyinTask} from './douyin-reconcile';
import {PLATFORM_WORKFLOWS,platformMcpTools,type PublicationPlatform} from './platform-mcp-contract';
import type {DouyinWorkflowInput} from './douyin-workflow-service';
import {isRecord} from './validation';
declare global {var __publicationPlatformSessions:Map<string,PublicationPlatform>|undefined;}
const WECHAT_WEB_CAPABILITIES={prepareWorkflow:'9a676224-70bd-41d4-9e85-c8d2b83a00c4',publishWorkflow:'cea6d731-ce15-46d8-95fb-f420ebfacb93',publishTool:'wechat_web_publish_draft',statusTool:'wechat_web_publish_status',maxTitleCharacters:20,aiGeneratedOnly:true,requiresPreparedFingerprint:true,administratorVerification:'may require administrator scan; poll the same workflow session for screenshot',recommendedTimeoutMs:120000,submittedMeaning:'WeChat accepted the final request; public visibility not independently verified',verifiedThrough:'real logged-in page reached administrator verification; final live submission not yet acceptance-tested',concurrency:1};
const owners=()=>global.__publicationPlatformSessions??=new Map<string,PublicationPlatform>();
function assertWorkflow(platform:PublicationPlatform,id:unknown){
 if(typeof id!=='string'||!Object.hasOwn(PLATFORM_WORKFLOWS[platform],id))throw Error('platform_workflow_not_allowed');
 return id;
}
function assertVideoTask(id:unknown){
 if(typeof id!=='string')throw Error('task_id_required');
 const task=getWorkflowTask(id);
 if(!task||task.workflowId!==DOUYIN_WORKFLOW_ID)throw Error('platform_video_task_not_found');
 return task;
}
export async function callPlatformTool(platform:PublicationPlatform,name:string,input:Record<string,unknown>):Promise<unknown>{
 if(!platformMcpTools(platform).some(t=>t.name===name))throw Error('platform_tool_not_allowed');
 if(platform==='wechat' && ['wechat_create_video_draft','wechat_create_podcast_draft','wechat_media_draft_status'].includes(name))return callWechatMediaTool(name,input);
 if(platform==='wechat' && name==='wechat_web_publish_status'){
  if(typeof input.expectedAccount!=='string'||typeof input.mediaId!=='string')throw Error('wechat_web_invalid_input');
  const record=webPublishState(input.expectedAccount,input.mediaId);
  return record?{found:true,...record}:{found:false};
 }
 if(platform==='wechat' && name==='wechat_web_publish_draft'){
  if(input.confirmPublish!==true||input.aiGenerated!==true||typeof input.expectedFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedFingerprint)||typeof input.requestId!=='string'||!input.requestId||typeof input.expectedAccount!=='string'||typeof input.mediaId!=='string')throw Error('wechat_web_confirmation_and_preparation_required');
  const old=webPublishState(input.expectedAccount,input.mediaId);
  if(old)return {reused:true,...old,note:'Existing intent; no second click. Query status.'};
  const opened=await callWorkflowTool('workflow_open_session',{workflowId:'cea6d731-ce15-46d8-95fb-f420ebfacb93',browserInstance:1,vars:{mediaId:input.mediaId,expectedAccount:input.expectedAccount,requestId:input.requestId,expectedFingerprint:input.expectedFingerprint,aiGenerated:'true',directPublish:'true'},confirmBrowserControl:true}) as Record<string,unknown>;
  const sid=String(opened.sessionId);owners().set(sid,platform);
  try{
   await callWorkflowTool('workflow_run',{sessionId:sid,expectedRevision:opened.sessionRevision,requestId:input.requestId,confirmExecution:true});
   return {status:'running',sessionId:sid,requestId:input.requestId,poll:'workflow_get_session',publicationStatus:'wechat_web_publish_status',note:'Keep session open through administrator verification. No retry under a new ID.'};
  }catch(error){await callWorkflowTool('workflow_close_session',{sessionId:sid}).catch(()=>{});owners().delete(sid);throw error;}
 }
 if(platform==='wechat' && WECHAT_DRAFT_TOOLS.some(t=>t.name===name)){
  const value=await callWechatDraftTool(name,input);
  return name==='wechat_capabilities'?{...value,webPublication:WECHAT_WEB_CAPABILITIES,mediaDrafts:MEDIA_DRAFT_CAPABILITIES}:value;
 }
 if(name==='workflow_capabilities'){
  const c=await callWorkflowTool(name,{}) as Record<string,unknown>;
  return {owner:'auto-parse',platform,workflows:Object.keys(PLATFORM_WORKFLOWS[platform]),browserInstances:[...new Set(Object.values(PLATFORM_WORKFLOWS[platform]))],
   sessionIdleMinutes:c.sessionIdleMinutes,sessionSurvivesRestart:false,authoring:false,
   formats:platform==='wechat'?['newspic-preparation','newspic-web-publication','video-draft','podcast-draft']:platform==='x'?['text','single-image']:['video','image-text'],
   wechatWebPublication:platform==='wechat'?WECHAT_WEB_CAPABILITIES:undefined,
   xPublication:platform==='x'?c.xPublication:undefined,imageTextPublication:platform==='x'||platform==='wechat'?undefined:{...(c.imageTextPublication as object),platforms:[platform==='xiaohongshu'?'xhs':'douyin']},
   video:platform==='douyin'?{workflowId:DOUYIN_WORKFLOW_ID,maxBytes:536870912,topics:'caption_text',cover:'experimental',receiptSources:['creation_response','creator_work_list']}:undefined,
   limits:'Only platform-approved workflows; no arbitrary nodes/CRUD. User-authorized account control and explicit public publication. Unknown submissions must not be retried.'};
 }
 if(name==='workflow_list'){
  const rows=await Promise.all(Object.keys(PLATFORM_WORKFLOWS[platform]).map(async workflowId=>{
   const w=await callWorkflowTool('workflow_get',{workflowId}) as Record<string,unknown>;
   return {id:w.id,name:w.name,description:w.description,updatedAt:w.updatedAt,nodeCount:Array.isArray(w.nodes)?w.nodes.length:0};
  }));
  const query=typeof input.query==='string'?input.query.toLowerCase():'';
  const matches=rows.filter(w=>!query||JSON.stringify(w).toLowerCase().includes(query));
  const page=Number(input.page||1),limit=Number(input.limit||50);
  return {source:'supabase',platform,items:matches.slice((page-1)*limit,page*limit),total:matches.length,page,totalPages:Math.ceil(matches.length/limit)};
 }
 if(name==='workflow_get')return callWorkflowTool(name,{workflowId:assertWorkflow(platform,input.workflowId)});
 if(name==='workflow_open_session'){
  const id=assertWorkflow(platform,input.workflowId);
  if(input.browserInstance!==PLATFORM_WORKFLOWS[platform][id])throw Error('platform_browser_mismatch');
  for(const sid of owners().keys())if(!getSession(sid))owners().delete(sid);
  const result=await callWorkflowTool(name,input);
  if(!isRecord(result)||typeof result.sessionId!=='string')throw Error('platform_session_not_created');
  owners().set(result.sessionId,platform);return result;
 }
 if(name==='x_publication_status')return callWorkflowTool(name,input);
 if(name==='prepare_video'||name==='publish_video'){
  const p:DouyinWorkflowInput={requestId:String(input.requestId),expectedAccountId:String(input.accountId),videoUrl:String(input.videoUrl),title:String(input.title),description:typeof input.description==='string'?input.description:'',topics:Array.isArray(input.topics)?input.topics as string[]:[],aiGenerated:input.aiGenerated as boolean,prepareOnly:name==='prepare_video',confirmPublish:name==='publish_video'&&input.confirmPublish===true,cover:input.cover as DouyinWorkflowInput['cover']};
  return startDouyinWorkflow(p);
 }
 if(name==='get_video_task'){
  const task=assertVideoTask(input.taskId),output=task.steps.find(s=>s.output?.awemeId||s.output?.prepared)?.output;
  const receipt=task.publication||(output?.awemeId?output:null);
  return {ok:true,taskId:task.taskId,status:receipt?'published':output?.prepared?'prepared':task.status,receipt,prepared:output?.prepared?output:null,workflowExecution:getWorkflowTaskSummary(task.taskId)};
 }
 if(name==='reconcile_video_task'){
  assertVideoTask(input.taskId);
  const receipt=await reconcileDouyinTask(String(input.taskId),String(input.awemeId));
  return {ok:true,taskId:input.taskId,status:'published',receipt,noPublicationPerformed:true};
 }
 const sid=input.sessionId;
 if(typeof sid!=='string'||owners().get(sid)!==platform)throw Error('platform_session_not_owned');
 const session=getSession(sid);
 if(!session){owners().delete(sid);throw Error('platform_session_expired_do_not_retry_unknown_actions');}
 assertWorkflow(platform,session.workflowId);
 const result=await callWorkflowTool(name,input);
 if((name==='workflow_close_session'||name==='workflow_stop')&&!getSession(sid))owners().delete(sid);
 return result;
}
