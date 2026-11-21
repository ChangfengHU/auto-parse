export const DOUYIN_VIDEO_OPTIONS={
 title:{maxCharacters:30},description:{maxCharacters:900},topics:{maxItems:5,maxCharacters:30,format:'letters_numbers_underscore'},
 cover:{experimental:false,verifiedThrough:'editor_and_creator_primary_cover',creatorPrimaryCoverReadbackVerified:true,publicCoverReadbackVerified:false,verificationOutput:'coverVerification',formats:['jpeg','png'],maxBytes:8388608,orientations:['vertical_3_4','horizontal_4_3']},
 aiGenerated:true,maxBytes:536870912,prepareIsCloudDraft:false,
 settings:{fields:['visibility','allowDownload','collectionName','scheduledAt'],visibility:['public','friends','private'],schedule:{minimumHours:2,maximumDays:14,timezone:'Explicit offset input; browser timezone reported',verifiedThrough:'editor_only'},collectionSelection:'unique_exact_name',verification:{visibility:'creator_readback_public_and_editor_private',allowDownload:'creator_readback_disabled',scheduledAt:'editor_only',collectionName:'positive_live_case_unverified'},crossPosting:'disabled'},
 unsupported:['location','productLink','commentSettings','cloudDraftSave','crossPosting','videoChapters','hotspot']
} as const;
const str={type:'string',minLength:1};
export const DOUYIN_VIDEO_FIELDS={
 settings:{type:'object',additionalProperties:false,description:'Optional publication settings. Omitting preserves legacy platform defaults; {} explicitly uses public, allow downloads, no collection and immediate. Applied settings are verified and returned; unknown properties rejected.',properties:{visibility:{type:'string',enum:['public','friends','private']},allowDownload:{type:'boolean'},collectionName:{type:['string','null'],minLength:1,maxLength:100,description:'Exact unique existing eligible collection name; null clears. No automatic creation.'},scheduledAt:{type:['string','null'],description:'RFC3339 with explicit offset and zero seconds; 2 hours to 14 days ahead, null means immediate. Scheduled acceptance differs from public availability.'}}},
 accountId:{...str,pattern:'^[0-9]{5,30}$',description:'Verified stable Douyin account ID.'},
 workId:{type:'string',pattern:'^[a-f0-9]{64}$',description:'Optional existing work ID. Resolves retained work source and the selected account/channel content; explicit fields override that plan.'},
 videoUrl:{...str,description:'Owned resource.vyibc.com or cdn.vyibc.com HTTPS MP4. Required unless workId resolves it; conflicting workId/videoUrl is rejected.'},
 title:{...str,maxLength:30,description:'Override the channel title. Required for direct URL publishing; resolved from the channel/account plan when workId is supplied.'},
 description:{type:'string',maxLength:900,description:'Body, separate from title. Omission inherits a work channel plan, otherwise empty; explicit empty string clears it.'},
 topics:{type:'array',maxItems:5,items:{type:'string',minLength:1,maxLength:30,pattern:'^[\\p{L}\\p{N}_]{1,30}$'},description:'Up to five tags without #. Omission inherits a channel plan, otherwise []; explicit [] clears tags.'},
 aiGenerated:{type:'boolean',description:'Truthful platform AI declaration, not text added to the title/body. Cannot clear an existing AI work classification.'},
 requestId:{...str,minLength:8,maxLength:100,pattern:'^[A-Za-z0-9_-]{8,100}$',description:'Stable identifier for this intent. Never change it after an unknown submission.'},
 cover:{type:'object',properties:{verticalUrl:{...str,description:'Optional JPEG/PNG cover for 3:4, <=8MiB.'},horizontalUrl:{...str,description:'Optional JPEG/PNG cover for 4:3, <=8MiB.'}},additionalProperties:false,description:'Custom covers with per-orientation upload, dialog and preview verification; editor preparation verified, public-post cover readback not newly verified. Owned HTTPS resource/cdn URLs only, no query or fragment. Omission inherits a channel plan; {} explicitly uses platform defaults.'}
};
