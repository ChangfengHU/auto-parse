import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {workScope} from '@/lib/video-works/auth';
import {getVideoWork,videoFileDirectory} from '@/lib/video-works/store';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(req:Request,ctx:{params:Promise<{id:string}>}){
 const scope=workScope(req)||'viewer';
 const {id}=await ctx.params;
 if(!/^[a-f0-9]{64}$/.test(id))return new Response(null,{status:404});
 const work=getVideoWork(id,scope==='douyin'?'douyin':undefined);
 if(!work?.archive)return new Response(null,{status:404});
 const file=path.join(videoFileDirectory(),work.archive.sha256+'.mp4');
 let size:number;try{size=fs.statSync(file).size}catch{return new Response(null,{status:404})}
 const range=req.headers.get('range');let start=0,end=size-1,status=200;
 if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}});
 if(m[1]){start=Number(m[1]);end=m[2]?Number(m[2]):end}else{start=Math.max(0,size-Number(m[2]))}
 end=Math.min(end,size-1);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}});status=206;}
 const headers:Record<string,string>={'Content-Type':'video/mp4','Content-Length':String(end-start+1),'Accept-Ranges':'bytes','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline; filename="'+work.archive.sha256+'.mp4"'};
 if(status===206)headers['Content-Range']='bytes '+start+'-'+end+'/'+size;
 return new Response(Readable.toWeb(fs.createReadStream(file,{start,end})) as ReadableStream<Uint8Array>,{status,headers});
}
