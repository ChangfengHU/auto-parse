import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
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
 const load=loader({}, {fetch:fakeFetch,process:{...process,cwd:()=>cwd,env:{}}});
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
 const reload=loader({}, {fetch:async()=>Response.json(token),process:{...process,cwd:()=>r.cwd,env:{}}})('lib/wechat/draft-service.ts');
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
