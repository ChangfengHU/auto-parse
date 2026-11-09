import {workBearerScope,workSameOrigin,workSessionCookie} from '@/lib/video-works/auth';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(req:Request){
 if(!workSameOrigin(req))return Response.json({error:'origin_not_allowed'},{status:403});
 const raw=await req.text();if(raw.length>4096)return Response.json({error:'invalid_credentials'},{status:400});
 let token='';try{token=String(JSON.parse(raw).token||'')}catch{}
 const scope=workBearerScope(new Request(req.url,{headers:{authorization:'Bearer '+token,origin:req.headers.get('origin')||''}}));token='';
 if(!scope)return Response.json({error:'凭据不正确；仅接受本服务既有管理员或抖音MCP凭据'},{status:401,headers:{'Cache-Control':'no-store'}});
 return Response.json({ok:true,scope},{headers:{'Set-Cookie':workSessionCookie(scope),'Cache-Control':'no-store'}});
}
