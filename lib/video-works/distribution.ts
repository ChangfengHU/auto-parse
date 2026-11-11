import {createHash} from 'node:crypto';
import {allVideoDeliveries,type VideoWork,type VideoDelivery} from './store';
import {readChannelContent} from './channel-content';
import {resolveDouyinPublicationInput} from '../workflow/douyin-publication-input';
import {DOUYIN_VIDEO_OPTIONS} from '../workflow/douyin-video-fields';
export {DOUYIN_VIDEO_OPTIONS} from '../workflow/douyin-video-fields';
import {callPlatformTool} from '../workflow/platform-mcp-service';

export function knownDouyinAccounts(){
 return [...new Set(allVideoDeliveries().filter(d=>d.input.platform==='douyin'&&d.state==='published'&&d.receipt?.workId&&/^\d{5,30}$/.test(d.input.accountId)).map(d=>d.input.accountId))];
}
export function douyinPlan(w:VideoWork,account?:string){
 const accounts=knownDouyinAccounts(),local=w.deliveries.find(d=>d.input.platform==='douyin'&&d.state==='published')?.input.accountId;
 const accountId=account||local||(accounts.length===1?accounts[0]:'');
 if(accountId&&!/^\d{5,30}$/.test(accountId))throw Error('publication_account_invalid');
 return {accountId,accounts,content:readChannelContent(w,{platform:'douyin',...accountId?{accountId}:{}}).content,aiGenerated:w.aiGenerated||false,originalRetained:!!w.archive,originalBytes:w.archive?.bytes||null,options:DOUYIN_VIDEO_OPTIONS};
}
function clean(w:VideoWork,p:Record<string,unknown>){
 const v=resolveDouyinPublicationInput({accountId:p.accountId,title:p.title,description:p.description,topics:p.topics,aiGenerated:p.aiGenerated,cover:p.cover,requestId:'validation_request'},w);
 return {accountId:v.accountId,title:v.title,description:v.description,topics:v.topics,aiGenerated:v.aiGenerated,...v.cover?{cover:v.cover}:{}};
}
const signature=(p:{title:string;description:string;topics:string[];aiGenerated:boolean;cover?:{verticalUrl?:string;horizontalUrl?:string}})=>JSON.stringify([p.title,p.description,p.topics,p.aiGenerated,p.cover?.verticalUrl||'',p.cover?.horizontalUrl||'']);
function matching(w:VideoWork,p:ReturnType<typeof clean>,mode:'prepare'|'publish'){
 return w.deliveries.filter(d=>d.input.platform==='douyin'&&d.input.accountId===p.accountId&&d.input.mode===mode&&signature(d.input)===signature(p)).sort((a,b)=>Number(b.state==='published')-Number(a.state==='published')||b.updatedAt.localeCompare(a.updatedAt))[0];
}
async function status(d:VideoDelivery){
 if(d.state==='published')return {state:d.state,taskId:d.taskId,requestId:d.input.requestId,receipt:d.receipt};
 if(d.taskId){const r=await callPlatformTool('douyin','get_video_task',{taskId:d.taskId}) as {status?:string;receipt?:{awemeId?:string;videoUrl?:string};taskId?:string};return {state:r.status||d.state,taskId:d.taskId,requestId:d.input.requestId,receipt:r.receipt||d.receipt}}
 return {state:d.state,requestId:d.input.requestId,error:d.error};
}
export async function getWorkDouyinStatus(w:VideoWork,accountId?:string){
 const d=w.deliveries.filter(d=>d.input.platform==='douyin'&&(!accountId||d.input.accountId===accountId)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
 return d?status(d).catch(()=>({state:'unknown',taskId:d.taskId,requestId:d.input.requestId,error:'publication_status_unavailable'})):null;
}
export async function executeWorkDouyin(w:VideoWork,p:Record<string,unknown>,restrictedAccount=false){
 if(!['prepare','publish','status'].includes(String(p.action)))throw Error('publication_action_invalid');
 const value=clean(w,p),mode=p.mode==='prepare'||p.action==='prepare'?'prepare':'publish';
 if(restrictedAccount&&!knownDouyinAccounts().includes(value.accountId))throw Error('publication_account_not_previously_verified');
 const old=matching(w,value,mode);
 if(p.action==='status')return {operation:old?await status(old):null,found:!!old,externalActionsTriggered:false};
 if(p.action==='publish'?p.confirmPublish!==true:p.confirmPrepare!==true)throw Error('publication_confirmation_required');
 if(!w.archive)throw Error('work_original_not_retained_poll_work_first');
 if(w.archive.bytes>DOUYIN_VIDEO_OPTIONS.maxBytes)throw Error('publication_original_exceeds_512mib');
 if(old)return {operation:await status(old),reused:true,externalActionsTriggered:false};
 const uncertain=w.deliveries.find(d=>d.input.platform==='douyin'&&d.input.accountId===value.accountId&&d.input.mode==='publish'&&['unknown','running','reserved'].includes(d.state));
 if(uncertain)throw Error('publication_previous_result_unresolved');
 const requestId='work-'+createHash('sha256').update(JSON.stringify([w.sha256||w.sourceUrl,value])).digest('hex').slice(0,48);
 const result=await callPlatformTool('douyin',p.action==='prepare'?'prepare_video':'publish_video',{...value,videoUrl:w.sourceUrl,requestId,...p.action==='publish'?{confirmPublish:true}:{}});
 const r=result as {status?:string;taskId?:string;receipt?:unknown};
 return {operation:{state:r.status||'running',taskId:r.taskId,requestId,receipt:r.receipt},reused:false,externalActionsTriggered:true};
}
