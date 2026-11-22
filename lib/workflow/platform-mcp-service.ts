import { createDouyinCollection, listDouyinCollections, updateDouyinCollectionCover } from './douyin-collections';
import {retryDouyinVideoTask} from './douyin-request-retry';
import {getDouyinVideoPublication} from './douyin-publication-readback';
import {resolveDouyinPublicationInput} from './douyin-publication-input';
import {DOUYIN_VIDEO_OPTIONS} from './douyin-video-fields';
import {listVideoWorks,getVideoWork,deliveryByTaskId} from '../video-works/store';
import {prepareBatch,startBatch,batchStatus} from '../wechat/web-batch';
import {createHash} from 'node:crypto';
import {platformReleaseInfo} from './platform-release';
import {listWechatCollections,listWechatCollectionCandidates,createWechatCollection,wechatCollectionRequestStatus,addWechatCollectionItem,addWechatCollectionItems,listWechatCollectionItems} from '../wechat/collections';
import {callWechatMediaTool} from './wechat-media-service';
import {MEDIA_DRAFT_CAPABILITIES} from '../wechat/media-draft';
import {webPublishState} from '../wechat/web-publish';
import {issueWechatVerificationLink} from '../wechat/web-verification-link';
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
const WECHAT_OPERATOR_VNC='https://vnc-84-8-217-45.vyibc.com/vnc.html?autoconnect=1&resize=scale';
const WECHAT_WEB_CAPABILITIES={operatorVncUrl:WECHAT_OPERATOR_VNC,assistanceTool:'wechat_web_assistance',prepareWorkflow:'9a676224-70bd-41d4-9e85-c8d2b83a00c4',publishWorkflow:'cea6d731-ce15-46d8-95fb-f420ebfacb93',publishTool:'wechat_web_publish_draft',statusTool:'wechat_web_publish_status',maxTitleCharacters:{newspic:20,news:32},aiGeneratedOnly:false,sourceDeclarations:{singleChoice:true,aiContentRequires:'ai_generated',nonAiDefault:'personal_opinion',choices:['ai_generated','official_media','fiction','personal_opinion','health','investment','none'],editorSelectionVerified:true,publicSubmissionVerified:false},originalDeclaration:{news:'experimental_requires_author_and_explicit_user_agreement',newspic:'unsupported',endToEndVerified:false},followerNotification:{news:'optional_default_off',newspic:'unsupported',endToEndVerified:false},batchPublication:{tools:['wechat_web_batch_prepare','wechat_web_batch_publish','wechat_web_batch_status'],maxDrafts:8,independentPosts:true,scans:'wechat_decides_may_require_multiple',realEndToEndVerified:false},collections:{list:true,createArticle:'experimental_unverified',addPublishedArticle:'verified_guarded_async',batchTool:'wechat_add_collection_items',memberTool:'wechat_list_collection_items',candidatePagination:'page_nextArguments_hasMore_total_publication_groups_before_filters',candidateSearch:{nativeKeyword:true,recentDaysDefault:7,unassignedOnlyDefault:true,timeBasis:'UTC_rolling_days_native_publication_group_time',unknownMetadata:'excluded_and_counted'},batchLimit:20,dryRunDefault:true,statusTool:'wechat_collection_request_status',idempotency:'durable_requests_skip_existing_members',saveConcurrency:'native_update_time_and_sync_version_preserved',realAdditionVerified:true,verifiedOn:'2026-11-19',verifiedScope:'article_collections_single_article_groups_batch_and_single_preserve_members_replay_and_skip',publishTimeBinding:false},requiresPreparedFingerprint:true,administratorVerification:'may require administrator scan; poll the same workflow session for screenshot',recommendedTimeoutMs:120000,submittedMeaning:'WeChat accepted the final request; public visibility not independently verified',verifiedThrough:'news live submission received WeChat ret=0 and appeared in publication records; review and public visibility require separate confirmation; newspic final submission unverified',concurrency:1};
const owners=()=>global.__publicationPlatformSessions??=new Map<string,PublicationPlatform>();
function assertWechatWebAccount(account: unknown): asserts account is string {
 if(typeof account !== 'string' || !/^gh_[a-zA-Z0-9]{12}$/.test(account)) throw Error('wechat_web_invalid_account');
}
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
 if(name==='list_video_works')return listVideoWorks({platform,accountId:input.accountId as string|undefined,state:input.state as NonNullable<Parameters<typeof listVideoWorks>[0]>['state'],q:input.query as string|undefined,offset:input.offset as number|undefined,limit:input.limit as number|undefined});
 if(name==='get_video_work'){const work=getVideoWork(String(input.workId),platform);if(!work)throw Error('video_work_not_found');return {work};}
 if(name==='get_version'){const info=platformReleaseInfo(platform);if(platform!=='wechat')return info;const toolList=platformMcpTools(platform);return {...info,toolCount:toolList.length,toolListSha256:createHash('sha256').update(JSON.stringify(toolList)).digest('hex'),toolListHashAlgorithm:'sha256-json-tools-list-v1'};}
 if(platform==='wechat' && ['wechat_web_batch_prepare','wechat_web_batch_publish','wechat_web_batch_status'].includes(name)){
  const deps={getDraft:async(id:string)=>callWechatDraftTool('wechat_get_draft',{mediaId:id}),publish:async(value:Record<string,unknown>)=>callPlatformTool('wechat','wechat_web_publish_draft',value) as Promise<Record<string,unknown>>,publication:(account:string,id:string)=>webPublishState(account,id),session:async(id:string)=>callWorkflowTool('workflow_get_session',{sessionId:id,includeScreenshot:false}) as Promise<Record<string,unknown>>,close:async(id:string)=>callPlatformTool('wechat','workflow_close_session',{sessionId:id}),assistance:async(id:string)=>callPlatformTool('wechat','wechat_web_assistance',{sessionId:id}) as Promise<Record<string,unknown>>};
  return name==='wechat_web_batch_prepare'?prepareBatch(input,deps):name==='wechat_web_batch_publish'?startBatch(input,deps):batchStatus(input,deps);
 }
 if(platform==='wechat' && name==='wechat_create_collection')return createWechatCollection(input);
 if(platform==='wechat' && name==='wechat_add_collection_items')return addWechatCollectionItems(input);
 if(platform==='wechat' && name==='wechat_list_collection_items')return listWechatCollectionItems(input);
 if(platform==='wechat' && name==='wechat_add_collection_item')return addWechatCollectionItem(input);
 if(platform==='wechat' && name==='wechat_collection_request_status')return wechatCollectionRequestStatus(input);
 if(platform==='wechat' && name==='wechat_list_collections')return listWechatCollections(input);
 if(platform==='wechat' && name==='wechat_list_collection_candidates')return listWechatCollectionCandidates(input);
 if(platform==='wechat' && ['wechat_prepare_video_draft','wechat_list_video_work_drafts','wechat_create_video_draft','wechat_create_podcast_draft','wechat_media_draft_status'].includes(name))return callWechatMediaTool(name,input);
 if(platform==='wechat' && name==='wechat_web_assistance'){
  const active=[...owners()].filter(([sid,owner])=>owner==='wechat'&&!!getSession(sid)).map(([sid])=>sid);
  const sid=typeof input.sessionId==='string'?input.sessionId:active.length===1?active[0]:undefined;
  if(!sid)return {operatorVncUrl:WECHAT_OPERATOR_VNC,sessionStatus:active.length?'session_id_required':'no_active_session',activeSessionIds:active,note:'No scan is asserted. Supply the original publication sessionId; do not resubmit an unknown publication.'};
  const owner=owners().get(sid);
  if(owner&&owner!=='wechat')throw Error('platform_session_not_owned');
  if(!owner)return {operatorVncUrl:WECHAT_OPERATOR_VNC,sessionId:sid,sessionStatus:'unavailable',note:'The session is unavailable or the service restarted. Check original publication status and reconcile before retrying.'};
  const session=getSession(sid);
  if(!session)return {operatorVncUrl:WECHAT_OPERATOR_VNC,sessionId:sid,sessionStatus:'expired',note:'The original session is gone; check publication status and reconcile before any retry.'};
  assertWorkflow(platform,session.workflowId);
  const snapshot=await callWorkflowTool('workflow_get_session',{sessionId:sid,includeScreenshot:false}) as Record<string,unknown>;
  const observation=isRecord(snapshot.observation)?snapshot.observation:{};
  const body=typeof observation.text==='string'?observation.text:'';
  const state=body.includes('扫码后，请联系管理员进行验证')?'awaiting_admin_scan':body.includes('微信扫一扫，选择公众平台账号登录')?'awaiting_login_scan':/安全验证|验证码/.test(body)?'verification_visible':snapshot.status==='error'?'workflow_error':'session_open';
  const history=Array.isArray(snapshot.history)?snapshot.history:[];
  const last=history.length&&isRecord(history[history.length-1])?history[history.length-1]:{};
  const result=isRecord(last.result)?last.result:{};
  const verification = state==='awaiting_admin_scan' ? issueWechatVerificationLink(sid) : undefined;
  return {operatorVncUrl:WECHAT_OPERATOR_VNC,sessionId:sid,sessionStatus:snapshot.status,handoffState:state,sessionExpiresAt:snapshot.expiresAt,verificationUrl:verification?.url,verificationUrlExpiresAt:verification?.expiresAt,error:result.error||null,detail:result.output||null,
   note:state==='awaiting_admin_scan'?'Use VNC to complete the administrator verification, then poll the original publication status without opening a new request.':state==='awaiting_login_scan'?'Use VNC to sign in to the authorized account; then recheck the task.':'The VNC page is an assistance entry, not proof a QR code or a successful publication exists. Check the original task before retrying.',
   screenshotTool:'workflow_get_session',publicationStatusTool:'wechat_web_publish_status'};
 }
 if(platform==='wechat' && name==='wechat_web_publish_status'){
  assertWechatWebAccount(input.expectedAccount);
  if(typeof input.expectedAccount!=='string'||typeof input.mediaId!=='string')throw Error('wechat_web_invalid_input');
  const record=webPublishState(input.expectedAccount,input.mediaId);
  return record?{found:true,...record}:{found:false};
 }
 if(platform==='wechat' && name==='wechat_web_publish_draft'){
  assertWechatWebAccount(input.expectedAccount);
  if(input.confirmPublish!==true||typeof input.aiGenerated!=='boolean'||typeof input.expectedFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedFingerprint)||typeof input.requestId!=='string'||!input.requestId||typeof input.expectedAccount!=='string'||typeof input.mediaId!=='string')throw Error('wechat_web_confirmation_and_preparation_required');
  if(input.notifyFollowers!==undefined&&typeof input.notifyFollowers!=='boolean')throw Error('wechat_web_invalid_notify_followers');
  if(input.declareOriginal!==undefined&&typeof input.declareOriginal!=='boolean')throw Error('wechat_web_invalid_original_setting');
  if(input.declareOriginal===true&&(input.confirmOriginalAgreement!==true||typeof input.originalAuthor!=='string'||!input.originalAuthor.trim()||Array.from(input.originalAuthor).length>8))throw Error('wechat_web_original_author_and_agreement_required');
  const statements=['ai_generated','official_media','fiction','personal_opinion','health','investment','none'];
  const statement=input.articleStatement===undefined?(input.aiGenerated?'ai_generated':'personal_opinion'):input.articleStatement;
  if(typeof statement!=='string'||!statements.includes(statement))throw Error('wechat_web_invalid_article_statement');
  if((input.aiGenerated===true)!==(statement==='ai_generated'))throw Error('wechat_web_ai_statement_conflict');
  const old=webPublishState(input.expectedAccount,input.mediaId);
  if(old)return {reused:true,...old,note:'Existing intent; no second click. Query status.'};
  const opened=await callWorkflowTool('workflow_open_session',{workflowId:'cea6d731-ce15-46d8-95fb-f420ebfacb93',browserInstance:1,vars:{mediaId:input.mediaId,expectedAccount:input.expectedAccount,requestId:input.requestId,expectedFingerprint:input.expectedFingerprint,aiGenerated:input.aiGenerated?'true':'false',articleStatement:statement,declareOriginal:input.declareOriginal===true?'true':'false',originalAuthor:typeof input.originalAuthor==='string'?input.originalAuthor:'',confirmOriginalAgreement:input.confirmOriginalAgreement===true?'true':'false',notifyFollowers:input.notifyFollowers===true?'true':'false',directPublish:'true'},confirmBrowserControl:true}) as Record<string,unknown>;
  const sid=String(opened.sessionId);owners().set(sid,platform);
  try{
   await callWorkflowTool('workflow_run',{sessionId:sid,expectedRevision:opened.sessionRevision,requestId:input.requestId,confirmExecution:true});
   const verification=issueWechatVerificationLink(sid);
   return {status:'running',sessionId:sid,requestId:input.requestId,operatorVncUrl:WECHAT_OPERATOR_VNC,verificationUrl:verification.url,verificationUrlExpiresAt:verification.expiresAt,poll:'workflow_get_session',publicationStatus:'wechat_web_publish_status',note:'Keep session open through administrator verification. No retry under a new ID.'};
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
   formats:platform==='wechat'?['news-preparation','news-web-publication','newspic-preparation','newspic-web-publication','video-draft','podcast-draft']:platform==='x'?['text','single-image']:['video','image-text'],
   wechatWebPublication:platform==='wechat'?WECHAT_WEB_CAPABILITIES:undefined,
   xPublication:platform==='x'?c.xPublication:undefined,imageTextPublication:platform==='x'||platform==='wechat'?undefined:{...(c.imageTextPublication as object),platforms:[platform==='xiaohongshu'?'xhs':'douyin']},
   collections:platform==='douyin'?{listTool:'list_collections',createTool:'create_collection',creation:'empty_with_custom_or_generated_cover',updateCoverTool:'update_collection_cover',cover:{formats:['jpeg','png'],maxBytes:5242880,sourceHosts:['resource.vyibc.com','cdn.vyibc.com']},scope:'first_native_page',completeFlag:true}:undefined,
   video:platform==='douyin'?{workflowId:DOUYIN_WORKFLOW_ID,...DOUYIN_VIDEO_OPTIONS,maxBytes:536870912,topics:'caption_text',fields:DOUYIN_VIDEO_OPTIONS,workIdReuse:true,normalizedInputReturned:true,unsupportedParameters:'rejected',cover:'editor_preview_verified',receiptSources:['creation_response','creator_work_list'],publishViewport:{width:1440,height:1000,scope:'task_page'},prepareChecksPublishControl:true,failureDiagnostic:{field:'failureDiagnostic',submissionStates:['not_submitted','unknown']},archive:{owner:'auto-parse',retention:'permanent',originals:'content_hash_local_copy_on_upload',queryTools:['list_video_works','get_video_work'],prepareIsCloudDraft:false}}:undefined,
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
  if(platform==='wechat' && (id==='9a676224-70bd-41d4-9e85-c8d2b83a00c4' || id==='cea6d731-ce15-46d8-95fb-f420ebfacb93')) assertWechatWebAccount(isRecord(input.vars)?input.vars.expectedAccount:undefined);
  for(const sid of owners().keys())if(!getSession(sid))owners().delete(sid);
  const result=await callWorkflowTool(name,input);
  if(!isRecord(result)||typeof result.sessionId!=='string')throw Error('platform_session_not_created');
  owners().set(result.sessionId,platform);return result;
 }
 if(name==='x_publication_status')return callWorkflowTool(name,input);
 if(name==='prepare_video'||name==='publish_video'){
  const value=resolveDouyinPublicationInput(input);
  const p:DouyinWorkflowInput={requestId:value.requestId,expectedAccountId:value.accountId,videoUrl:value.videoUrl,title:value.title,description:value.description,topics:value.topics,aiGenerated:value.aiGenerated,prepareOnly:name==='prepare_video',confirmPublish:name==='publish_video'&&input.confirmPublish===true,cover:value.cover,settings:value.settings};
  const result=await startDouyinWorkflow(p);
  return {...result,publicationInput:{platform:'douyin',accountId:value.accountId,sourceUrl:value.videoUrl,title:value.title,description:value.description,topics:value.topics,cover:value.cover||null,...value.settings?{settings:value.settings}:{},aiGenerated:value.aiGenerated,mode:name==='prepare_video'?'prepare':'publish',requestId:value.requestId},inputSchemaVersion:value.settings?2:1};
 }
 if(name==='retry_video_task'){assertVideoTask(input.taskId);return retryDouyinVideoTask(String(input.taskId),input.confirmRetry===true);}
 if(name==='create_collection') return createDouyinCollection(String(input.accountId),input.name,input.description,input.confirmCreate,input.coverUrl);
 if(name==='update_collection_cover') return updateDouyinCollectionCover(String(input.accountId),String(input.collectionId),input.coverUrl,input.confirmUpdate);
 if(name==='list_collections') return listDouyinCollections(String(input.accountId));
 if(name==='get_video_publication'){return getDouyinVideoPublication(String(input.accountId),String(input.awemeId));}
 if(name==='get_video_task'){
  if(typeof input.taskId==='string'&&!getWorkflowTask(input.taskId)){const archived=deliveryByTaskId(input.taskId);if(archived?.input.platform===platform)return {ok:true,taskId:input.taskId,status:archived.state,receipt:archived.receipt,archive:archived,workflowExecution:null,note:'Permanent archive; short-lived execution details are unavailable. Do not resubmit.'};}
  const task=assertVideoTask(input.taskId),output=task.steps.find(s=>s.output?.awemeId||s.output?.prepared)?.output;
  const receipt=task.publication||(output?.awemeId?output:null);
  return {ok:true,taskId:task.taskId,status:receipt?(receipt.publicationMode==='scheduled'?'scheduled':'published'):output?.prepared?'prepared':task.status,receipt,prepared:output?.prepared?output:null,failureDiagnostic:task.steps.find(s=>s.status==='error')?.output?.publicationDiagnostic||null,settingsVerification:output?.settingsVerification||deliveryByTaskId(task.taskId)?.settingsVerification||null,workflowExecution:getWorkflowTaskSummary(task.taskId),publicationInput:deliveryByTaskId(task.taskId)?.input||null};
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
