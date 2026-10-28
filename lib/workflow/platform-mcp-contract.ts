import {createHmac,timingSafeEqual} from 'node:crypto';
import {WORKFLOW_MCP_TOOLS,workflowMcpToken} from './mcp-contract';
export const PLATFORMS=['douyin','xiaohongshu','x'] as const;
export type PublicationPlatform=typeof PLATFORMS[number];
export function isPublicationPlatform(value:string):value is PublicationPlatform{return (PLATFORMS as readonly string[]).includes(value);}
export const PLATFORM_WORKFLOWS:Record<PublicationPlatform,Record<string,number>>={
 douyin:{'53197d8e-a89d-4d1a-bb8d-fc114156f30f':2},
 xiaohongshu:{'6105efc6-7e54-4c85-acfe-1a37e0d5093f':1,'1dc07adf-65a1-48f0-98ab-31cfcafc7fd3':1},
 x:{'e3d8f5e6-d859-4424-b6b6-a85c9aefb551':2,'8b626a95-e939-4fa0-a685-7aff71cb76dd':2},
};
export function platformMcpToken(platform:PublicationPlatform,env:Record<string,string|undefined>=process.env){
 const override=env['PUBLISH_'+platform.toUpperCase()+'_MCP_TOKEN'];
 if(override)return override;
 const root=workflowMcpToken(env);
 return root?'pubmcp_'+platform+'_'+createHmac('sha256',root).update('auto-parse-publication:'+platform+':v1').digest('hex'):'';
}
export function authorizePlatformMcp(req:Request,platform:PublicationPlatform,env:Record<string,string|undefined>=process.env){
 const origin=req.headers.get('origin');
 if(origin&&!['https://auto-parse-v2.vyibc.com','https://auto-parse-65.vyibc.com','http://127.0.0.1:11007','http://127.0.0.1:11008'].includes(origin))return 403;
 const expected=platformMcpToken(platform,env);if(!expected)return 503;
 const actual=req.headers.get('authorization')||'',target='Bearer '+expected;
 return Buffer.byteLength(actual)===Buffer.byteLength(target)&&timingSafeEqual(Buffer.from(actual),Buffer.from(target))?200:401;
}
const shared=new Set(['workflow_capabilities','workflow_list','workflow_get','workflow_open_session','workflow_run_step','workflow_run','workflow_get_session','workflow_stop','workflow_close_session']);
const string={type:'string',minLength:1};
const video={accountId:string,videoUrl:string,title:string,description:{type:'string'},topics:{type:'array',maxItems:5,items:string},aiGenerated:{type:'boolean'},requestId:string,cover:{type:'object',properties:{verticalUrl:string,horizontalUrl:string},additionalProperties:false}};
const tool=(name:string,description:string,properties:Record<string,unknown>,required:string[],readOnly=false)=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,openWorldHint:true}});
export function platformMcpTools(platform:PublicationPlatform){
 const tools=WORKFLOW_MCP_TOOLS.filter(t=>shared.has(t.name)||(platform==='x'&&t.name==='x_publication_status')).map(t=>({...t,description:'['+platform+' publication only] '+t.description}));
 if(platform==='douyin')tools.push(
  tool('prepare_video','Prepare a Douyin video through the approved workflow without publishing. Account control/upload requires user authorization.',video,['accountId','videoUrl','title','aiGenerated','requestId']),
  tool('publish_video','Publish a user-authorized Douyin video once through the approved workflow; preserve requestId and reconcile unknown results.',{...video,confirmPublish:{type:'boolean',const:true}},['accountId','videoUrl','title','aiGenerated','requestId','confirmPublish']),
  tool('get_video_task','Read a durable Douyin publication task only; creation evidence is not moderation approval.',{taskId:string},['taskId'],true),
  tool('reconcile_video_task','Reconcile an uncertain Douyin task using an exact known work ID. Does not upload or republish.',{taskId:string,awemeId:string},['taskId','awemeId'])
 );
 return tools;
}
