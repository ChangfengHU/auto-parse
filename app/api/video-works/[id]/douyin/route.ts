import {getVideoWork} from '@/lib/video-works/store';
import {workScope,workSameOrigin} from '@/lib/video-works/auth';
import {douyinPlan,getWorkDouyinStatus,executeWorkDouyin} from '@/lib/video-works/distribution';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};type Context={params:Promise<{id:string}>};
function work(id:string,req:Request){const w=getVideoWork(id,workScope(req)==='douyin'?'douyin':undefined);if(!w)throw Error('video_work_not_found');return w}
function fail(e:unknown){const error=e instanceof Error&&/^[a-z0-9_]+$/.test(e.message)?e.message:'publication_operation_failed';return Response.json({error},{status:error==='video_work_not_found'?404:409,headers})}
export async function GET(req:Request,ctx:Context){
 try{const {id}=await ctx.params,w=work(id,req),accountId=new URL(req.url).searchParams.get('accountId')||undefined,scope=workScope(req);
 const plan=douyinPlan(w,accountId);return Response.json({plan,canOperate:['admin','douyin','works_publisher'].includes(scope||''),operation:await getWorkDouyinStatus(w,plan.accountId||undefined)},{headers})}catch(e){return fail(e)}
}
export async function POST(req:Request,ctx:Context){
 const scope=workScope(req);if(!['admin','douyin','works_publisher'].includes(scope||''))return Response.json({error:'publication_web_access_required'},{status:401,headers});
 if(!workSameOrigin(req))return Response.json({error:'origin_not_allowed'},{status:403,headers});
 if(!req.headers.get('content-type')?.includes('application/json'))return Response.json({error:'json_required'},{status:415,headers});
 try{const raw=await req.text();if(Buffer.byteLength(raw)>20000)throw Error('request_too_large');const p=JSON.parse(raw);
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['action','mode','accountId','title','description','topics','cover','aiGenerated','confirmPrepare','confirmPublish'].includes(k)))throw Error('publication_input_invalid');
 const {id}=await ctx.params;return Response.json(await executeWorkDouyin(work(id,req),p,scope==='works_publisher'),{headers});
 }catch(e){return fail(e)}
}
