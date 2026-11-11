import fs from 'node:fs';
import {VIDEO_WORKS_TOOLS,authorizeVideoWorksMcp} from '@/lib/video-works/mcp-contract';
import {callVideoWorksTool} from '@/lib/video-works/service';
import {validToolArguments} from '@/lib/workflow/mcp-contract';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
export async function POST(req:Request){
 const auth=authorizeVideoWorksMcp(req);if(auth!==200)return Response.json({error:auth===503?'video_works_connection_not_configured':'unauthorized'},{status:auth,headers});
 if(!req.headers.get('content-type')?.includes('application/json'))return Response.json({error:'json_required'},{status:415,headers});
 if(Number(req.headers.get('content-length'))>1048576)return Response.json({error:'too_large'},{status:413,headers});
 const raw=await req.text();if(Buffer.byteLength(raw)>1048576)return Response.json({error:'too_large'},{status:413,headers});
 let m;try{m=JSON.parse(raw)}catch{return Response.json({error:'json_invalid'},{status:400,headers})}
 if(!m||typeof m!=='object'||Array.isArray(m))return Response.json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}},{status:400,headers});
 const error=(code:number,message:string)=>Response.json({jsonrpc:'2.0',id:m.id??null,error:{code,message}},{headers});
 if(m.jsonrpc!=='2.0'||typeof m.method!=='string')return error(-32600,'Invalid request');
 if(m.id===undefined)return new Response(null,{status:202,headers});
 let result:unknown;
 if(m.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'auto-parse-video-works',version:'0.3.0'},instructions:'Independent work registry, historic backfill, versioned per-channel/account title, body and cover, multi-channel filtering and native WeChat VIDEO DRAFT reuse. Never publicly publishes. Require work registration/draft authorization, preserve request IDs, read actual receipts; async source retention is not publication.'};
 else if(m.method==='tools/list')result={tools:VIDEO_WORKS_TOOLS};
 else if(m.method==='ping')result={};
 else if(m.method==='tools/call'){
  const name=m.params?.name,def=VIDEO_WORKS_TOOLS.find(t=>t.name===name),args=m.params?.arguments||{};
  if(!def||!validToolArguments(def.inputSchema,args))return error(-32602,'Invalid tool or arguments');
  try{
   let data;if(name==='get_version'){
    let meta:Record<string,unknown>={};try{meta=JSON.parse(fs.readFileSync(process.env.AUTO_PARSE_RELEASE_METADATA||'','utf8'))}catch{}
    data={server:'auto-parse-video-works',version:'0.3.0',server_version:'0.3.0',deploy_id:meta.deploy_id||null,git_commit:meta.git_commit||null,deployed_at:meta.deployed_at||null,changelog_zh:'新增侧边栏平台分发、抖音独立网页发布授权与统一完整参数；旧草稿/编辑授权不扩权，已投递快照不覆盖。'};
   }else data=await callVideoWorksTool(name,args);
   result={content:[{type:'text',text:JSON.stringify(data)}],isError:false};
  }catch(e){result={isError:true,content:[{type:'text',text:JSON.stringify({error:e instanceof Error&&/^[a-z0-9_]+$/.test(e.message)?e.message:'video_work_operation_failed',hint:'查询原作品和原草稿请求；未知保存不要更换请求号重提。'})}]}}
 }else return error(-32601,'Method not found');
 return Response.json({jsonrpc:'2.0',id:m.id,result},{headers});
}
export async function GET(req:Request){const status=authorizeVideoWorksMcp(req);return new Response(null,{status:status===200?405:status,headers:{...headers,Allow:'POST'}})}
