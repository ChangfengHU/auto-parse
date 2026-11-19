import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export type BatchInput={account:string;requestId:string;collectionId:string;contentIds:string[];dryRun:boolean;maxPages:number;query?:string};
export type BatchRecord={input:BatchInput;fingerprint:string;owner:string;state:'queued'|'running'|'submitting'|'completed'|'failed'|'unknown';phase:string;updatedAt:string;finalAttempted:boolean;result?:Record<string,unknown>;error?:string;diagnostic?:Record<string,unknown>;attempts:number};
declare global{var __wechatCollectionBatchOwner:string|undefined}
const owner=()=>global.__wechatCollectionBatchOwner??=randomUUID(),hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export const batchDirectory=()=>process.env.WECHAT_COLLECTION_BATCH_DIR||path.join(process.cwd(),'.data/wechat-collection-batches');
const file=(account:string,id:string)=>path.join(batchDirectory(),hash(account+'\n'+id)+'.json');
function save(target:string,record:BatchRecord){const temp=target+'.'+randomUUID()+'.tmp';try{const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(record));fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(temp,target);const d=fs.openSync(path.dirname(target),'r');try{fs.fsyncSync(d)}finally{fs.closeSync(d)}}finally{fs.rmSync(temp,{force:true})}}
export function parseCollectionBatch(raw:Record<string,unknown>):BatchInput{
 const account=String(raw.expectedAccount||''),requestId=String(raw.requestId||''),collectionId=String(raw.collectionId||'');
 if(!/^gh_[A-Za-z0-9]{12}$/.test(account))throw Error('wechat_collection_original_account_id_required');
 if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(requestId))throw Error('wechat_invalid_request_id');
 if(!/^[0-9]{1,30}$/.test(collectionId))throw Error('wechat_collection_invalid_id');
 if(!Array.isArray(raw.contentIds)||raw.contentIds.length<1||raw.contentIds.length>20||raw.contentIds.some(x=>typeof x!=='string'||! /^[0-9]{1,30}_[0-9]{1,4}$/.test(x)))throw Error('wechat_collection_content_ids_invalid');
 if(raw.dryRun!==undefined&&typeof raw.dryRun!=='boolean')throw Error('wechat_collection_dry_run_boolean_required');
 const dryRun=raw.dryRun!==false;if(!dryRun&&raw.confirmAdd!==true)throw Error('wechat_collection_confirmation_required');
 const maxPages=raw.maxPages===undefined?20:Number(raw.maxPages);if(!Number.isInteger(maxPages)||maxPages<1||maxPages>100)throw Error('wechat_collection_max_pages_invalid');
 const query=raw.query===undefined?'':raw.query;if(typeof query!=='string'||Array.from(query).length>200)throw Error('wechat_collection_query_invalid');
 return {account,requestId,collectionId,contentIds:Array.from(new Set(raw.contentIds as string[])),dryRun,maxPages,...query.trim()?{query:query.trim()}:{}};
}
export function readCollectionBatch(account:string,id:string):BatchRecord|null{
 let r:BatchRecord;try{r=JSON.parse(fs.readFileSync(file(account,id),'utf8'))}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw Error('wechat_collection_batch_ledger_unreadable')}
 if(r.input.account!==account||r.input.requestId!==id)throw Error('wechat_collection_batch_identity_mismatch');
 if(['queued','running','submitting'].includes(r.state)&&r.owner!==owner())return {...r,state:r.finalAttempted?'unknown':'failed',phase:'process_restarted',error:'wechat_collection_process_restarted'};
 return r;
}
export function reserveCollectionBatch(input:BatchInput){
 fs.mkdirSync(batchDirectory(),{recursive:true,mode:0o700});const target=file(input.account,input.requestId),fingerprint=hash(JSON.stringify(input));let lock:number;
 try{lock=fs.openSync(target+'.lock','wx',0o600)}catch{throw Error('wechat_collection_request_busy')}
 try{const old=readCollectionBatch(input.account,input.requestId);if(old){if(old.fingerprint!==fingerprint)throw Error('wechat_collection_request_conflict');
 if(old.state==='failed'&&!old.finalAttempted&&Date.now()-Date.parse(old.updatedAt)>=30000){const next:BatchRecord={...old,owner:owner(),state:'queued',phase:'queued',updatedAt:new Date().toISOString(),result:undefined,error:undefined,diagnostic:undefined,attempts:old.attempts+1};save(target,next);return {fresh:true,record:next}}
 return {fresh:false,record:old}}
 const record:BatchRecord={input,fingerprint,owner:owner(),state:'queued',phase:'queued',updatedAt:new Date().toISOString(),finalAttempted:false,attempts:1};save(target,record);return {fresh:true,record};
 }finally{fs.closeSync(lock);fs.rmSync(target+'.lock',{force:true})}
}
export function updateCollectionBatch(input:BatchInput,patch:Partial<BatchRecord>){
 const target=file(input.account,input.requestId),lock=fs.openSync(target+'.lock','wx',0o600);
 try{const r=readCollectionBatch(input.account,input.requestId);if(!r||r.owner!==owner()||!['queued','running','submitting'].includes(r.state))throw Error('wechat_collection_batch_not_active');
 const next:BatchRecord={...r,...patch,input:r.input,fingerprint:r.fingerprint,owner:r.owner,updatedAt:new Date().toISOString()};save(target,next);return next;
 }finally{fs.closeSync(lock);fs.rmSync(target+'.lock',{force:true})}
}
export function collectionBatchView(r:BatchRecord|null){return r?{found:true,requestId:r.input.requestId,expectedAccount:r.input.account,collectionId:r.input.collectionId,contentIds:r.input.contentIds,dryRun:r.input.dryRun,status:r.state,phase:r.phase,updatedAt:r.updatedAt,finalAttempted:r.finalAttempted,result:r.result||null,error:r.error||null,diagnostic:r.diagnostic||null,attempts:r.attempts,statusTool:'wechat_collection_request_status',retry:r.state==='failed'&&!r.finalAttempted?'Retry only this identical request after 30 seconds.':'Preserve requestId. Unknown/submitting results must be reconciled before any new mutation.'}:{found:false}}
