import {workBearerScope,workSameOrigin,workSessionCookie} from '@/lib/video-works/auth';
import {consumeVideoWorksWebAccess,clearVideoWorksWebCookie,videoWorksWebScope} from '@/lib/video-works/web-access';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(req:Request){
 if(!workSameOrigin(req))return Response.json({error:'origin_not_allowed'},{status:403});
 const raw=await req.text();if(raw.length>4096)return Response.json({error:'invalid_credentials'},{status:400});
 let parsed:Record<string,unknown>;try{parsed=JSON.parse(raw)}catch{return Response.json({error:'request_invalid'},{status:400})}
 if(parsed&&typeof parsed==='object'&&Object.keys(parsed).length===1&&parsed.code!==undefined){
  try{const cookie=consumeVideoWorksWebAccess(parsed.code);const scope=videoWorksWebScope(new Request(req.url,{headers:{cookie:cookie.split(';')[0]}}));return Response.json({ok:true,scope},{headers:{'Set-Cookie':cookie,'Cache-Control':'no-store'}})}catch{return Response.json({error:'操作入口已使用或过期，请通过MCP重新获取'},{status:401,headers:{'Cache-Control':'no-store'}})}
 }
 let token=String(parsed?.token||'');
 const scope=workBearerScope(new Request(req.url,{headers:{authorization:'Bearer '+token,origin:req.headers.get('origin')||''}}));token='';
 if(!scope)return Response.json({error:'凭据不正确；仅接受本服务既有管理员或抖音MCP凭据'},{status:401,headers:{'Cache-Control':'no-store'}});
 return Response.json({ok:true,scope},{headers:{'Set-Cookie':workSessionCookie(scope),'Cache-Control':'no-store'}});
}

export async function DELETE(req:Request){if(!workSameOrigin(req))return Response.json({error:'origin_not_allowed'},{status:403});return Response.json({ok:true},{headers:{'Set-Cookie':clearVideoWorksWebCookie(),'Cache-Control':'no-store'}})}
