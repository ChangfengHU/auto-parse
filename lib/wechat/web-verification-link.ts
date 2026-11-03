import {createHash,randomBytes} from 'node:crypto';
import {getSession} from '../workflow/session-store';

type Grant = {sessionId:string;expiresAt:number};
declare global { var __wechatVerificationGrants: Map<string,Grant>|undefined }
const grants=()=>global.__wechatVerificationGrants??=new Map<string,Grant>();
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const TTL_MS=10*60*1000;

/** Called only after the authenticated MCP creates or checks its owned session. */
export function issueWechatVerificationLink(sessionId:string) {
 const now=Date.now();
 for(const [key,value] of grants())if(value.expiresAt<=now||!getSession(value.sessionId))grants().delete(key);
 const token=randomBytes(32).toString('base64url');
 const expiresAt=now+TTL_MS;
 grants().set(digest(token),{sessionId,expiresAt});
 return {url:'https://auto-parse-v2.vyibc.com/api/publish/wechat-verification#'+token,expiresAt:new Date(expiresAt).toISOString()};
}
export function resolveWechatVerificationGrant(token:string) {
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))return undefined;
 const key=digest(token),grant=grants().get(key);
 if(!grant)return undefined;
 if(grant.expiresAt<=Date.now()){grants().delete(key);return undefined}
 const session=getSession(grant.sessionId);
 if(!session||session.workflowId!=='cea6d731-ce15-46d8-95fb-f420ebfacb93'||!session._managedByMcp||!session._page||session._page.isClosed()){
  grants().delete(key);return undefined;
 }
 return session;
}
