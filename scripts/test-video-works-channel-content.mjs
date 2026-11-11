import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript'),root=path.resolve(new URL('..',import.meta.url).pathname);
function loader(mocks={}){
 const cache=new Map();const load=file=>{if(mocks[file])return mocks[file];if(cache.has(file))return cache.get(file);const mod={exports:{}};cache.set(file,mod.exports);
 const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{module:mod,exports:mod.exports,require:n=>mocks[n]||(n.startsWith('.')||n.startsWith('@/')?load((n.startsWith('@/')?n.slice(2):path.normalize(path.join(path.dirname(file),n)))+(n.endsWith('.ts')?'':'.ts')):require(n)),process,console,Buffer,URL,Request,Response,Headers,ReadableStream,AbortSignal,setTimeout,clearTimeout,crypto:globalThis.crypto},{filename:file});cache.set(file,mod.exports);return mod.exports};return load;
}
function fixture(run){return async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'channel-manager-test-')),previous=process.env.VIDEO_WORKS_DATA_DIR;process.env.VIDEO_WORKS_DATA_DIR=dir;try{await run(loader(),dir)}finally{if(previous===undefined)delete process.env.VIDEO_WORKS_DATA_DIR;else process.env.VIDEO_WORKS_DATA_DIR=previous;fs.rmSync(dir,{recursive:true,force:true})}}}
const source=i=>'https://resource.vyibc.com/channel-fixture-'+i+'.mp4';
const register=(store,i=0)=>store.registerVideoWork({sourceUrl:source(i),title:'原作品 '+i,description:'原始正文',topics:['原标签'],aiGenerated:true}).record.id;
const publish=(store,i,p,state='published')=>store.recordVideoDelivery({platform:p,accountId:'account_'+p,requestId:'delivery-'+i+'-'+p,sourceUrl:source(i),title:p+' 独立标题',description:p+' 提交正文',topics:['已提交'],aiGenerated:true,mode:'publish'},{state,receipt:state==='published'?{workId:'receipt-'+i+'-'+p}:undefined});
const input=(extra={})=>({platform:'douyin',title:'抖音方案标题',description:'抖音方案正文',topics:['方案'],expectedRevision:0,requestId:'content-request-001',confirmSave:true,...extra});
test('channel/account copies, retry identity, CAS and saved history preserve master and publication snapshots',fixture(async(load)=>{
 const store=load('lib/video-works/store.ts'),content=load('lib/video-works/channel-content.ts');const id=register(store);publish(store,0,'douyin');const w=store.getVideoWork(id),before=JSON.stringify(w.deliveries);
 const saved=content.saveChannelContent(w,input());assert.equal(saved.savedRevision,1);assert.equal(saved.externalActionsTriggered,false);
 assert.equal(content.saveChannelContent(w,input()).reused,true);
 assert.throws(()=>content.saveChannelContent(w,input({title:'changed with same request'})),/request_conflict/);
 assert.throws(()=>content.saveChannelContent(w,input({requestId:'content-request-stale'})),/revision_conflict/);
 content.saveChannelContent(w,input({requestId:'content-request-002',expectedRevision:1,title:'第二版标题'}));
 const replay=content.saveChannelContent(w,input());assert.equal(replay.savedRevision,1);assert.equal(replay.content.revision,2);
 content.saveChannelContent(w,input({platform:'wechat',title:'公众号专用标题',requestId:'wechat-content-001'}));
 content.saveChannelContent(w,input({accountId:'another_account',title:'另一个账号标题',requestId:'account-content-001'}));
 assert.equal(content.readChannelContent(w,{platform:'douyin'}).content.title,'第二版标题');
 assert.equal(content.readChannelContent(w,{platform:'wechat'}).content.title,'公众号专用标题');
 assert.equal(content.readChannelContent(w,{platform:'douyin',accountId:'another_account'}).content.title,'另一个账号标题');
 assert.equal(content.readChannelContent(w,{platform:'douyin',accountId:'new_account'}).source,'channel_default');
 assert.equal(content.readChannelContent(w,{platform:'douyin'}).history.length,2);
 const scoped=store.listVideoWorks({platform:'douyin'}).items.find(v=>v.id===id);assert.equal(scoped.channelContents.some(c=>c.platform==='wechat'),false);
 assert.equal(store.getVideoWork(id).title,'原作品 0');assert.equal(JSON.stringify(store.getVideoWork(id).deliveries),before);
 assert.throws(()=>content.saveChannelContent(w,input({platform:'fake'})),/channel_invalid/);
 assert.throws(()=>content.saveChannelContent(w,input({cover:{verticalUrl:'https://evil.test/a.png'}})),/cover_invalid/);
 assert.throws(()=>content.saveChannelContent(w,input({cover:{verticalUrl:'https://resource.vyibc.com/a.png?token=no'}})),/cover_invalid/);
}));
test('multi-channel any/all and channel-bound states filter before pagination, retaining all work destinations',fixture(async(load)=>{
 const store=load('lib/video-works/store.ts'),content=load('lib/video-works/channel-content.ts');
 for(let i=0;i<24;i++){register(store,i);publish(store,i,'douyin');if(i<3)publish(store,i,'wechat','draft_saved')}
 assert.equal(store.listVideoWorks({platforms:['douyin','wechat'],platformMatch:'any',limit:5}).total,24);
 const both=store.listVideoWorks({platforms:['douyin','wechat'],platformMatch:'all',limit:2});assert.equal(both.total,3);assert.equal(both.items.length,2);assert.equal(both.nextOffset,2);assert.equal(both.items[0].deliveries.length,2);
 assert.equal(store.listVideoWorks({platforms:['wechat'],states:['published']}).total,0,'Douyin receipt must not satisfy WeChat filter');
 assert.equal(store.listVideoWorks({platforms:['wechat'],states:['draft_saved']}).total,3);
 assert.equal(store.listVideoWorks({platform:'douyin'}).items[0].deliveries.length,1,'legacy scoped MCP remains isolated');
 const w=store.getVideoWork(register(store,30));content.saveChannelContent(w,input({platform:'instagram',title:'Instagram 不同标题',description:'唯一的英文内容 unicorn-copy-438',requestId:'instagram-plan-001'}));
 assert.equal(store.listVideoWorks({platforms:['instagram'],state:'content_ready'}).total,1);
 assert.equal(store.listVideoWorks({q:'unicorn-copy-438'}).total,1);
 assert.equal(store.listVideoWorks({state:'published',platforms:['instagram']}).total,0);
}));
test('HTTP channel plans enforce editor-only writes, CSRF and immutable server-resolved work identity',fixture(async(load)=>{
 const store=load('lib/video-works/store.ts'),id=register(store),ctx={params:Promise.resolve({id})};
 const api=loader({'lib/video-works/store.ts':store,'lib/video-works/auth.ts':{workScope:req=>req.headers.get('x-fixture-scope'),workSameOrigin:req=>req.headers.get('origin')==='https://auto-parse-v2.vyibc.com'}})('app/api/video-works/[id]/channel-content/route.ts');
 const post=(scope,body=input(),origin='https://auto-parse-v2.vyibc.com')=>new Request('https://auto-parse-v2.vyibc.com/api/video-works/'+id+'/channel-content',{method:'POST',headers:{'content-type':'application/json',origin,...scope?{'x-fixture-scope':scope}:{}},body:JSON.stringify(body)});
 assert.equal((await api.POST(post(null),ctx)).status,401);assert.equal((await api.POST(post('works'),ctx)).status,401);assert.equal((await api.POST(post('douyin'),ctx)).status,401);
 assert.equal((await api.POST(post('works_editor',input(),'https://evil.test'),ctx)).status,403);
 assert.equal((await api.POST(post('works_editor',input({workId:'another'})),ctx)).status,409);
 const r=await api.POST(post('works_editor'),ctx);assert.equal(r.status,200);assert.equal((await r.json()).externalActionsTriggered,false);
 const read=await api.GET(new Request('https://auto-parse-v2.vyibc.com/api/video-works/'+id+'/channel-content?platform=douyin'),ctx);assert.equal(read.status,200);const d=await read.json();assert.equal(d.canEdit,false);assert.equal(d.revision,1);assert.equal(d.content.title,'抖音方案标题');
 const limited=await api.GET(new Request('https://auto-parse-v2.vyibc.com/api/video-works/'+id+'/channel-content?platform=wechat',{headers:{'x-fixture-scope':'douyin'}}),ctx);assert.equal(limited.status,403);
}));
test('old web grants stay draft-only; separately requested content grant never becomes admin/platform bearer',fixture(async(load)=>{
 const previous=process.env.VIDEO_WORKS_MCP_TOKEN;process.env.VIDEO_WORKS_MCP_TOKEN='isolated-channel-test-only';
 try{const access=load('lib/video-works/web-access.ts');
 for(const edit of [false,true]){const link=access.issueVideoWorksWebAccess({confirmWebAccess:true,includeContentEditing:edit}),code=new URLSearchParams(new URL(link.url).hash.slice(1)).get('access'),cookie=access.consumeVideoWorksWebAccess(code).split(';')[0];assert.equal(access.videoWorksWebScope(new Request('https://auto-parse-v2.vyibc.com',{headers:{cookie}})),edit?'works_editor':'works');assert.throws(()=>access.consumeVideoWorksWebAccess(code),/expired/)}
 }finally{if(previous===undefined)delete process.env.VIDEO_WORKS_MCP_TOKEN;else process.env.VIDEO_WORKS_MCP_TOKEN=previous}
}));

