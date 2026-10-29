import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import {createServer} from 'node:http';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
function loader(mocks = {}, globals = {}) {
  const cache = new Map(), shared = {};
  function load(file) {
    if (file in mocks) return mocks[file];
    if (cache.has(file)) return cache.get(file).exports;
    const loadedModule = { exports: {} }; cache.set(file, loadedModule);
    const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const sandbox = { module: loadedModule, exports: loadedModule.exports, require: name => {
      if (name in mocks) return mocks[name];
      if (name.startsWith('.') || name.startsWith('@/')) {
        const target = (name.startsWith('@/') ? name.slice(2) : path.normalize(path.join(path.dirname(file), name))) + (name.endsWith('.ts') ? '' : '.ts');
        return load(target);
      }
      return require(name);
    }, global: shared, console, process, Buffer, URL, Request, Response, Headers, AbortSignal, FormData, Blob, fetch, setTimeout, clearTimeout, performance, structuredClone, crypto: globalThis.crypto, ...globals };
    vm.runInNewContext(source, sandbox, { filename: file });
    return loadedModule.exports;
  }
  return load;
}


const fixture={appId:'wx0123456789abcdef',appSecret:'0'.repeat(32),name:'Fixture account'};
const suites=[];
function setup(replies=[]){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'wechat-draft-tests-'));
 fs.mkdirSync(path.join(cwd,'.runtime/wechat-drafts'),{recursive:true});
 fs.writeFileSync(path.join(cwd,'.runtime/wechat-drafts/config.json'),JSON.stringify(fixture),{mode:0o600});
 const calls=[];
 const fakeFetch=async(url,init={})=>{
  calls.push({url:String(url),init});
  if(!replies.length)throw Error('Unexpected network request');
  const next=replies.shift();
  if(typeof next==='function')return next(url,init);
  if(next instanceof Error)throw next;
  return Response.json(next);
 };
 const load=loader({}, {fetch:fakeFetch,process:{...process,cwd:()=>cwd,env:{WECHAT_HTTPS_PROXY:'http://127.0.0.1:7890'}}});
 const service=load('lib/wechat/draft-service.ts');
 const r={...service,calls,cwd,load,replies};suites.push(r);return r;
}
const token={access_token:'fixture-token-never-return',expires_in:7200};
const article={title:'Fixture',content:'<p>Test body</p>',thumbMediaId:'permanent-cover'};
const create=(r,id='create-1',articles=[article])=>r.callWechatDraftTool('wechat_create_draft',{requestId:id,confirmDraft:true,articles});
test.after(()=>{for(const r of suites)fs.rmSync(r.cwd,{recursive:true,force:true});});
test('catalog is draft-only and has independent platform authentication',()=>{
 const c=loader()('lib/workflow/platform-mcp-contract.ts'),names=c.platformMcpTools('wechat').map(x=>x.name);
 assert.equal(names.length,7);assert(names.includes('wechat_create_draft'));assert(!names.some(x=>/workflow|publish|delete/.test(x)));
 const env={WORKFLOW_MCP_TOKEN:'fixture'};
 for(const other of ['douyin','xiaohongshu','x']){
  const req=new Request('https://auto-parse-v2.vyibc.com/api/publish/mcp/wechat',{headers:{authorization:'Bearer '+c.platformMcpToken(other,env)}});
  assert.equal(c.authorizePlatformMcp(req,'wechat',env),401);
 }
 assert.equal(Object.keys(c.PLATFORM_WORKFLOWS.wechat).length,0);
});
test('capabilities have no secrets or network side effects',async()=>{
 const r=setup(),data=await r.callWechatDraftTool('wechat_capabilities',{});
 assert.equal(data.draftOnly,true);assert.equal(data.publicPublish,false);assert.equal(data.browserRequired,false);
 assert(!JSON.stringify(data).includes(fixture.appSecret));assert.equal(r.calls.length,0);
});
test('whitelist failures are sanitized and cause no mutation intent',async()=>{
 const r=setup([{errcode:40164,errmsg:'invalid ip 84.8.217.45 ipv6 ::ffff:84.8.217.45 not in whitelist rid: PRIVATE'}]);
 await assert.rejects(create(r),e=>{assert.equal(e.code,40164);assert.equal(e.egressIp,'84.8.217.45');assert(!e.message.includes('PRIVATE'));return true;});
 assert(!fs.existsSync(path.join(r.cwd,'.data')));assert.equal(r.calls.length,1);
 assert.equal(JSON.parse(r.calls[0].init.body).force_refresh,false);
});
test('creates exactly one official draft and replays receipt after service reload',async()=>{
 const r=setup([token,{media_id:'draft-real-id'}]),a=await create(r);
 assert.equal(a.status,'draft_saved');assert.equal(a.published,false);
 const again=await create(r);assert.equal(again.replayed,true);assert.equal(r.calls.length,2);
 const reload=loader({}, {fetch:async()=>Response.json(token),process:{...process,cwd:()=>r.cwd,env:{WECHAT_HTTPS_PROXY:'http://127.0.0.1:7890'}}})('lib/wechat/draft-service.ts');
 const restored=await reload.callWechatDraftTool('wechat_create_draft',{requestId:'create-1',confirmDraft:true,articles:[article]});
 assert.equal(restored.media_id,'draft-real-id');assert.equal(restored.replayed,true);
 const dir=path.join(r.cwd,'.data/wechat-drafts',fixture.appId),file=fs.readdirSync(dir).find(x=>x.endsWith('.json'));
 assert.equal(fs.statSync(path.join(dir,file)).mode&0o777,0o600);
 assert(!fs.readFileSync(path.join(dir,file),'utf8').includes('fixture-token'));
});
test('same request ID with different content is rejected before another API mutation',async()=>{
 const r=setup([token,{media_id:'draft-1'}]);await create(r);
 await assert.rejects(create(r,'create-1',[{...article,title:'Changed'}]),/request_id_conflict/);
 assert.equal(r.calls.length,2);
});
test('uncertain network submission is durable and cannot be blindly repeated',async()=>{
 const r=setup([token,Error('contains token that must not leak')]);
 await assert.rejects(create(r),/wechat_transport_result_unknown/);
 const status=await r.callWechatDraftTool('wechat_draft_request_status',{requestId:'create-1'});
 assert.equal(status.state,'unknown');assert(!JSON.stringify(status).includes('contains token'));
 await assert.rejects(create(r),/submission_unknown/);assert.equal(r.calls.length,2);
});
test('unparseable successful mutation response is also unknown',async()=>{
 const r=setup([token,()=>new Response('not json')]);
 await assert.rejects(create(r),/response_result_unknown/);
 assert.equal((await r.callWechatDraftTool('wechat_draft_request_status',{requestId:'create-1'})).state,'unknown');
});
test('definitive API rejection supports safe same-ID retry',async()=>{
 const r=setup([token,{errcode:48001,errmsg:'not authorized SECRET'},{media_id:'draft-permitted'}]);
 await assert.rejects(create(r),e=>e.code===48001&&!e.message.includes('SECRET'));
 assert.equal((await r.callWechatDraftTool('wechat_draft_request_status',{requestId:'create-1'})).state,'failed');
 assert.equal((await create(r)).media_id,'draft-permitted');
});
test('concurrent same-ID calls never issue two draft/add requests',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});
 const r=setup([token,async()=>{await gate;return Response.json({media_id:'only-once'});}]);
 const first=create(r);
 while(r.calls.length<2)await delay(1);
 await assert.rejects(create(r),/request_busy/);release();await first;
 assert.equal(r.calls.filter(c=>new URL(c.url).pathname.endsWith('/draft/add')).length,1);
});
test('missing confirmation, invalid cover, empty articles and active HTML fail before network',async()=>{
 const r=setup();
 await assert.rejects(r.callWechatDraftTool('wechat_create_draft',{requestId:'id',articles:[article]}),/confirmation/);
 for(const a of [
  [],[{...article,thumbMediaId:undefined}],[{...article,coverImageUrl:'https://resource.vyibc.com/cover.png'}],
  [{...article,content:'<script>alert(1)</script>'}],
  [{...article,content:'<img src="http://127.0.0.1/private">'}],
  [{...article,title:'x'.repeat(65)}],
  [{...article,content:'<img data-src="https://resource.vyibc.com/a.png">'}],
 ])await assert.rejects(create(r,'invalid',a));
 assert.equal(r.calls.length,0);
});
const png=Buffer.from([137,80,78,71,13,10,26,10,1,2]);
test('cover upload uses permanent material and same-ID replay',async()=>{
 const r=setup([token,()=>new Response(png),{media_id:'permanent-cover-id',url:'https://mmbiz.qpic.cn/image'}]);
 const args={requestId:'upload-1',imageUrl:'https://resource.vyibc.com/cover.png',purpose:'cover'};
 assert.equal((await r.callWechatDraftTool('wechat_upload_image',args)).media_id,'permanent-cover-id');
 const url=new URL(r.calls[2].url);assert.equal(url.pathname,'/cgi-bin/material/add_material');assert.equal(url.searchParams.get('type'),'image');
 assert(r.calls[2].init.body instanceof FormData);
 assert.equal((await r.callWechatDraftTool('wechat_upload_image',args)).replayed,true);assert.equal(r.calls.length,3);
});
test('create automatically imports body images and cover before draft/add',async()=>{
 const r=setup([token,()=>new Response(png),{media_id:'cover-auto'},()=>new Response(png),{url:'https://mmbiz.qpic.cn/body-uploaded'},{media_id:'draft-image'}]);
 await create(r,'images',[{title:'Images',content:'<p>Hello</p><img src="https://resource.vyibc.com/body.png">',coverImageUrl:'https://resource.vyibc.com/cover.png'}]);
 const data=JSON.parse(r.calls.at(-1).init.body);
 assert.equal(data.articles[0].thumb_media_id,'cover-auto');
 assert(data.articles[0].content.includes('https://mmbiz.qpic.cn/body-uploaded'));
 assert(!data.articles[0].content.includes('https://resource.vyibc.com'));
});
test('untrusted hosts and cross-host redirects cannot reach internal services',async()=>{
 const r=setup([token,()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/internal'}})]);
 await assert.rejects(r.callWechatDraftTool('wechat_upload_image',{requestId:'ssrf',imageUrl:'https://resource.vyibc.com/a.png',purpose:'inline'}),/invalid_image_url/);
 assert.equal(r.calls.length,2);
 await assert.rejects(r.callWechatDraftTool('wechat_upload_image',{requestId:'ssrf2',imageUrl:'https://evil.test/a.png',purpose:'inline'}),/untrusted_image_host/);
 assert.equal(r.calls.length,2);
});
test('image content and stream size are checked, not just Content-Type',async()=>{
 for(const response of [()=>new Response('<svg/>',{headers:{'content-type':'image/png'}}),()=>new Response('x',{headers:{'content-length':String(2*1024*1024+1)}})]){
  const r=setup([token,response]);
  await assert.rejects(r.callWechatDraftTool('wechat_upload_image',{requestId:'invalid-image',imageUrl:'https://resource.vyibc.com/a.png',purpose:'inline'}),/unsupported_image_format|image_too_large/);
  assert.equal(r.calls.length,2);
 }
});
test('read tools use draft/get, count, and bounded list only; unsupported publish is denied',async()=>{
 const r=setup([token,{total_count:2},{item:[]},{news_item:[{title:'Existing draft'}]}]);
 assert.equal((await r.callWechatDraftTool('wechat_account_status',{})).draftCount,2);
 await r.callWechatDraftTool('wechat_list_drafts',{count:5,includeContent:false});
 assert.equal(JSON.parse(r.calls.at(-1).init.body).no_content,1);
 await r.callWechatDraftTool('wechat_get_draft',{mediaId:'existing'});
 await assert.rejects(r.callWechatDraftTool('wechat_list_drafts',{count:21}),/pagination/);
 await assert.rejects(r.callWechatDraftTool('publish',{}),/tool_not_allowed/);
 assert.equal(r.calls.length,4);
});

test('official JSON requests, uploads and asset downloads all carry an explicit proxy dispatcher',async()=>{
 const r=setup([token,()=>new Response(png),{media_id:'via-proxy'}]);
 await r.callWechatDraftTool('wechat_upload_image',{requestId:'proxy-upload',imageUrl:'https://resource.vyibc.com/a.png',purpose:'cover'});
 assert.equal(r.calls.length,3);
 for(const c of r.calls)assert(c.init.dispatcher,'request bypassed the proxy');
 assert.equal(r.calls[0].init.dispatcher,r.calls[2].init.dispatcher);
 assert.equal((await r.callWechatDraftTool('wechat_capabilities',{})).network.directFallback,false);
});
test('missing/invalid proxy config never attempts a direct request',async()=>{
 for(const uri of ['', 'socks5://127.0.0.1:1080', 'http://proxy.test/path']){
  let calls=0;
  const load=loader({}, {process:{...process,cwd:()=>'/unused',env:{WECHAT_HTTPS_PROXY:uri}},fetch:async()=>{calls++;return Response.json({});}});
  await assert.rejects(load('lib/wechat/http.ts').wechatFetch(new URL('https://api.weixin.qq.com/')),/wechat_proxy_(not_configured|configuration_invalid)/);
  assert.equal(calls,0);
 }
});
test('proxy transport error is not retried using the direct dispatcher',async()=>{
 const r=setup([Error('proxy unavailable')]);
 await assert.rejects(r.callWechatDraftTool('wechat_account_status',{}),/wechat_transport_result_unknown/);
 assert.equal(r.calls.length,1);assert(r.calls[0].init.dispatcher);
});
test('proxy credentials stay internal, transport changes invalidate the token cache',async()=>{
 const r=setup([token,{total_count:1},token,{total_count:1}]);
 const testEnv={WECHAT_HTTPS_PROXY:'http://user:pass@proxy.test:7890'};
 const load=loader({}, {process:{...process,cwd:()=>r.cwd,env:testEnv},fetch:async(url,init)=>{r.calls.push({url:String(url),init});return Response.json(r.replies.shift());}});
 const service=load('lib/wechat/draft-service.ts');
 const cap=await service.callWechatDraftTool('wechat_capabilities',{});
 assert(!JSON.stringify(cap).includes('user:pass'));assert(!JSON.stringify(cap).includes('proxy.test'));
 await service.callWechatDraftTool('wechat_account_status',{});
 testEnv.WECHAT_HTTPS_PROXY='http://another-user:another-password@proxy.test:7890';
 await service.callWechatDraftTool('wechat_account_status',{});
 assert.equal(r.calls.filter(c=>c.url.endsWith('/stable_token')).length,2);
});

test('real failed proxy connection cannot fall back and reach the origin server',async()=>{
 let reached=0;
 const origin=createServer((req,res)=>{reached++;res.end('direct connection forbidden');});
 await new Promise(resolve=>origin.listen(0,'127.0.0.1',resolve));
 try{
  const load=loader({}, {process:{...process,env:{WECHAT_HTTPS_PROXY:'http://127.0.0.1:1'}}});
  const transport=load('lib/wechat/http.ts');
  await assert.rejects(transport.wechatFetch(new URL('http://127.0.0.1:'+origin.address().port),{signal:AbortSignal.timeout(2000)}));
  assert.equal(reached,0);
 }finally{await new Promise(resolve=>origin.close(resolve));}
});

const newspic={articleType:'newspic',title:'早报贴图',content:'示例正文',images:[{imageMediaId:'image-first'},{imageMediaId:'image-second'}]};
test('native newspic preserves image order, first-image cover, mixed news compatibility and idempotence',async()=>{
 const r=setup([token,{media_id:'native-draft'}]);
 const result=await create(r,'native',[newspic,article]);
 const body=JSON.parse(r.calls.at(-1).init.body),n=body.articles[0];
 assert.equal(n.article_type,'newspic');
 assert.deepEqual(n.image_info.image_list,[{image_media_id:'image-first'},{image_media_id:'image-second'}]);
 assert.equal(n.thumb_media_id,undefined);assert.equal(n.content,'示例正文');
 assert.equal(body.articles[1].thumb_media_id,'permanent-cover');assert.equal(result.articleCount,2);
 assert.equal((await create(r,'native',[newspic,article])).replayed,true);assert.equal(r.calls.length,2);
 await assert.rejects(create(r,'native',[{...newspic,images:[...newspic.images].reverse()},article]),/request_id_conflict/);
});
test('newspic imports URLs as permanent image material, never inline uploads',async()=>{
 const r=setup([token,()=>new Response(png),{media_id:'uploaded-image'},{media_id:'image-draft'}]);
 await create(r,'native-url',[{...newspic,images:[{imageUrl:'https://resource.vyibc.com/card.png'},{imageMediaId:'existing-image'}]}]);
 assert.equal(new URL(r.calls[2].url).pathname,'/cgi-bin/material/add_material');
 assert.deepEqual(JSON.parse(r.calls.at(-1).init.body).articles[0].image_info.image_list,[{image_media_id:'uploaded-image'},{image_media_id:'existing-image'}]);
});
test('native image validation rejects bad counts, HTML, conflicting references and news-only cover',async()=>{
 const r=setup();
 for(const patch of [
  {images:[]},{images:Array.from({length:21},()=>({imageMediaId:'x'}))},{images:[{}]},
  {images:[{imageMediaId:'x',imageUrl:'https://resource.vyibc.com/x.png'}]},
  {images:[{imageUrl:'https://evil.test/x.png'}]},{images:[{imageMediaId:3}]},
  {content:'<p>Not plain text</p>'},{content:'x'.repeat(1001)},{title:'字'.repeat(33)},
  {coverImageUrl:'https://resource.vyibc.com/cover.png'},{articleType:'live'},
 ])await assert.rejects(create(r,'invalid-native',[{...newspic,...patch}]));
 await assert.rejects(create(r,'invalid-news',[{...article,images:newspic.images}]));
 assert.equal(r.calls.length,0);
});
test('uncertain native draft creation keeps completed image uploads and never blindly retries',async()=>{
 const r=setup([token,()=>new Response(png),{media_id:'retained-upload'},Error('network after submission')]);
 const a={...newspic,images:[{imageUrl:'https://resource.vyibc.com/card.png'}]};
 await assert.rejects(create(r,'native-unknown',[a]),/result_unknown/);
 assert.equal((await r.callWechatDraftTool('wechat_draft_request_status',{requestId:'native-unknown'})).state,'unknown');
 assert.equal((await r.callWechatDraftTool('wechat_draft_request_status',{requestId:'native-unknown:image:0:0'})).state,'completed');
 await assert.rejects(create(r,'native-unknown',[a]),/submission_unknown/);assert.equal(r.calls.length,4);
});
test('definite native API rejection reuses already uploaded images on same-ID retry',async()=>{
 const r=setup([token,()=>new Response(png),{media_id:'retained-upload'},{errcode:45008,errmsg:'reject'},{media_id:'retried-draft'}]);
 const a={...newspic,images:[{imageUrl:'https://resource.vyibc.com/card.png'}]};
 await assert.rejects(create(r,'native-retry',[a]),e=>e.code===45008);
 assert.equal((await create(r,'native-retry',[a])).media_id,'retried-draft');
 assert.equal(r.calls.filter(c=>new URL(c.url).pathname.endsWith('/material/add_material')).length,1);
});
test('permanent native images accept over 1MiB while inline images enforce 1MiB',async()=>{
 const bytes=Buffer.concat([png,Buffer.alloc(1024*1024)]);
 const native=setup([token,()=>new Response(bytes),{media_id:'large-permanent'}]);
 assert.equal((await native.callWechatDraftTool('wechat_upload_image',{requestId:'large-image',imageUrl:'https://resource.vyibc.com/card.png',purpose:'newspic'})).media_id,'large-permanent');
 const inline=setup([token,()=>new Response(bytes)]);
 await assert.rejects(inline.callWechatDraftTool('wechat_upload_image',{requestId:'large-inline',imageUrl:'https://resource.vyibc.com/card.png',purpose:'inline'}),/image_too_large/);
 const capped=setup([token,()=>new Response('x',{headers:{'content-length':String(10*1024*1024+1)}})]);
 await assert.rejects(capped.callWechatDraftTool('wechat_upload_image',{requestId:'large-native',imageUrl:'https://resource.vyibc.com/card.png',purpose:'newspic'}),/image_too_large/);
});
test('advertised native schema passes actual MCP recursive argument validation',()=>{
 const c=loader()('lib/workflow/platform-mcp-contract.ts'),validate=loader()('lib/workflow/mcp-contract.ts').validToolArguments;
 const def=c.platformMcpTools('wechat').find(t=>t.name==='wechat_create_draft');
 assert.equal(validate(def.inputSchema,{requestId:'schema-native',confirmDraft:true,articles:[newspic]}),true);
 assert.equal(validate(def.inputSchema,{requestId:'schema-native',confirmDraft:true,articles:[{...newspic,images:[{imageUrl:'https://resource.vyibc.com/a.png',extra:1}]}]}),false);
});
