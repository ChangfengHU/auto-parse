import {createHash} from 'node:crypto';
import {allVideoDeliveries,getVideoWork,type VideoWork} from '../video-works/store';
import {readChannelContent} from '../video-works/channel-content';
export type WechatVideoContext={workId?:string;sourceAiGenerated?:boolean;fieldSources?:{title:string;description:string}};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function resolveWechatVideoAccount(override:unknown){
 if(override!==undefined){if(typeof override!=='string'||!/^gh_[A-Za-z0-9]{12}$/.test(override))throw Error('wechat_original_account_id_required');return override}
 const configured=process.env.VIDEO_WORKS_DEFAULT_WECHAT_ACCOUNT;
 if(configured&&/^gh_[A-Za-z0-9]{12}$/.test(configured))return configured;
 const accounts=[...new Set(allVideoDeliveries().filter(d=>d.input.platform==='wechat'&&d.state==='draft_saved'&&/^gh_[A-Za-z0-9]{12}$/.test(d.input.accountId)).map(d=>d.input.accountId))];
 if(accounts.length!==1)throw Error('wechat_default_account_not_unique');
 return accounts[0];
}
function selectedWork(id:unknown):VideoWork{const w=getVideoWork(String(id||''));if(!w)throw Error('video_work_not_found');return w}
function overrides(input:Record<string,unknown>){
 if(input.title!==undefined&&typeof input.title!=='string')throw Error('media_title_invalid');
 if(input.description!==undefined&&typeof input.description!=='string')throw Error('media_description_invalid');
}
export function prepareWechatVideoWork(input:Record<string,unknown>){
 overrides(input);const w=selectedWork(input.workId),expectedAccount=resolveWechatVideoAccount(input.expectedAccount);
 if(input.videoUrl!==undefined&&input.videoUrl!==w.sourceUrl)throw Error('wechat_video_work_source_conflict');
 const saved=readChannelContent(w,{platform:'wechat',accountId:expectedAccount});
 const title=input.title===undefined?saved.content.title:input.title as string,description=input.description===undefined?saved.content.description:input.description as string;
 const previous=w.deliveries.filter(d=>d.input.platform==='wechat'&&d.input.accountId===expectedAccount&&d.input.title===title&&d.input.description===description)
  .sort((a,b)=>Number(b.state==='draft_saved')-Number(a.state==='draft_saved')||b.updatedAt.localeCompare(a.updatedAt))[0];
 const canonicalRequestId=previous?.input.requestId||'workdraft-'+hash(JSON.stringify([w.sha256||w.sourceUrl,expectedAccount,title,description])).slice(0,48);
 if(input.requestId!==undefined&&(typeof input.requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(input.requestId)))throw Error('media_request_id_invalid');
 if(previous&&input.requestId!==undefined&&input.requestId!==previous.input.requestId)throw Error('wechat_video_existing_draft_use_original_request');
 const requestId=typeof input.requestId==='string'?input.requestId:canonicalRequestId;
 const needsAdaptation=!title.trim()||title!==title.trim()||/[\r\n]/.test(title)||Array.from(title).length>20||Array.from(description).length>300;
 const context:WechatVideoContext={workId:w.id,sourceAiGenerated:w.aiGenerated,fieldSources:{title:input.title===undefined?saved.source:'explicit_input',description:input.description===undefined?saved.source:'explicit_input'}};
 return {workId:w.id,expectedAccount,requestId,videoUrl:w.sourceUrl,title,description,needsAdaptation,originalRetained:!!w.archive,originalBytes:w.archive?.bytes||null,limits:{title:20,description:300,bytes:104857600},context,instructions:'Use the resolved channel/account copy. Adapt overlong text without truncation. Keep the returned requestId; an existing draft is reused. Saving only, never public publication.'};
}
export function resolveWechatVideoCreate(input:Record<string,unknown>){
 const allowed=['workId','expectedAccount','requestId','videoUrl','title','description','confirmDraft'];
 if(Object.keys(input).some(k=>!allowed.includes(k)))throw Error('wechat_video_unsupported_parameter');
 overrides(input);
 if(input.workId!==undefined){
  const plan=prepareWechatVideoWork(input);
  if(!plan.originalRetained)throw Error('work_original_not_retained_poll_work_first');
  if((plan.originalBytes||0)>104857600)throw Error('wechat_original_exceeds_100mib_no_automatic_quality_loss');
  return {input:{requestId:plan.requestId,expectedAccount:plan.expectedAccount,videoUrl:plan.videoUrl,title:plan.title,description:plan.description,confirmDraft:input.confirmDraft},context:plan.context};
 }
 const work=typeof input.videoUrl==='string'?getVideoWork(hash(input.videoUrl)):null;
 return {input,context:{workId:work?.id,sourceAiGenerated:work?.aiGenerated,fieldSources:{title:'explicit_input',description:input.description===undefined?'empty_default':'explicit_input'}} as WechatVideoContext};
}
