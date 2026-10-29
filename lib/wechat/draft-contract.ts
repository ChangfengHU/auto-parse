const text = {type:'string',minLength:1};
const image = {type:'object',additionalProperties:false,properties:{imageMediaId:text,imageUrl:text}};
const article = {type:'object',additionalProperties:false,properties:{
 articleType:{type:'string',enum:['news','newspic']},liveCoverVideoUrl:text,images:{type:'array',minItems:1,maxItems:20,items:image},
 title:text,author:{type:'string'},digest:{type:'string'},content:text,
 thumbMediaId:text,coverImageUrl:text,contentSourceUrl:{type:'string'},
 needOpenComment:{type:'boolean'},onlyFansCanComment:{type:'boolean'},
},required:['title','content']};
function tool(name:string,description:string,properties:Record<string,unknown>,required:string[],readOnly=true){
 return {name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},
 annotations:{readOnlyHint:readOnly,destructiveHint:name==='wechat_delete_draft'||name==='wechat_publish_draft',idempotentHint:!readOnly,openWorldHint:true}};
}
export const WECHAT_DRAFT_TOOLS = [
 tool('wechat_capabilities','Describe configured account and limits. includeEgress performs an optional proxy egress probe; destination-specific routing can differ.',{includeEgress:{type:'boolean'}},[]),
 tool('wechat_account_status','Check official API access and draft count; reports IP whitelist/permission errors safely.',{},[]),
 tool('wechat_upload_image','Upload JPEG/PNG/GIF as permanent media; inline JPEG/PNG only. cover/newspic returns a permanent media_id (10 MiB max); inline returns a WeChat URL (1 MiB max). Preserve requestId on retry.',{requestId:text,imageUrl:text,purpose:{type:'string',enum:['cover','inline','newspic']}},['requestId','imageUrl','purpose'],false),
 tool('wechat_create_draft','Create 1-8 official drafts: articleType=news (default) needs thumbMediaId OR coverImageUrl; articleType=newspic creates a native image-message draft with 1-20 ordered images, each imageMediaId OR imageUrl, first image is cover and content is plain text. Optional liveCoverVideoUrl is saved only as local metadata; it does not upload or create a Live Photo. Trusted URL images are imported automatically. Preserves requestId and returns media_id; never publishes or mass-sends.',{requestId:text,confirmDraft:{type:'boolean',const:true},articles:{type:'array',maxItems:8,items:article}},['requestId','confirmDraft','articles'],false),
 tool('wechat_list_drafts','Read the official draft list without modifying it.',{offset:{type:'integer',minimum:0},count:{type:'integer',minimum:1,maximum:20},includeContent:{type:'boolean'},normalized:{type:'boolean'}},[]),
 tool('wechat_get_draft','Read an exact official draft by media_id; this is draft evidence, not public publication.',{mediaId:text,normalized:{type:'boolean'}},['mediaId']),
 tool('wechat_delete_draft','Delete one exact draft by mediaId only after explicit confirmation. Keep requestId stable and check its ledger if response is unknown.',{requestId:text,mediaId:text,confirmDelete:{type:'boolean',const:true}},['requestId','mediaId','confirmDelete'],false),
 tool('wechat_publish_draft','Submit an existing draft by mediaId through the official publishing API, separately from draft creation. Requires account permission and explicit confirmPublish. Check original request status when result is unknown; published result is not immediate delivery confirmation.',{requestId:text,mediaId:text,confirmPublish:{type:'boolean',const:true}},['requestId','mediaId','confirmPublish'],false),
 tool('wechat_publish_status','Check official publication status for a publish_id; submitted does not imply published.',{publishId:text},['publishId']),
 tool('wechat_draft_request_status','Read a restart-durable local request ledger. Unknown submissions must be reconciled, never resubmitted with another requestId.',{requestId:text},['requestId']),
];
