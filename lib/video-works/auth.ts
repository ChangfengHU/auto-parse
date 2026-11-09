import {createHmac,timingSafeEqual} from 'node:crypto';
import {authorizePlatformMcp} from '../workflow/platform-mcp-contract';
export type WorkScope='admin'|'douyin';
const COOKIE='__Host-video-work-session';
function equal(a:string,b:string){return Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b))}
const key=()=>process.env.AUTO_PARSE_ADMIN_TOKEN||'';
export function workBearerScope(req:Request):WorkScope|null{
 const token=req.headers.get('authorization')||'';
 if(key()&&equal(token,'Bearer '+key()))return 'admin';
 return authorizePlatformMcp(req,'douyin')===200?'douyin':null;
}
export function workScope(req:Request):WorkScope|null{
 const bearer=workBearerScope(req);if(bearer)return bearer;
 const cookie=(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
 if(!cookie||!key())return null;
 const [payload,signature,...rest]=cookie.split('.');if(rest.length||!payload||!signature)return null;
 if(!equal(signature,createHmac('sha256',key()).update('video-work-v1:'+payload).digest('base64url')))return null;
 try{const data=JSON.parse(Buffer.from(payload,'base64url').toString());return data.expires>Date.now()&&['admin','douyin'].includes(data.scope)?data.scope:null}catch{return null}
}
export function workSessionCookie(scope:WorkScope){
 if(!key())throw Error('video_work_auth_not_configured');
 const payload=Buffer.from(JSON.stringify({scope,expires:Date.now()+8*3600000})).toString('base64url');
 const signature=createHmac('sha256',key()).update('video-work-v1:'+payload).digest('base64url');
 return COOKIE+'='+payload+'.'+signature+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800';
}
export function workSameOrigin(req:Request){
 return ['https://auto-parse-v2.vyibc.com','https://auto-parse-65.vyibc.com','http://127.0.0.1:11007','http://127.0.0.1:11008'].includes(req.headers.get('origin')||'');
}
