import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {VideoWork} from './store';
import {WORK_CHANNELS,mostRecentDelivery,type WorkChannel,type ChannelCopy,type ChannelContent,type WorkView} from './presentation';
type Revision=ChannelCopy&{revision:number;requestId:string;fingerprint:string;updatedAt:string};
type RecordData={id:string;sourceUrl:string;platform:WorkChannel;accountId:string;versions:Revision[]};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const directory=()=>path.join(process.env.VIDEO_WORKS_DATA_DIR||path.join(process.cwd(),'.data','video-work-center'),'channel-content');
function records(){let files:string[];try{files=fs.readdirSync(directory())}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e}return files.filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(f=>{try{return JSON.parse(fs.readFileSync(path.join(directory(),f),'utf8')) as RecordData}catch{throw Error('channel_content_unreadable')}})}
function belongs(r:RecordData,w:VideoWork){return r.sourceUrl===w.sourceUrl||w.sourceIds?.includes(hash(r.sourceUrl))}
function summary(r:RecordData):ChannelContent{const v=r.versions.at(-1);if(!v)throw Error('channel_content_unreadable');return {id:r.id,platform:r.platform,accountId:r.accountId,title:v.title,description:v.description,topics:v.topics,cover:v.cover,revision:v.revision,updatedAt:v.updatedAt}}
export function contentRecords(){return records()}
export function channelContentsForWork(w:VideoWork,all=records()){return all.filter(r=>belongs(r,w)).map(summary)}
function target(platform:unknown,accountId:unknown){if(typeof platform!=='string'||!WORK_CHANNELS.some(c=>c.id===platform))throw Error('channel_invalid');if(accountId!==undefined&&(typeof accountId!=='string'||!/^[A-Za-z0-9_.-]{1,100}$/.test(accountId)))throw Error('channel_account_invalid');return {platform:platform as WorkChannel,accountId:String(accountId||'')}}
export function readChannelContent(w:WorkView,input:Record<string,unknown>){
 const p=target(input.platform,input.accountId),all=records().filter(r=>belongs(r,w)),exact=all.find(r=>r.platform===p.platform&&r.accountId===p.accountId),fallback=all.find(r=>r.platform===p.platform&&!r.accountId);
 const previous=mostRecentDelivery(w.deliveries.filter(d=>d.input.platform===p.platform&&(!p.accountId||d.input.accountId===p.accountId)));
 const inherited=exact||fallback,v=inherited?.versions.at(-1);
 const content:ChannelCopy=v?{title:v.title,description:v.description,topics:v.topics,cover:v.cover}:previous?{title:previous.input.title,description:previous.input.description,topics:previous.input.topics,cover:previous.input.cover}:{title:w.title,description:w.description||'',topics:w.topics||[]};
 return {workId:w.id,...p,revision:exact?.versions.at(-1)?.revision||0,lastRequestId:exact?.versions.at(-1)?.requestId,content,source:exact?'saved_channel_content':fallback?'channel_default':previous?'delivery_snapshot':'work_default',sourceAccountId:previous&&!v?previous.input.accountId:undefined,updatedAt:v?.updatedAt,history:exact?.versions.map(({revision,title,description,topics,cover,updatedAt})=>({revision,title,description,topics,cover,updatedAt}))||[],capability:WORK_CHANNELS.find(c=>c.id===p.platform)?.capability,externalActionsTriggered:false};
}
function copy(input:Record<string,unknown>):ChannelCopy{
 if(typeof input.title!=='string'||!input.title.trim()||input.title.length>500||typeof input.description!=='string'||input.description.length>20000||!Array.isArray(input.topics)||input.topics.length>20||input.topics.some(t=>typeof t!=='string'||t.length>100))throw Error('channel_content_invalid');
 let cover:ChannelCopy['cover'];if(input.cover!==undefined){if(!input.cover||typeof input.cover!=='object'||Array.isArray(input.cover)||Object.keys(input.cover).some(k=>!['verticalUrl','horizontalUrl'].includes(k)))throw Error('channel_cover_invalid');cover={};for(const [k,v]of Object.entries(input.cover)){if(v===undefined||v==='')continue;if(typeof v!=='string'||v.length>2048)throw Error('channel_cover_invalid');let u:URL;try{u=new URL(v)}catch{throw Error('channel_cover_invalid')}if(u.protocol!=='https:'||!['cdn.vyibc.com','resource.vyibc.com'].includes(u.hostname)||u.username||u.password||u.port||u.search||u.hash)throw Error('channel_cover_invalid');cover[k as keyof NonNullable<typeof cover>]=u.href;}}
 return {title:input.title,description:input.description,topics:input.topics as string[],...(cover&&Object.keys(cover).length?{cover}:{})};
}
export function saveChannelContent(w:WorkView,input:Record<string,unknown>){
 if(input.confirmSave!==true)throw Error('channel_save_confirmation_required');
 const p=target(input.platform,input.accountId),content=copy(input);
 if(!Number.isSafeInteger(input.expectedRevision)||(input.expectedRevision as number)<0||typeof input.requestId!=='string'||!/^[A-Za-z0-9_.:-]{8,120}$/.test(input.requestId))throw Error('channel_revision_or_request_invalid');
 const existing=records().find(r=>belongs(r,w)&&r.platform===p.platform&&r.accountId===p.accountId),fingerprint=hash(JSON.stringify([p,content,input.expectedRevision]));
 const replay=existing?.versions.find(v=>v.requestId===input.requestId);if(replay){if(replay.fingerprint!==fingerprint)throw Error('channel_request_conflict');return {workId:w.id,content:summary(existing!),savedRevision:replay.revision,reused:true,externalActionsTriggered:false}}
 const current=existing?.versions.at(-1)?.revision||0;if(current!==input.expectedRevision)throw Error('channel_content_revision_conflict');
 const id=existing?.id||hash([w.sourceUrl,p.platform,p.accountId].join('\n')),updatedAt=new Date().toISOString(),revision=current+1;
 const record:RecordData={id,sourceUrl:existing?.sourceUrl||w.sourceUrl,...p,versions:[...(existing?.versions||[]),{...content,revision,updatedAt,requestId:input.requestId,fingerprint}]};
 fs.mkdirSync(directory(),{recursive:true,mode:0o700});const file=path.join(directory(),id+'.json'),tmp=file+'.'+randomUUID()+'.tmp';
 let fd:number|undefined;try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(record));fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,file);const parent=fs.openSync(directory(),'r');try{fs.fsyncSync(parent)}finally{fs.closeSync(parent)}}finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(tmp,{force:true})}
 return {workId:w.id,content:summary(record),savedRevision:revision,reused:false,externalActionsTriggered:false};
}