test('draft preparation consumes the selected channel/account copy and cover without changing past submissions',fixture(async(load)=>{
 const store=load('lib/video-works/store.ts'),content=load('lib/video-works/channel-content.ts'),id=register(store),w=store.getVideoWork(id);publish(store,0,'douyin');const before=JSON.stringify(store.getVideoWork(id).deliveries);
 content.saveChannelContent(w,input({platform:'wechat',accountId:'gh_123456789012',title:'公众号短标题',description:'公众号正文',requestId:'wechat-prepare-copy'}));
 content.saveChannelContent(w,input({accountId:'account_douyin',title:'抖音专用',description:'抖音正文',cover:{verticalUrl:'https://resource.vyibc.com/own-cover.jpg'},requestId:'douyin-prepare-copy'}));
 const service=loader({'lib/video-works/store.ts':store,'lib/workflow/wechat-media-service.ts':{callWechatMediaTool:()=>{throw Error('external write is forbidden in fixture')}}})('lib/video-works/service.ts');
 const wp=service.prepareWorkWechatDraft({workId:id,expectedAccount:'gh_123456789012'});assert.equal(wp.title,'公众号短标题');assert.equal(wp.description,'公众号正文');assert.equal(wp.needsAdaptation,false);
 let called;const api=loader({'lib/video-works/store.ts':store,'lib/video-works/auth.ts':{workScope:()=> 'admin',workSameOrigin:()=>true},'lib/workflow/platform-mcp-service.ts':{callPlatformTool:async(platform,name,args)=>{called={platform,name,args};return {prepared:true}}}})('app/api/video-works/route.ts');
 const r=await api.POST(new Request('https://auto-parse-v2.vyibc.com/api/video-works',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'prepare',confirmPrepare:true,workId:id,platform:'douyin',accountId:'account_douyin',requestId:'test-prepare-copy'})}));
 assert.equal(r.status,200);assert.equal(called.name,'prepare_video');assert.equal(called.args.title,'抖音专用');assert.equal(called.args.description,'抖音正文');assert.equal(called.args.cover.verticalUrl,'https://resource.vyibc.com/own-cover.jpg');
 assert.equal(JSON.stringify(store.getVideoWork(id).deliveries),before);
}));

