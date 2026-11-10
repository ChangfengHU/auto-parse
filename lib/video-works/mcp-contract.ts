import fs from 'node:fs';
import {timingSafeEqual} from 'node:crypto';
const string={type:'string',minLength:1},id={type:'string',pattern:'^[a-f0-9]{64}$'};
const tool=(name:string,description:string,properties:Record<string,unknown>,required:string[],readOnly=true)=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,openWorldHint:true}});
const registration={sourceUrl:string,title:{type:'string',minLength:1,maxLength:500},description:{type:'string',maxLength:20000},topics:{type:'array',maxItems:20,items:string},aiGenerated:{type:'boolean'},origin:{type:'string',enum:['generated','historical','material']},platformUrl:string,confirmRecord:{type:'boolean',const:true}};
export const VIDEO_WORKS_TOOLS=[
 tool('create_web_access','Create a one-use private operator sign-in link, valid for 10 minutes. After sign-in, the owner can save existing video works as native WeChat drafts for up to 8 hours. No public publishing or admin/platform credentials. Share only with the authorized owner; never log or publish the link.',{confirmWebAccess:{type:'boolean',const:true}},['confirmWebAccess'],false),
 tool('get_version','Read independent video works MCP version and release metadata.',{},[]),
 tool('list_video_works','Search works across platforms, including unpublished registered works. No publication.',{query:{type:'string',maxLength:300},platform:{type:'string',enum:['douyin','wechat','xiaohongshu','x','channels']},state:{type:'string',enum:['registered','reserved','running','prepared','draft_saved','published','failed','unknown']},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},[]),
 tool('get_video_work','Read master metadata, original retention progress and per-platform receipts. Registration is not publication.',{workId:id},['workId']),
 tool('register_video_work','Register an existing owned-CDN MP4 independently of platform publishing. Captures master metadata, asynchronously retains original bytes; poll get_video_work. Replays reuse source URL; no public post or platform draft.',registration,['sourceUrl','title','aiGenerated','confirmRecord'],false),
 tool('backfill_video_work','Backfill one historic video from a retained AutoParse taskId or existing sourceUrl+metadata. Never republishes. A supplied platformUrl is reported evidence only, not verified publication.',{...registration,taskId:string},['confirmRecord'],false),
 tool('prepare_wechat_video_draft','Resolve stored video, existing verified default account and native video draft metadata. Read only. Agent adapts title<=20 and description<=300 when needed; user need not resupply source or account.',{workId:id,expectedAccount:string,title:string,description:{type:'string'}},['workId']),
 tool('create_wechat_video_draft','Save a native WeChat VIDEO DRAFT from workId and existing metadata. Optional agent-adapted title/description. Deterministic requestId prevents duplicate saves; polls get_wechat_video_drafts. Original retained, <=100MiB H264/AAC required. NEVER publishes publicly.',{workId:id,expectedAccount:string,title:string,description:{type:'string'},confirmDraft:{type:'boolean',const:true}},['workId','confirmDraft'],false),
 tool('get_wechat_video_drafts','Read and refresh existing native draft receipts for a work. completed means actual save response plus native editor reload, not public publication. No retry or new draft.',{workId:id,expectedAccount:string},['workId'])
];
export function authorizeVideoWorksMcp(req:Request,env:Record<string,string|undefined>=process.env){
 let expected=env.VIDEO_WORKS_MCP_TOKEN||'';if(!expected&&env.VIDEO_WORKS_MCP_TOKEN_FILE){try{expected=fs.readFileSync(env.VIDEO_WORKS_MCP_TOKEN_FILE,'utf8').trim()}catch{return 503}}if(!expected)return 503;
 const origin=req.headers.get('origin');if(origin&&!['https://auto-parse-v2.vyibc.com','https://auto-parse-65.vyibc.com','http://127.0.0.1:11007'].includes(origin))return 403;
 const actual=req.headers.get('authorization')||'',target='Bearer '+expected;
 return Buffer.byteLength(actual)===Buffer.byteLength(target)&&timingSafeEqual(Buffer.from(actual),Buffer.from(target))?200:401;
}
