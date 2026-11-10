import fs from 'node:fs';
import {workScope} from '@/lib/video-works/auth';
import {getVideoWork,videoPosterPath} from '@/lib/video-works/store';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req:Request,ctx:{params:Promise<{id:string}>}){
 const scope=workScope(req)||'viewer';
 const {id}=await ctx.params;if(!/^[a-f0-9]{64}$/.test(id))return new Response(null,{status:404});
 const work=getVideoWork(id,scope==='douyin'?'douyin':undefined);if(!work?.archive)return new Response(null,{status:404});
 try{return new Response(fs.readFileSync(videoPosterPath(work.archive.sha256)),{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})}catch{return new Response(null,{status:404})}
}
