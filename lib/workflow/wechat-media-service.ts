import {callWorkflowTool} from './mcp-service';
import {getSession} from './session-store';
import {MEDIA_DRAFT_WORKFLOW,getMediaDraft,mediaDraftInput,mediaDraftView,reserveMediaDraft,updateMediaDraft} from '../wechat/media-draft';
export async function callWechatMediaTool(name:string,input:Record<string,unknown>){
 if(name==='wechat_media_draft_status'){
  if(typeof input.expectedAccount!=='string'||typeof input.requestId!=='string')throw Error('media_status_input_invalid');
  return mediaDraftView(getMediaDraft(input.expectedAccount,input.requestId));
 }
 const data=mediaDraftInput(name==='wechat_create_video_draft'?'video':'podcast',input);
 const reserved=reserveMediaDraft(data);if(reserved.reused)return {...mediaDraftView(reserved.record),reused:true};
 // Return immediately. The receipt is durable before any browser side effect.
 void start(data.expectedAccount,data.requestId).catch(()=>{});
 return {...mediaDraftView(reserved.record),reused:false};
}
async function start(account:string,requestId:string){
 let sessionId:string|undefined;
 try{
  const workflow=await callWorkflowTool('workflow_get',{workflowId:MEDIA_DRAFT_WORKFLOW}) as {nodes?:Array<{type:string;disabled?:boolean;params:Record<string,unknown>}>};
  if(workflow.nodes?.length!==1||workflow.nodes[0].type!=='wechat_media_draft'||workflow.nodes[0].disabled||workflow.nodes[0].params.requestId!=='{{requestId}}'||workflow.nodes[0].params.expectedAccount!=='{{expectedAccount}}')throw Error('media_workflow_not_ready');
  const opened=await callWorkflowTool('workflow_open_session',{workflowId:MEDIA_DRAFT_WORKFLOW,browserInstance:1,vars:{expectedAccount:account,requestId},confirmBrowserControl:true}) as {sessionId:string;sessionRevision:number};
  sessionId=opened.sessionId;updateMediaDraft(account,requestId,{sessionId});
  await callWorkflowTool('workflow_run',{sessionId,expectedRevision:opened.sessionRevision,requestId,confirmExecution:true});
  const deadline=Date.now()+600000;
  while(Date.now()<deadline){
   const session=getSession(sessionId);if(!session||['done','error'].includes(session.status))break;
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  const current=getMediaDraft(account,requestId);
  if(current&&['reserved','running'].includes(current.state))updateMediaDraft(account,requestId,{state:'unknown',phase:'workflow_incomplete',error:{code:'media_workflow_incomplete',message:'工作流未返回可确认回执。',hint:'检查原请求和草稿箱，禁止换 ID 重试。'}});
 }catch(error){
  const current=getMediaDraft(account,requestId);if(current&&['reserved','running'].includes(current.state)){
   const message=error instanceof Error?error.message:'';const code=/^[a-z0-9_]+$/.test(message)?message:'media_workflow_start_failed';
   updateMediaDraft(account,requestId,{state:current.state==='reserved'?'failed':'unknown',error:{code,message:'工作流启动或执行失败。',hint:'先查询原请求的阶段及回执；未知保存不得重新提交。'}});
  }
 }finally{if(sessionId)await callWorkflowTool('workflow_close_session',{sessionId}).catch(()=>{})}
}
