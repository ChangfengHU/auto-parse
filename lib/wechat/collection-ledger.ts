import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,openSync,readFileSync,writeFileSync,closeSync,fsyncSync,renameSync} from 'node:fs';
import path from 'node:path';
export type CollectionIntent={account:string;requestId:string;fingerprint:string;state:'submitting'|'created'|'unknown';updatedAt:string;result?:Record<string,unknown>};
function filename(root:string,account:string,id:string){
 if(!/^gh_[a-zA-Z0-9]{12}$/.test(account))throw Error('wechat_web_invalid_account');
 if(!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(id))throw Error('wechat_invalid_request_id');
 mkdirSync(root,{recursive:true,mode:0o700});return path.join(root,createHash('sha256').update(account+String.fromCharCode(0)+id).digest('hex')+'.json');
}
function syncDir(root:string){const fd=openSync(root,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
export function readCollectionIntent(root:string,account:string,id:string):CollectionIntent|undefined{
 const file=filename(root,account,id);
 try{return JSON.parse(readFileSync(file,'utf8')) as CollectionIntent;}
 catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw Error('wechat_collection_ledger_unreadable');}
}
export function reserveCollectionIntent(root:string,account:string,id:string,input:Record<string,unknown>):CollectionIntent{
 const file=filename(root,account,id),fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 const old=readCollectionIntent(root,account,id);if(old){if(old.fingerprint!==fingerprint)throw Error('wechat_collection_request_conflict');return old;}
 const record:CollectionIntent={account,requestId:id,fingerprint,state:'submitting',updatedAt:new Date().toISOString()};
 let fd:number;try{fd=openSync(file,'wx',0o600);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw Error('wechat_collection_request_in_progress');throw Error('wechat_collection_ledger_write_failed');}
 try{writeFileSync(fd,JSON.stringify(record));fsyncSync(fd);}finally{closeSync(fd);}syncDir(root);return record;
}
export function finishCollectionIntent(root:string,account:string,id:string,state:'created'|'unknown',result?:Record<string,unknown>){
 const old=readCollectionIntent(root,account,id);if(!old||old.state!=='submitting')throw Error('wechat_collection_ledger_state_mismatch');
 const file=filename(root,account,id),temp=file+'.'+randomUUID()+'.tmp',next={...old,state,updatedAt:new Date().toISOString(),...(result?{result}:{})};
 const fd=openSync(temp,'wx',0o600);try{writeFileSync(fd,JSON.stringify(next));fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,file);syncDir(root);return next;
}
