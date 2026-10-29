import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,openSync,writeFileSync,readFileSync,closeSync,renameSync,fsyncSync,unlinkSync} from 'node:fs';
import path from 'node:path';

type State = 'submitting' | 'submitted' | 'unknown';
export type WebPublicationRecord = {account:string;mediaIdHash:string;requestId:string;state:State;updatedAt:string;receipt?:Record<string,unknown>};
function key(account:string,mediaId:string) {
 if (!/^gh_[a-zA-Z0-9]{12}$/.test(account)) throw Error('wechat_web_invalid_account');
 if (!mediaId || mediaId.length>256) throw Error('wechat_web_invalid_media_id');
 return createHash('sha256').update(account+'\0'+mediaId).digest('hex');
}
function recordPath(root:string,account:string,mediaId:string) {
 mkdirSync(root,{recursive:true,mode:0o700});return path.join(root,key(account,mediaId)+'.json');
}
function syncDir(root:string) { const fd=openSync(root,'r'); try{fsyncSync(fd);}finally{closeSync(fd);} }
function validRequestId(id:string) {return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(id);}
export function readWebPublication(root:string,account:string,mediaId:string):WebPublicationRecord|undefined {
 try{return JSON.parse(readFileSync(recordPath(root,account,mediaId),'utf8')) as WebPublicationRecord;}
 catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw Error('wechat_web_ledger_unreadable');}
}
/** Atomic create prevents duplicate clicks across processes and across changed request IDs. */
export function reserveWebPublication(root:string,account:string,mediaId:string,requestId:string):WebPublicationRecord {
 if(!validRequestId(requestId))throw Error('wechat_web_invalid_request_id');
 const file=recordPath(root,account,mediaId), record:WebPublicationRecord={account,mediaIdHash:createHash('sha256').update(mediaId).digest('hex'),requestId,state:'submitting',updatedAt:new Date().toISOString()};
 let fd:number;
 try{fd=openSync(file,'wx',0o600);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw Error('wechat_web_existing_publication_check_status');throw Error('wechat_web_ledger_write_failed');}
 try{writeFileSync(fd,JSON.stringify(record));fsyncSync(fd);}finally{closeSync(fd);}
 syncDir(root);return record;
}
/** Only the owner of the original reservation may update its outcome. */
export function finishWebPublication(root:string,account:string,mediaId:string,requestId:string,state:'submitted'|'unknown',receipt?:Record<string,unknown>) {
 const file=recordPath(root,account,mediaId),lock=file+'.finish.lock';let lockFd:number;
 try{lockFd=openSync(lock,'wx',0o600);}catch{throw Error('wechat_web_ledger_finish_busy_or_interrupted');}
 try {
  const old=readWebPublication(root,account,mediaId);
  if(!old||old.requestId!==requestId||old.state!=='submitting')throw Error('wechat_web_ledger_state_mismatch');
  if(state==='submitted'&&(!receipt||Object.keys(receipt).length===0))throw Error('wechat_web_receipt_required');
  const next:WebPublicationRecord={...old,state,updatedAt:new Date().toISOString(),...(receipt?{receipt}:{})};
  const temp=file+'.'+randomUUID()+'.tmp',fd=openSync(temp,'wx',0o600);
  try{writeFileSync(fd,JSON.stringify(next));fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(temp,file);syncDir(root);return next;
 } finally {closeSync(lockFd);unlinkSync(lock);}
}
