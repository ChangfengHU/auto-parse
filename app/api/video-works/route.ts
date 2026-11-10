import {listVideoWorks,getVideoWork} from '@/lib/video-works/store';
import {workScope,workSameOrigin} from '@/lib/video-works/auth';
import {callPlatformTool} from '@/lib/workflow/platform-mcp-service';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(req:Request){
 const scope=workScope(req)||'viewer';
 try{const p=new URL(req.url).searchParams;
 const state=p.get('state');if(state&&!['registered','reserved','running','prepared','draft_saved','published','failed','unknown'].includes(state))return Response.json({error:'state_invalid'},{status:400,headers});
 const offset=Number(p.get('offset')||0);if(!Number.isSafeInteger(offset)||offset<0)return Response.json({error:'offset_invalid'},{status:400,headers});
 const result=listVideoWorks({state:state as NonNullable<Parameters<typeof listVideoWorks>[0]>['state']||undefined,platform:scope==='douyin'?'douyin':(p.get('platform')||undefined),q:(p.get('q')||'').slice(0,300),offset,limit:20});
 return Response.json({...result,scope},{headers});}catch{return Response.json({error:'作品档案读取失败，未把错误当作空列表'},{status:500,headers})}
}
export async function POST(req:Request){
 const scope=workScope(req);if(!scope)return Response.json({error:'unauthorized'},{status:401,headers});
 if(!workSameOrigin(req))return Response.json({error:'origin_not_allowed'},{status:403,headers});
 if(Number(req.headers.get('content-length'))>20000)return Response.json({error:'request_too_large'},{status:413,headers});
 try{
  const text=await req.text();if(text.length>20000)throw Error('request_too_large');const p=JSON.parse(text);
  if(p.action!=='prepare'||p.confirmPrepare!==true)throw Error('video_work_prepare_confirmation_required');
  const work=getVideoWork(String(p.workId),scope==='admin'?undefined:'douyin');if(!work)throw Error('video_work_not_found');
  if(!['douyin','wechat'].includes(p.platform))throw Error('video_work_platform_not_supported');
  if(p.platform!=='douyin'&&scope!=='admin')return Response.json({error:'此操作需要AutoParse管理员权限，抖音凭据不能操作公众号'},{status:403,headers});
  const last=work.deliveries[0]?.input||{title:work.title,description:work.description||'',topics:work.topics||[],aiGenerated:work.aiGenerated||false};
  const title=typeof p.title==='string'?p.title:last.title,description=typeof p.description==='string'?p.description:last.description;
  const result=await callPlatformTool(p.platform,p.platform==='wechat'?'wechat_create_video_draft':'prepare_video',p.platform==='wechat'?{
   expectedAccount:p.accountId,requestId:p.requestId,title,description,videoUrl:work.sourceUrl,confirmDraft:true
  }:{accountId:p.accountId,requestId:p.requestId,title,description,topics:Array.isArray(p.topics)?p.topics:last.topics,videoUrl:work.sourceUrl,aiGenerated:typeof p.aiGenerated==='boolean'?p.aiGenerated:last.aiGenerated});
  return Response.json(result,{headers});
 }catch(e){return Response.json({error:e instanceof Error&&/^[a-z0-9_]+$/.test(e.message)?e.message:'准备失败，请保留原请求号查询，不要重复提交'},{status:409,headers})}
}
