import {normalizeDouyinSettings} from './douyin-settings';
import {getVideoWork,type VideoWork} from '../video-works/store';
import {readChannelContent} from '../video-works/channel-content';
import {validateCoverUrl} from './douyin-cover';
export function resolveDouyinPublicationInput(input:Record<string,unknown>,providedWork?:VideoWork){
 const keys=['workId','accountId','videoUrl','title','description','topics','aiGenerated','requestId','cover','confirmPublish','settings'];
 if(Object.keys(input).some(k=>!keys.includes(k)))throw Error('publication_unsupported_parameter');
 const w=providedWork||(input.workId?getVideoWork(String(input.workId)):undefined);
 if(input.workId&&!w)throw Error('video_work_not_found');
 if(w&&input.videoUrl!==undefined&&input.videoUrl!==w.sourceUrl)throw Error('publication_work_source_conflict');
 if(typeof input.accountId!=='string'||!/^\d{5,30}$/.test(input.accountId))throw Error('publication_account_invalid');
 const plan=w?readChannelContent(w,{platform:'douyin',accountId:input.accountId}).content:undefined;
 const title=input.title===undefined?plan?.title:input.title,description=input.description===undefined?plan?.description||'':input.description,topics=input.topics===undefined?plan?.topics||[]:input.topics,aiGenerated=input.aiGenerated;
 if(typeof title!=='string'||!title.trim()||Array.from(title).length>30||typeof description!=='string'||description.length>900||!Array.isArray(topics)||topics.length>5||topics.some(t=>typeof t!=='string'||!/^[\p{L}\p{N}_]{1,30}$/u.test(t)))throw Error('publication_metadata_invalid');
 if(typeof aiGenerated!=='boolean'||(w?.aiGenerated&&aiGenerated!==true))throw Error('publication_ai_declaration_required');
 const videoUrl=input.videoUrl===undefined?w?.sourceUrl:input.videoUrl;
 if(typeof videoUrl!=='string')throw Error('publication_video_url_required');const u=new URL(videoUrl);
 if(u.protocol!=='https:'||!['resource.vyibc.com','cdn.vyibc.com'].includes(u.hostname)||u.username||u.password||u.port||u.search||u.hash||!u.pathname.endsWith('.mp4'))throw Error('publication_video_url_invalid');
 if(typeof input.requestId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId))throw Error('publication_input_invalid');
 const raw=input.cover===undefined?plan?.cover:input.cover;let cover:{verticalUrl?:string;horizontalUrl?:string}|undefined;
 if(raw!==undefined){if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['verticalUrl','horizontalUrl'].includes(k)))throw Error('publication_cover_input_invalid');cover={};for(const [k,v] of Object.entries(raw)){if(v!==undefined&&v!==''){if(typeof v!=='string')throw Error('publication_cover_input_invalid');cover[k as 'verticalUrl'|'horizontalUrl']=validateCoverUrl(v)}}if(!Object.keys(cover).length)cover=undefined}
 const settings=input.settings===undefined?undefined:normalizeDouyinSettings(input.settings);
 return {accountId:input.accountId,videoUrl:u.href,title,description,topics:topics as string[],aiGenerated,requestId:input.requestId,...cover?{cover}:{},...settings?{settings}:{}};
}
