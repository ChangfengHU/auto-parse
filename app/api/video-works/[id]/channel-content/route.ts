import {workScope,workSameOrigin} from '@/lib/video-works/auth';
import {getVideoWork} from '@/lib/video-works/store';
import {readChannelContent,saveChannelContent} from '@/lib/video-works/channel-content';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
type Context={params:Promise<{id:string}>};
function work(id:string,req:Request){const w=getVideoWork(id,workScope(req)==='douyin'?'douyin':undefined);if(!w)throw Error('video_work_not_found');return w}
function failure(e:unknown){const error=e instanceof Error&&/^[a-z0-9_]+$/.test(e.message)?e.message:'channel_content_failed';return Response.json({error},{status:error==='video_work_not_found'?404:409,headers})}
export async function GET(req:Request,ctx:Context){try{const {id}=await ctx.params,p=new URL(req.url).searchParams,platform=p.get('platform')||'douyin';if(workScope(req)==='douyin'&&platform!=='douyin')return Response.json({error:'channel_scope_forbidden'},{status:403,headers});const scope=workScope(req);return Response.json({...readChannelContent(work(id,req),{platform,...p.get('accountId')?{accountId:p.get('accountId')}:{}}),canEdit:scope==='admin'||scope==='works_editor'||scope==='works_publisher'},{headers})}catch(e){return failure(e)}}
export async function POST(req:Request,ctx:Context){
 const scope=workScope(req);if(scope!=='admin'&&scope!=='works_editor'&&scope!=='works_publisher')return Response.json({error:'channel_editor_signin_required'},{status:401,headers});
 if(!workSameOrigin(req))return Response.json({error:'origin_not_allowed'},{status:403,headers});
 if(!req.headers.get('content-type')?.includes('application/json'))return Response.json({error:'json_required'},{status:415,headers});
 try{if(Number(req.headers.get('content-length'))>100000)throw Error('request_too_large');const raw=await req.text();if(Buffer.byteLength(raw)>100000)throw Error('request_too_large');const input=JSON.parse(raw);
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['platform','accountId','title','description','topics','cover','expectedRevision','requestId','confirmSave'].includes(k)))throw Error('channel_content_invalid');
 const {id}=await ctx.params;return Response.json(saveChannelContent(work(id,req),input),{headers});
 }catch(e){return failure(e)}
}
