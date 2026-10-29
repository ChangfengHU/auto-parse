const text = {type:'string',minLength:1};
const article = {type:'object',additionalProperties:false,properties:{
 title:text,author:{type:'string'},digest:{type:'string'},content:text,
 thumbMediaId:text,coverImageUrl:text,contentSourceUrl:{type:'string'},
 needOpenComment:{type:'boolean'},onlyFansCanComment:{type:'boolean'},
},required:['title','content']};
function tool(name:string,description:string,properties:Record<string,unknown>,required:string[],readOnly=true){
 return {name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},
 annotations:{readOnlyHint:readOnly,destructiveHint:false,idempotentHint:!readOnly,openWorldHint:true}};
}
export const WECHAT_DRAFT_TOOLS = [
 tool('wechat_capabilities','Describe the configured official account and draft-only limits. No credentials are returned.',{},[]),
 tool('wechat_account_status','Check official API access and draft count; reports IP whitelist/permission errors safely.',{},[]),
 tool('wechat_upload_image','Upload a JPEG/PNG from a trusted asset URL: cover returns permanent media_id; inline returns WeChat-hosted URL. Preserve requestId on retry.',{requestId:text,imageUrl:text,purpose:{type:'string',enum:['cover','inline']}},['requestId','imageUrl','purpose'],false),
 tool('wechat_create_draft','Create 1-8 articles in the official draft box only. Each article needs thumbMediaId OR coverImageUrl; trusted inline images are imported automatically. Preserves requestId and returns media_id; never publishes or mass-sends.',{requestId:text,confirmDraft:{type:'boolean',const:true},articles:{type:'array',maxItems:8,items:article}},['requestId','confirmDraft','articles'],false),
 tool('wechat_list_drafts','Read the official draft list without modifying it.',{offset:{type:'integer',minimum:0},count:{type:'integer',minimum:1,maximum:20},includeContent:{type:'boolean'}},[]),
 tool('wechat_get_draft','Read an exact official draft by media_id; this is draft evidence, not public publication.',{mediaId:text},['mediaId']),
 tool('wechat_draft_request_status','Read a restart-durable local request ledger. Unknown submissions must be reconciled, never resubmitted with another requestId.',{requestId:text},['requestId']),
];
