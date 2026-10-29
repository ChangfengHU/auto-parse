import {createHash} from 'node:crypto';
import {ProxyAgent} from 'undici';

let cached:{uri:string;agent:ProxyAgent}|undefined;
function proxyUri(){
 const raw=process.env.WECHAT_HTTPS_PROXY?.trim();
 if(!raw)throw Error('wechat_proxy_not_configured');
 try{
  const url=new URL(raw);
  if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.pathname!=='/'||url.search||url.hash)throw Error();
  return url.href;
 }catch{throw Error('wechat_proxy_configuration_invalid');}
}
export function wechatTransportKey(){return createHash('sha256').update(proxyUri()).digest('hex');}
export function wechatNetworkInfo(){
 return {mode:'explicit_proxy',configured:Boolean(process.env.WECHAT_HTTPS_PROXY?.trim()),directFallback:false};
}
/** Per-request dispatcher only: do not change the process global dispatcher or other platforms. */
export async function wechatFetch(url:URL,init:RequestInit={}):Promise<Response>{
 const uri=proxyUri();
 if(cached?.uri!==uri){
  const previous=cached;
  try{cached={uri,agent:new ProxyAgent({uri,connectTimeout:10000})};}
  catch{throw Error('wechat_proxy_configuration_invalid');}
  if(previous)void previous.agent.close().catch(()=>{});
 }
 const options:RequestInit&{dispatcher:ProxyAgent}={...init,dispatcher:cached.agent};
 // Intentionally no retry/fallback to unproxied fetch.
 return fetch(url,options);
}