test('MCP canonical input inherits each account plan and never drops explicit body, tags, covers or AI metadata',fixture(async(load)=>{
 const store=load('lib/video-works/store.ts'),content=load('lib/video-works/channel-content.ts'),id=register(store),w=store.getVideoWork(id);
 content.saveChannelContent(w,input({platform:'douyin',accountId:'53017623213',title:'账号专用',description:'账号正文',cover:{verticalUrl:'https://resource.vyibc.com/vertical.jpg',horizontalUrl:'https://cdn.vyibc.com/horizontal.png'},requestId:'canonical-plan-001'}));
 const canonical=load('lib/workflow/douyin-publication-input.ts').resolveDouyinPublicationInput;
 const v=canonical({workId:id,accountId:'53017623213',aiGenerated:true,requestId:'canonical-request'});
 assert.equal(v.title,'账号专用');assert.equal(v.description,'账号正文');assert.equal(v.topics[0],'方案');assert.equal(v.cover.horizontalUrl,'https://cdn.vyibc.com/horizontal.png');assert.equal(v.videoUrl,source(0));assert.equal(v.aiGenerated,true);
 const override=canonical({workId:id,accountId:'53017623213',aiGenerated:true,requestId:'canonical-override',title:'显式标题',description:'',topics:[],cover:{}});
 assert.equal(override.title,'显式标题');assert.equal(override.description,'');assert.equal(override.topics.length,0);assert.equal(override.cover,undefined);
 assert.throws(()=>canonical({workId:id,accountId:'53017623213',aiGenerated:false,requestId:'canonical-false'}),/ai_declaration/);
 assert.throws(()=>canonical({workId:id,videoUrl:source(99),accountId:'53017623213',aiGenerated:true,requestId:'canonical-wrong'}),/source_conflict/);
 assert.throws(()=>canonical({workId:id,accountId:'53017623213',aiGenerated:true,requestId:'canonical-extra',scheduledPublish:'tomorrow'}),/unsupported_parameter/);
}));
test('page distribution uses the canonical payload and refuses missing confirmation, unknown prior submission, and unverified accounts',fixture(async(load)=>{
 const store=load('lib/video-works/store.ts'),id=register(store),w=store.getVideoWork(id);w.archive={bytes:1000,sha256:'a'.repeat(64),storage:'local_original',savedAt:new Date().toISOString()};
 const calls=[];const distribution=loader({'lib/video-works/store.ts':store,'lib/workflow/platform-mcp-service.ts':{callPlatformTool:async(p,n,input)=>{calls.push({p,n,input});return {status:'running',taskId:'fixture-task'}}}})('lib/video-works/distribution.ts');
 const params={action:'prepare',accountId:'53017623213',title:'公开标题',description:'正文',topics:['生活'],aiGenerated:true,cover:{verticalUrl:'https://resource.vyibc.com/vertical.jpg'}};
 await assert.rejects(distribution.executeWorkDouyin(w,params),/confirmation/);assert.equal(calls.length,0);
 await assert.rejects(distribution.executeWorkDouyin(w,{...params,confirmPrepare:true},true),/not_previously_verified/);assert.equal(calls.length,0);
 const first=await distribution.executeWorkDouyin(w,{...params,confirmPrepare:true});await distribution.executeWorkDouyin(w,{...params,confirmPrepare:true});assert.equal(calls[0].input.requestId,calls[1].input.requestId);assert.equal(first.operation.state,'running');assert.equal(calls[0].input.cover.verticalUrl,params.cover.verticalUrl);assert.equal(calls[0].input.description,'正文');
 w.deliveries.push({id:'u',input:{...params,sourceUrl:w.sourceUrl,platform:'douyin',requestId:'unknown-request',mode:'publish'},state:'unknown',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 await assert.rejects(distribution.executeWorkDouyin(w,{...params,title:'改了也不能绕过',action:'publish',confirmPublish:true}),/previous_result_unresolved/);
}));
test('explicit publication web grant is separate from both old draft/editor grants and preserves their scopes',fixture(async(load)=>{
 const previous=process.env.VIDEO_WORKS_MCP_TOKEN;process.env.VIDEO_WORKS_MCP_TOKEN='isolated-publisher-scope';
 try{const access=load('lib/video-works/web-access.ts');for(const [flags,expected] of [[{},'works'],[{includeContentEditing:true},'works_editor'],[{includeDouyinPublishing:true},'works_publisher']]){
 const result=access.issueVideoWorksWebAccess({confirmWebAccess:true,...flags}),code=new URLSearchParams(new URL(result.url).hash.slice(1)).get('access'),cookie=access.consumeVideoWorksWebAccess(code).split(';')[0];assert.equal(access.videoWorksWebScope(new Request('https://auto-parse-v2.vyibc.com',{headers:{cookie}})),expected);
 }}finally{if(previous===undefined)delete process.env.VIDEO_WORKS_MCP_TOKEN;else process.env.VIDEO_WORKS_MCP_TOKEN=previous}
}));

test('Douyin page route only accepts its dedicated publisher scope, rejects CSRF and unknown fields before execution',fixture(async(load)=>{
 const store=load('lib/video-works/store.ts'),id=register(store),ctx={params:Promise.resolve({id})};let calls=0;
 const api=loader({'lib/video-works/store.ts':store,'lib/video-works/auth.ts':{workScope:req=>req.headers.get('x-fixture-scope'),workSameOrigin:req=>req.headers.get('origin')==='https://auto-parse-v2.vyibc.com'},'lib/video-works/distribution.ts':{douyinPlan:()=>({accountId:'53017623213'}),getWorkDouyinStatus:async()=>null,executeWorkDouyin:async()=>{calls++;return {operation:{state:'running'}}}}})('app/api/video-works/[id]/douyin/route.ts');
 const post=(scope,body={action:'publish',confirmPublish:true},origin='https://auto-parse-v2.vyibc.com')=>new Request('https://auto-parse-v2.vyibc.com/api/video-works/'+id+'/douyin',{method:'POST',headers:{'content-type':'application/json',origin,...scope?{'x-fixture-scope':scope}:{}},body:JSON.stringify(body)});
 for(const scope of [null,'works','works_editor'])assert.equal((await api.POST(post(scope),ctx)).status,401);
 assert.equal(calls,0);assert.equal((await api.POST(post('works_publisher',{},'https://evil.test'),ctx)).status,403);
 assert.equal((await api.POST(post('works_publisher',{action:'publish',location:'unimplemented'}),ctx)).status,409);assert.equal(calls,0);
 assert.equal((await api.POST(post('works_publisher'),ctx)).status,200);assert.equal(calls,1);
}));
