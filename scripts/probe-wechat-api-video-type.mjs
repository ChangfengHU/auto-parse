import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript'),cache=new Map();
let upstreamTypeResult;
function load(file){
 if(cache.has(file))return cache.get(file);
 const mod={exports:{}};let source=fs.readFileSync(file,'utf8');
 if(file==='lib/wechat/draft-service.ts')source+=String.raw`
export async function runVideoTypeProbe(){
 const c=config();await accessToken(c);
 const image=readFileSync('.data/video-work-center/posters/c94f498d604b7809ed8fc8bac38226fdc7cc4f91645d25e371cda9b6c65dccb1.jpg');
 const cover=await mutate(c,'api-video-type-probe-20261110-cover','upload_probe_cover',{sha:createHash('sha256').update(image).digest('hex')},async()=>{
  const form=new FormData();form.set('media',new Blob([image],{type:'image/jpeg'}),'video-api-probe-cover.jpg');
  return api(c,'material/add_material?type=image',undefined,form);
 });
 const article={article_type:'video',title:'视频API类型验证勿发布',content:'<p>仅用于验证官方草稿API是否接受视频类型。没有实际视频则本次验证不通过，请勿发表。</p>',author:c.name,thumb_media_id:cover.media_id,need_open_comment:0,only_fans_can_comment:0};
 try{
  const created=await mutate(c,'api-video-type-probe-20261110-draft','probe_video_draft_type',article,()=>api(c,'draft/add',{articles:[article]}));
  const readback=await api(c,'draft/get',{media_id:created.media_id});
  return {created:true,media_id:created.media_id,articleTypes:(readback.news_item as Json[]||[]).map(a=>a.article_type||'news'),returnedKeys:(readback.news_item as Json[]||[]).map(a=>Object.keys(a)),note:'Type acceptance alone is not video-draft success. This probe includes no guessed video fields.'};
 }catch(e){return {created:false,...errorResult(e)}}
}
`;
 if(file==='lib/wechat/draft-service.ts')source+="\nexport async function runVideoEmbedProbe(){\n const c=config();await accessToken(c);\n const file='.data/video-work-center/originals/c94f498d604b7809ed8fc8bac38226fdc7cc4f91645d25e371cda9b6c65dccb1.mp4',bytes=readFileSync(file);\n if(bytes.length>10*1024*1024)throw Error('wechat_probe_video_exceeds_documented_limit');\n const video=await mutate(c,'api-video-type-probe-20261110-video','upload_probe_video',{sha:createHash('sha256').update(bytes).digest('hex')},async()=>{\n  const form=new FormData();form.set('media',new Blob([bytes],{type:'video/mp4'}),'api-video-probe.mp4');form.set('description',JSON.stringify({title:'视频API能力验证',introduction:'用户授权的私有视频草稿验证，不发表。'}));\n  return api(c,'material/add_material?type=video',undefined,form);\n });\n const material=await api(c,'material/get_material',{media_id:video.media_id});\n if(typeof material.down_url!=='string')return {videoUploaded:true,materialKeys:Object.keys(material),videoDraftVerified:false,reason:'video_download_url_not_returned'};\n const u=new URL(material.down_url);\n if(!['http:','https:'].includes(u.protocol)||!['qq.com','qpic.cn','weixin.qq.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))throw Error('wechat_probe_material_host_unexpected');\n const old=readLedger(ledgerPath(c,'api-video-type-probe-20261110-draft'));\n const mediaId=old?.result?.media_id;if(typeof mediaId!=='string')throw Error('wechat_probe_original_draft_missing');\n const cover=readLedger(ledgerPath(c,'api-video-type-probe-20261110-cover'))?.result?.media_id;\n const escaped=material.down_url.replaceAll('&','&amp;').replaceAll('\"','&quot;');\n const content='<p>真实视频API验证：请检查下方播放器。本条不公开发表。</p><video controls=\"controls\" src=\"'+escaped+'\"></video>';\n const article={title:'视频API嵌入验证勿发布',content,author:c.name,thumb_media_id:cover,need_open_comment:0,only_fans_can_comment:0};\n try{\n  await mutate(c,'api-video-type-probe-20261110-embed','probe_video_embed_draft',{mediaId,article},()=>api(c,'draft/update',{media_id:mediaId,index:0,articles:article}));\n  const readback=await api(c,'draft/get',{media_id:mediaId}),articles=readback.news_item as Json[]||[];\n  return {videoUploaded:true,sourceBytes:bytes.length,videoMediaId:video.media_id,media_id:mediaId,sourceHost:u.hostname,articles:articles.map(a=>({title:a.title,articleType:a.article_type,contentChars:typeof a.content==='string'?a.content.length:0,hasVideoElement:typeof a.content==='string'&&/<video\\b/i.test(a.content),hasIframe:typeof a.content==='string'&&/<iframe\\b/i.test(a.content),hasWechatVideoMarker:typeof a.content==='string'&&/wxv_|mpvideo|video_iframe/.test(a.content),retainsVideoSource:typeof a.content==='string'&&a.content.includes(u.hostname)})),videoPlaybackVerified:false,published:false};\n }catch(e){return {videoUploaded:true,media_id:mediaId,updated:false,...errorResult(e),videoPlaybackVerified:false,published:false}}\n}\n";

 if(file==='lib/wechat/draft-service.ts')source+="\nexport async function labelVideoProbeFailure(){\n const c=config(),entry=readLedger(ledgerPath(c,'api-video-type-probe-20261110-draft')),mediaId=entry?.result?.media_id;\n if(typeof mediaId!=='string')throw Error('wechat_probe_original_draft_missing');\n const original=await api(c,'draft/get',{media_id:mediaId}),a=(original.news_item as Json[])[0];\n const article={...a,title:'API视频验证未通过勿发布',content:'<p>本条仅用于API能力验证，未通过。真实视频已上传永久素材库，但通过公开草稿接口写入的video播放器及视频地址在微信回读时被移除。该条是测试记录，不是有效视频草稿，请勿发表。</p>'};\n for(const key of ['url','thumb_url','show_cover_pic'])delete article[key];\n await mutate(c,'api-video-type-probe-20261110-result-note','label_video_probe_failure',{mediaId,title:article.title,content:article.content},()=>api(c,'draft/update',{media_id:mediaId,index:0,articles:article}));\n return {media_id:mediaId,title:article.title,validVideoDraft:false,published:false};\n}\n";

 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const sandbox={module:mod,exports:mod.exports,require:n=>{
 if(n==='./http'&&file==='lib/wechat/draft-service.ts'){const actual=load('lib/wechat/http.ts');return{...actual,wechatFetch:async(url,init)=>{const r=await actual.wechatFetch(url,init);if(['/cgi-bin/draft/add','/cgi-bin/draft/update'].includes(url.pathname)){try{const body=await r.clone().json();upstreamTypeResult={http:r.status,errcode:body.errcode??0,errmsg:typeof body.errmsg==='string'?body.errmsg.replace(/\s*rid:.*$/,'').slice(0,140):undefined}}catch{upstreamTypeResult={http:r.status,nonJson:true}}}return r}}}
 if(n.startsWith('.'))return load(path.normalize(path.join(path.dirname(file),n))+(n.endsWith('.ts')?'':'.ts'));
 return require(n);
 },process,console,Buffer,fetch,URL,Request,Response,Headers,Blob,FormData,AbortSignal,setTimeout,clearTimeout};
 vm.runInNewContext(compiled,sandbox,{filename:file});cache.set(file,mod.exports);return mod.exports;
}
try{
 const api=load('lib/wechat/draft-service.ts');const result=process.argv[2]==='label-failure'?await api.labelVideoProbeFailure():process.argv[2]==='embed'?await api.runVideoEmbedProbe():await api.runVideoTypeProbe();
 console.log(JSON.stringify({probe:'documented-draft-type-gate',result,upstreamTypeResult,published:false,createdNativeVideoDraft:false}));
}catch(e){console.log(JSON.stringify({probeFailed:e.code||(/^wechat_[a-z_]+$/.test(e.message)?e.message:'probe_failed'),published:false}));process.exitCode=1}
