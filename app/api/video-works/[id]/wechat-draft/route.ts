import {workScope,workSameOrigin} from '@/lib/video-works/auth';
import {prepareWorkWechatDraft,createWorkWechatDraft,getWorkWechatDrafts} from '@/lib/video-works/service';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
type Context={params:Promise<{id:string}>};
function allowed(req:Request){const scope=workScope(req);return scope==='admin'||scope==='works'||scope==='works_editor'||scope==='works_publisher'}
function failure(e:unknown){const error=e instanceof Error&&/^[a-z0-9_]+$/.test(e.message)?e.message:'video_work_operation_failed';return Response.json({error},{status:error==='video_work_not_found'?404:409,headers})}
export async function GET(req:Request,ctx:Context){
 if(!allowed(req))return Response.json({error:'video_work_web_signin_required'},{status:401,headers});
 try{const {id}=await ctx.params;const plan=prepareWorkWechatDraft({workId:id}),drafts=await getWorkWechatDrafts({workId:id});return Response.json({plan,drafts},{headers})}catch(e){return failure(e)}
}
export async function POST(req:Request,ctx:Context){
 if(!allowed(req))return Response.json({error:'video_work_web_signin_required'},{status:401,headers});
 if(!workSameOrigin(req))return Response.json({error:'origin_not_allowed'},{status:403,headers});
 if(!req.headers.get('content-type')?.includes('application/json'))return Response.json({error:'json_required'},{status:415,headers});
 try{
  if(Number(req.headers.get('content-length'))>20000)throw Error('request_too_large');const raw=await req.text();if(Buffer.byteLength(raw)>20000)throw Error('request_too_large');
  const p=JSON.parse(raw);if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['confirmDraft','title','description'].includes(k))||p.confirmDraft!==true||(p.title!==undefined&&typeof p.title!=='string')||(p.description!==undefined&&typeof p.description!=='string'))throw Error('video_work_draft_input_invalid');
  const {id}=await ctx.params;const result=await createWorkWechatDraft({workId:id,confirmDraft:true,...p.title!==undefined?{title:p.title}:{},...p.description!==undefined?{description:p.description}:{}});
  return Response.json(result,{headers});
 }catch(e){return failure(e)}
}
