import fs from 'node:fs';
import path from 'node:path';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
const cookieName='__Host-video-work-operator';
const directory=()=>path.join(process.env.VIDEO_WORKS_DATA_DIR||path.join(process.cwd(),'.data','video-work-center'),'web-access');
function key(){let value=process.env.VIDEO_WORKS_MCP_TOKEN||'';if(!value&&process.env.VIDEO_WORKS_MCP_TOKEN_FILE)value=fs.readFileSync(process.env.VIDEO_WORKS_MCP_TOKEN_FILE,'utf8').trim();if(!value)throw Error('video_works_connection_not_configured');return value}
function equal(a:string,b:string){return Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b))}
function signature(value:string){return createHmac('sha256',key()).update('video-work-web-draft-v1:'+value).digest('base64url')}
export function issueVideoWorksWebAccess(input:Record<string,unknown>){
 if(input.confirmWebAccess!==true)throw Error('video_work_web_access_confirmation_required');
 key();const code=randomBytes(32).toString('base64url'),expires=Date.now()+10*60000,sessionExpires=Date.now()+8*3600000;
 fs.mkdirSync(directory(),{recursive:true,mode:0o700});
 fs.writeFileSync(path.join(directory(),createHash('sha256').update(code).digest('hex')+'.json'),JSON.stringify({expires,sessionExpires,purpose:input.includeContentEditing===true?'channel_content_and_wechat_draft':'wechat_video_draft_only'}),{flag:'wx',mode:0o600});
 return {url:'https://auto-parse-v2.vyibc.com/video-works#access='+code,expiresAt:new Date(expires).toISOString(),sessionExpiresAt:new Date(sessionExpires).toISOString(),scope:input.includeContentEditing===true?'existing_works_content_and_wechat_drafts':'existing_video_works_wechat_draft_only',oneUse:true,instructions:'Private operator sign-in link for the authorized owner only. Do not publish or log this URL. '+(input.includeContentEditing===true?'Enables editing stored channel content and saving WeChat drafts. ':'Enables saving WeChat drafts only. ')+'Never public publication; grants no platform/MCP/admin credential.'};
}
export function consumeVideoWorksWebAccess(code:unknown){
 if(typeof code!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(code))throw Error('video_work_web_access_invalid_or_expired');
 const file=path.join(directory(),createHash('sha256').update(code).digest('hex')+'.json'),used=file+'.used';
 try{fs.renameSync(file,used)}catch{throw Error('video_work_web_access_invalid_or_expired')}
 try{
  const record=JSON.parse(fs.readFileSync(used,'utf8'));
  if(record.expires<=Date.now()||record.sessionExpires<=Date.now()||!['wechat_video_draft_only','channel_content_and_wechat_draft'].includes(record.purpose))throw Error('video_work_web_access_invalid_or_expired');
  const payload=Buffer.from(JSON.stringify({scope:record.purpose==='channel_content_and_wechat_draft'?'works_editor':'works',expires:record.sessionExpires,nonce:randomBytes(16).toString('hex')})).toString('base64url');
  return cookieName+'='+payload+'.'+signature(payload)+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age='+Math.floor((record.sessionExpires-Date.now())/1000);
 }finally{fs.rmSync(used,{force:true})}
}
export function videoWorksWebScope(req:Request):'works'|'works_editor'|null{
 const value=(req.headers.get('cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 if(!value)return null;const [payload,sig,...rest]=value.split('.');if(rest.length||!payload||!sig)return null;
 try{if(!equal(sig,signature(payload)))return null;const body=JSON.parse(Buffer.from(payload,'base64url').toString());return ['works','works_editor'].includes(body.scope)&&Number.isSafeInteger(body.expires)&&body.expires>Date.now()&&body.expires<=Date.now()+8*3600000?body.scope:null}catch{return null}
}
export function clearVideoWorksWebCookie(){return cookieName+'=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'}
