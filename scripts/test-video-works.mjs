import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash,createHmac} from 'node:crypto';
import {createRequire,stripTypeScriptTypes} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
const root=path.resolve(new URL('..',import.meta.url).pathname);
function loader(mocks={}){
 const cache=new Map();const load=file=>{
 if(mocks[file])return mocks[file];if(cache.has(file))return cache.get(file);
 const mod={exports:{}};cache.set(file,mod.exports);
 const source=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const sandbox={module:mod,exports:mod.exports,require:n=>{if(mocks[n])return mocks[n];
  if(n.startsWith('.')||n.startsWith('@/'))return load((n.startsWith('@/')?n.slice(2):path.normalize(path.join(path.dirname(file),n)))+(n.endsWith('.ts')?'':'.ts'));
  return require(n);
 },process,console,Buffer,URL,Request,Response,Headers,ReadableStream,AbortSignal,crypto:globalThis.crypto,setTimeout,clearTimeout};
 vm.runInNewContext(source,sandbox,{filename:file});cache.set(file,mod.exports);return mod.exports;
 };return load;
}
test('permanent video works: original fidelity, platform isolation, retry conflicts, receipt truth and recovery',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'video-works-test-')),previous=process.env.VIDEO_WORKS_DATA_DIR;
 process.env.VIDEO_WORKS_DATA_DIR=path.join(dir,'archive');
 try{
 const source=stripTypeScriptTypes(fs.readFileSync(path.join(root,'lib/video-works/store.ts'),'utf8'),{mode:'transform'});
 const store=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const p={platform:'douyin',accountId:'53017623213',requestId:'fixture-request-123',sourceUrl:'https://resource.vyibc.com/fixture.mp4',title:'Original title',description:'Original description',topics:['test'],aiGenerated:true,mode:'prepare'};
 const first=store.recordVideoDelivery(p,{state:'reserved'});
 assert.equal(store.recordVideoDelivery(p).id,first.id);
 assert.throws(()=>store.recordVideoDelivery({...p,title:'changed'}),/conflict/);
 assert.throws(()=>store.recordVideoDelivery({...p,requestId:'different',sourceUrl:'https://evil.test/clip.mp4'}),/source_invalid/);
 const task={taskId:'fixture-task',startedAt:Date.now(),status:'done',workflow:{nodes:[{params:{douyinPublication:{requestId:p.requestId,expectedAccountId:p.accountId,videoUrl:p.sourceUrl,title:p.title,description:p.description,topics:p.topics,aiGenerated:true,prepareOnly:true}}}]},steps:[{output:{prepared:true}}]};
 store.syncVideoWorkflowTask(task);
 assert.equal(store.deliveryByTaskId(task.taskId).state,'prepared');
 assert.equal(store.deliveryByTaskId(task.taskId).receipt,undefined,'prepared is not a saved cloud draft or receipt');
 store.syncVideoWorkflowTask({...task,publication:{awemeId:'7700832043915119881',moderation:'reviewing'}});
 assert.equal(store.deliveryByTaskId(task.taskId).state,'published');
 assert.equal(store.deliveryByTaskId(task.taskId).receipt.workId,'7700832043915119881');
 store.syncVideoWorkflowTask({...task,status:'running',steps:[]});
 assert.equal(store.deliveryByTaskId(task.taskId).state,'published','later task ticks cannot erase a real receipt');
 const wp={kind:'video',requestId:'wechat-fixture',expectedAccount:'account_fixture',sourceUrl:p.sourceUrl,title:'Wechat title',description:'description'};
 store.syncWechatVideoDraft({input:wp,state:'completed',receipt:{appMsgId:'1234',saveResponseAccepted:true}});
 assert.equal(store.allVideoDeliveries().find(d=>d.input.platform==='wechat').state,'unknown');
 store.syncWechatVideoDraft({input:wp,state:'completed',receipt:{appMsgId:'1234',saveResponseAccepted:true,nativeEditorReloadVerified:true}});
 assert.equal(store.allVideoDeliveries().find(d=>d.input.platform==='wechat').state,'draft_saved');
 assert.equal(store.listVideoWorks().total,1);
 assert.equal(store.listVideoWorks().items[0].deliveries.length,2);
 assert.equal(store.listVideoWorks({platform:'douyin'}).items[0].deliveries.length,1,'scoped tools must not expose other platform metadata');
 const payload=Buffer.from('original-full-quality-video-fixture'.repeat(7000)),local=path.join(dir,'original.mp4');fs.writeFileSync(local,payload);
 const backup=await store.retainVideoOriginal(p.sourceUrl,local);
 assert.equal(backup.sha256,createHash('sha256').update(payload).digest('hex'));
 assert.deepEqual(fs.readFileSync(store.retainedVideoPathForSource(p.sourceUrl)),payload,'original is copied byte-for-byte without transcoding');
 const sameBytes={...p,requestId:'another-source',sourceUrl:'https://cdn.vyibc.com/other.mp4'};store.recordVideoDelivery(sameBytes);
 await store.retainVideoOriginal(sameBytes.sourceUrl,local);
 assert.equal(store.listVideoWorks().total,1,'same original content groups into one work');
 assert.equal(store.getVideoWork(createHash('sha256').update(p.sourceUrl).digest('hex')).sha256,backup.sha256,'old work links survive content hashing');
 assert.equal(store.listVideoWorks({q:'Original description'}).total,1);
 const call=loader({'lib/workflow/mcp-service.ts':{},'lib/workflow/session-store.ts':{},'lib/workflow/douyin-workflow-service.ts':{DOUYIN_WORKFLOW_ID:'approved'},'lib/workflow/workflow-task-cli.ts':{getWorkflowTask:()=>null},'lib/video-works/store.ts':store})('lib/workflow/platform-mcp-service.ts').callPlatformTool;
 const recovered=await call('douyin','get_video_task',{taskId:'fixture-task'});
 assert.equal(recovered.workflowExecution,null);
 assert.equal(recovered.archive.receipt.workId,'7700832043915119881','permanent receipt survives missing 7-day task cache');
 await assert.rejects(call('x','list_video_works',{}),/not_allowed/);
 }finally{if(previous===undefined)delete process.env.VIDEO_WORKS_DATA_DIR;else process.env.VIDEO_WORKS_DATA_DIR=previous;fs.rmSync(dir,{recursive:true,force:true})}
});
test('work center: scoped login, forged cookies, request origin and platform permissions',async()=>{
 const old=process.env.AUTO_PARSE_ADMIN_TOKEN;process.env.AUTO_PARSE_ADMIN_TOKEN='test-admin-only';
 try{
 const auth=loader({'lib/workflow/platform-mcp-contract.ts':{authorizePlatformMcp:req=>req.headers.get('authorization')==='Bearer test-douyin-only'?200:401}})('lib/video-works/auth.ts');
 const req=(token,origin='https://auto-parse-v2.vyibc.com')=>new Request('https://auto-parse-v2.vyibc.com/api/video-works',{headers:{authorization:'Bearer '+token,origin}});
 assert.equal(auth.workScope(req('bad')),null);assert.equal(auth.workScope(req('test-admin-only')),'admin');assert.equal(auth.workScope(req('test-douyin-only')),'douyin');
 const cookie=auth.workSessionCookie('douyin').split(';')[0];
 assert.equal(auth.workScope(new Request('https://auto-parse-v2.vyibc.com',{headers:{cookie}})),'douyin');
 assert.equal(auth.workScope(new Request('https://auto-parse-v2.vyibc.com',{headers:{cookie:cookie+'bad'}})),null);
 assert.equal(auth.workSameOrigin(req('test-admin-only','https://evil.test')),false);
 const payload=Buffer.from(JSON.stringify({scope:'admin',expires:Date.now()-1})).toString('base64url'),sig=createHmac('sha256','test-admin-only').update('video-work-v1:'+payload).digest('base64url');
 assert.equal(auth.workScope(new Request('https://auto-parse-v2.vyibc.com',{headers:{cookie:'__Host-video-work-session='+payload+'.'+sig}})),null);
 let calls=0;
 const api=loader({'lib/video-works/auth.ts':auth,'lib/video-works/store.ts':{listVideoWorks:o=>({items:[],scopePlatform:o.platform}),getVideoWork:()=>({sourceUrl:'https://resource.vyibc.com/test.mp4',deliveries:[{input:{title:'test',description:'text',topics:[],aiGenerated:true}}]})},'lib/workflow/platform-mcp-service.ts':{callPlatformTool:async()=>{calls++;return {ok:true}}}})('app/api/video-works/route.ts');
 assert.equal((await api.GET(req('bad'))).status,200,'owner requested direct read without connection');
 assert.equal((await api.POST(new Request('https://auto-parse-v2.vyibc.com/api/video-works',{method:'POST',headers:{origin:'https://auto-parse-v2.vyibc.com','content-type':'application/json'},body:JSON.stringify({action:'prepare',confirmPrepare:true})}))).status,401,'public reading must not authorize any write');
 assert.equal((await(await api.GET(req('test-douyin-only'))).json()).scopePlatform,'douyin');
 const post=(platform,token='test-douyin-only')=>new Request('https://auto-parse-v2.vyibc.com/api/video-works',{method:'POST',headers:{authorization:'Bearer '+token,origin:'https://auto-parse-v2.vyibc.com','content-type':'application/json'},body:JSON.stringify({action:'prepare',confirmPrepare:true,platform,workId:'a'.repeat(64),accountId:'account',requestId:'request',title:'test'})});
 assert.equal((await api.POST(post('wechat'))).status,403);assert.equal(calls,0);
 assert.equal((await api.POST(post('douyin'))).status,200);assert.equal(calls,1);
 assert.equal((await api.POST(post('wechat','test-admin-only'))).status,200);assert.equal(calls,2);
 const restricted=loader({'lib/video-works/auth.ts':{workScope:()=> 'works',workSameOrigin:()=>true},'lib/video-works/store.ts':{},'lib/workflow/platform-mcp-service.ts':{callPlatformTool:async()=>{calls++;return {}}}})('app/api/video-works/route.ts');assert.equal((await restricted.POST(post('douyin'))).status,403);assert.equal(calls,2,'works cookie cannot call legacy platform preparation');
 }finally{if(old===undefined)delete process.env.AUTO_PARSE_ADMIN_TOKEN;else process.env.AUTO_PARSE_ADMIN_TOKEN=old}
});
test('original download is directly viewable, supports byte ranges, and cannot read arbitrary paths',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'video-work-file-test-')),name='b'.repeat(64),work={archive:{sha256:name,bytes:10}};
 fs.writeFileSync(path.join(dir,name+'.mp4'),'0123456789');
 try{
 const api=loader({'lib/video-works/auth.ts':{workScope:req=>req.headers.get('authorization')==='Bearer fixture'?'douyin':null},'lib/video-works/store.ts':{videoFileDirectory:()=>dir,getVideoWork:(id,scope)=>{if(scope!==undefined)assert.equal(scope,'douyin');return id==='a'.repeat(64)?work:null}}})('app/api/video-works/[id]/file/route.ts');
 const get=(range,authorized=true,id='a'.repeat(64))=>api.GET(new Request('https://auto-parse-v2.vyibc.com/api/video-works/'+id+'/file',{headers:{...(authorized?{authorization:'Bearer fixture'}:{}),...(range?{range}:{})}}),{params:Promise.resolve({id})});
 assert.equal((await get(null,false)).status,200,'owner requested direct original viewing');
 assert.equal((await get(null,true,'../private')).status,404);
 const partial=await get('bytes=2-5');assert.equal(partial.status,206);assert.equal(partial.headers.get('content-range'),'bytes 2-5/10');assert.equal(await partial.text(),'2345');
 const suffix=await get('bytes=-3');assert.equal(await suffix.text(),'789');
 assert.equal((await get('bytes=999-')).status,416);
 const all=await get();assert.equal(all.headers.get('cache-control'),'private, no-store');assert.equal(await all.text(),'0123456789');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('WeChat reuse reads retained original when public source is gone, still checks codec and limits',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'video-work-reuse-test-')),source=path.join(dir,'original.mp4');fs.writeFileSync(source,'full-resolution-fixture');
 try{
 const load=loader({'lib/video-works/store.ts':{retainedVideoPathForSource:()=>source},'lib/wechat/media-draft.ts':{MEDIA_MAX_BYTES:100*1024*1024,mediaAssetUrl:()=>{throw Error('expired URL must not be downloaded when original is retained')}},'node:util':{promisify:()=>async()=>({stdout:JSON.stringify({format:{duration:'5',format_name:'mov,mp4,m4a,3gp,3g2,mj2'},streams:[{codec_type:'video',codec_name:'h264'}]})})}});
 const {downloadMediaAsset}=load('lib/wechat/media-asset.ts');
 const result=await downloadMediaAsset({kind:'video',sourceUrl:'https://resource.vyibc.com/expired.mp4'});
 assert.equal(fs.readFileSync(result.filename,'utf8'),'full-resolution-fixture');assert.equal(result.size,fs.statSync(source).size);await result.cleanup();assert.equal(fs.existsSync(result.filename),false);assert.equal(fs.existsSync(source),true,'temporary cleanup must preserve permanent archive');
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('independent works register without fake platform deliveries and reuse a retained original for idempotent WeChat drafts',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'independent-work-test-')),old=process.env.VIDEO_WORKS_DATA_DIR;
 process.env.VIDEO_WORKS_DATA_DIR=dir;
 let store;const calls=[];let status='completed';
 const native={callWechatMediaTool:async(name,input)=>{
  calls.push({name,input});
  if(name==='wechat_media_draft_status')return{found:true,status,phase:status==='unknown'?'process_restarted':'completed',receipt:status==='completed'?{appMsgId:'1000001',saveResponseAccepted:true,nativeEditorReloadVerified:true}:undefined};
  store.syncWechatVideoDraft({input:{kind:'video',requestId:input.requestId,expectedAccount:input.expectedAccount,sourceUrl:input.videoUrl,title:input.title,description:input.description},state:'completed',receipt:{appMsgId:'1000001',saveResponseAccepted:true,nativeEditorReloadVerified:true}});
  return{found:true,status:'completed',receipt:{appMsgId:'1000001',saveResponseAccepted:true,nativeEditorReloadVerified:true}};
 }};
 try{
 const load=loader({'lib/workflow/wechat-media-service.ts':native});store=load('lib/video-works/store.ts');const service=load('lib/video-works/service.ts'),contract=load('lib/video-works/mcp-contract.ts');
 const input={sourceUrl:'https://cdn.vyibc.com/unpublished-fixture.mp4',title:'这个原始标题超过二十字需要代理自动重新拟定标题',description:'原始文案保留',topics:['原创'],aiGenerated:true,confirmRecord:true};
 const registered=service.registerIndependentWork(input);
 assert.equal(registered.published,false);assert.equal(store.allVideoDeliveries().length,0,'registration must never fabricate a platform delivery');
 assert.equal(store.listVideoWorks({state:'registered'}).total,1);
 assert.equal(store.listVideoWorks({platform:'douyin'}).total,0,'platform MCP must not expose unpublished independent works');
 const file=path.join(dir,'test.mp4');fs.writeFileSync(file,'original byte fidelity fixture');
 await store.retainVideoOriginal(input.sourceUrl,file);
 const w=store.getVideoWork(registered.work.id);assert(w.archive);assert.equal(w.deliveries.length,0);
 assert.equal(service.registerIndependentWork(input).reused,true);assert.equal(store.listVideoWorks().total,1);
 store.syncWechatVideoDraft({input:{kind:'video',requestId:'existing-account-proof',expectedAccount:'gh_123456789012',sourceUrl:'https://cdn.vyibc.com/account-proof.mp4',title:'已验证账号',description:''},state:'completed',receipt:{appMsgId:'999999',saveResponseAccepted:true,nativeEditorReloadVerified:true}});
 const plan=service.prepareWorkWechatDraft({workId:w.id});
 assert.equal(plan.expectedAccount,'gh_123456789012');assert.equal(plan.needsAdaptation,true);assert.equal(plan.videoUrl,input.sourceUrl);
 const adapt=await service.createWorkWechatDraft({workId:w.id,confirmDraft:true});assert.equal(adapt.created,false);assert.equal(calls.length,0,'overlong metadata must be adapted before browser side effects');
 const draftInput={workId:w.id,title:'独立作品视频草稿测试',description:'代理适配的公众号文案',confirmDraft:true};
 await assert.rejects(service.createWorkWechatDraft({...draftInput,confirmDraft:false}),/confirmation/);
 const first=await service.createWorkWechatDraft(draftInput),second=await service.createWorkWechatDraft(draftInput);
 assert.equal(first.publiclyPublished,false);assert.equal(second.reused,true);assert.equal(first.requestId,second.requestId);
 assert.equal(calls.filter(c=>c.name==='wechat_create_video_draft').length,1,'the same work and metadata must not create a second draft');
 assert.equal(store.getVideoWork(w.id).title,input.title,'platform adaptation must preserve original master title');
 assert.equal(store.getVideoWork(w.id).deliveries[0].state,'draft_saved');
 status='unknown';await service.createWorkWechatDraft(draftInput);
 assert.equal(calls.filter(c=>c.name==='wechat_create_video_draft').length,1,'unknown native save cannot be resubmitted');
 const hist=service.backfillIndependentWork({...input,sourceUrl:'https://cdn.vyibc.com/historical-fixture.mp4',platformUrl:'https://www.douyin.com/video/1234567890123456789'});
 assert.equal(hist.externalActionsTriggered,false);assert.equal(hist.work.referenceEvidence,'reported_not_verified');assert.equal(hist.work.deliveries.length,0);
 assert.throws(()=>service.backfillIndependentWork({taskId:'../../secret',confirmRecord:true}),/invalid/);
 assert(!contract.VIDEO_WORKS_TOOLS.some(t=>t.name.includes('publish')),'independent work MCP must expose no public publication tool');
 const request=token=>new Request('https://auto-parse-v2.vyibc.com/api/video-works/mcp',{headers:{authorization:'Bearer '+token}});
 assert.equal(contract.authorizeVideoWorksMcp(request('fixture'),{VIDEO_WORKS_MCP_TOKEN:'fixture'}),200);
 assert.equal(contract.authorizeVideoWorksMcp(request('platform-douyin'),{VIDEO_WORKS_MCP_TOKEN:'fixture'}),401);
 assert.equal(contract.authorizeVideoWorksMcp(request('fixture'),{}),503);
 }finally{if(old===undefined)delete process.env.VIDEO_WORKS_DATA_DIR;else process.env.VIDEO_WORKS_DATA_DIR=old;fs.rmSync(dir,{recursive:true,force:true})}
});

test('web draft access is short lived, one use, works-only, and cannot become platform/admin credentials',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'video-work-web-test-')),oldDir=process.env.VIDEO_WORKS_DATA_DIR,oldKey=process.env.VIDEO_WORKS_MCP_TOKEN;
 process.env.VIDEO_WORKS_DATA_DIR=dir;process.env.VIDEO_WORKS_MCP_TOKEN='unit-only-works-key';
 try{
 const load=loader({'lib/workflow/platform-mcp-contract.ts':{authorizePlatformMcp:()=>401}});
 const access=load('lib/video-works/web-access.ts'),auth=load('lib/video-works/auth.ts'),session=load('app/api/video-works/session/route.ts');
 assert.throws(()=>access.issueVideoWorksWebAccess({}),/confirmation/);
 const link=access.issueVideoWorksWebAccess({confirmWebAccess:true}),u=new URL(link.url),code=new URLSearchParams(u.hash.slice(1)).get('access');
 assert.equal(u.search,'');assert.equal(link.oneUse,true);assert(!link.url.includes(process.env.VIDEO_WORKS_MCP_TOKEN));
 assert(Date.parse(link.expiresAt)-Date.now()<=600000);assert(Date.parse(link.sessionExpiresAt)-Date.now()<=28800000);
 const paths=fs.readdirSync(path.join(dir,'web-access'));assert.equal(paths.length,1);assert(!fs.readFileSync(path.join(dir,'web-access',paths[0]),'utf8').includes(code),'only code digest persisted');
 const request=(body,origin='https://auto-parse-v2.vyibc.com')=>new Request('https://auto-parse-v2.vyibc.com/api/video-works/session',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await session.POST(request({code},'https://evil.test'))).status,403,'cross-origin exchange rejected without consuming grant');
 const redeemed=await session.POST(request({code}));assert.equal(redeemed.status,200);
 const cookie=redeemed.headers.get('set-cookie');assert(cookie.includes('HttpOnly'));assert(cookie.includes('Secure'));assert(cookie.includes('SameSite=Strict'));
 const req=new Request(u.origin,{headers:{cookie:cookie.split(';')[0]}});
 assert.equal(auth.workScope(req),'works');assert.equal(auth.workBearerScope(req),null,'browser cookie is not an admin/MCP credential');
 assert.equal((await session.POST(request({code}))).status,401,'one use code cannot be replayed');
 assert.equal(auth.workScope(new Request(u.origin,{headers:{cookie:cookie.split(';')[0]+'tampered'}})),null);
 const record=access.issueVideoWorksWebAccess({confirmWebAccess:true}),expiredCode=new URLSearchParams(new URL(record.url).hash.slice(1)).get('access'),f=path.join(dir,'web-access',createHash('sha256').update(expiredCode).digest('hex')+'.json');
 fs.writeFileSync(f,JSON.stringify({expires:Date.now()-1,sessionExpires:Date.now()+60000,purpose:'wechat_video_draft_only'}));
 assert.throws(()=>access.consumeVideoWorksWebAccess(expiredCode),/expired/);
 assert.equal((await session.DELETE(new Request(u.origin,{method:'DELETE',headers:{origin:'https://evil.test'}}))).status,403);
 const logout=await session.DELETE(new Request(u.origin,{method:'DELETE',headers:{origin:u.origin}}));assert(logout.headers.get('set-cookie').includes('Max-Age=0'));
 }finally{if(oldDir===undefined)delete process.env.VIDEO_WORKS_DATA_DIR;else process.env.VIDEO_WORKS_DATA_DIR=oldDir;if(oldKey===undefined)delete process.env.VIDEO_WORKS_MCP_TOKEN;else process.env.VIDEO_WORKS_MCP_TOKEN=oldKey;fs.rmSync(dir,{recursive:true,force:true})}
});
test('web draft API and MCP share business operations; anonymous, CSRF and public publish payloads fail closed',async()=>{
 let calls=0,captured;const plan={workId:'a'.repeat(64),expectedAccount:'gh_123456789012',title:'原片标题',description:'原文案',requestId:'stable-existing'};
 const service={prepareWorkWechatDraft:()=>plan,getWorkWechatDrafts:async()=>({items:[]}),createWorkWechatDraft:async input=>{calls++;captured=input;return{requestId:'stable-existing',result:{status:'reserved'},publiclyPublished:false}}};
 const api=loader({'lib/video-works/auth.ts':{workScope:req=>req.headers.get('x-test-scope'),workSameOrigin:req=>req.headers.get('origin')==='https://auto-parse-v2.vyibc.com'},'lib/video-works/service.ts':service})('app/api/video-works/[id]/wechat-draft/route.ts');
 const ctx={params:Promise.resolve({id:plan.workId})},request=(scope,p={confirmDraft:true},origin='https://auto-parse-v2.vyibc.com')=>new Request('https://auto-parse-v2.vyibc.com/api/video-works/'+plan.workId+'/wechat-draft',{method:'POST',headers:{...(scope?{'x-test-scope':scope}:{}),origin,'content-type':'application/json'},body:JSON.stringify(p)});
 assert.equal((await api.POST(request(null),ctx)).status,401);assert.equal((await api.POST(request('douyin'),ctx)).status,401);
 assert.equal((await api.POST(request('works',{},'https://evil.test'),ctx)).status,403);assert.equal(calls,0);
 assert.equal((await api.POST(request('works',{confirmDraft:true,publish:true}),ctx)).status,409);
 assert.equal((await api.POST(request('works',{confirmDraft:true,expectedAccount:'other'}),ctx)).status,409);
 assert.equal((await api.POST(request('works',{confirmDraft:true,videoUrl:'https://evil.test/other.mp4'}),ctx)).status,409);
 assert.equal((await api.POST(request('works',{confirmDraft:false}),ctx)).status,409);assert.equal(calls,0);
 const result=await api.POST(request('works',{confirmDraft:true,title:'页面改写',description:'正文'}),ctx);assert.equal(result.status,200);assert.equal(calls,1);assert.equal(captured.workId,plan.workId);assert.equal(captured.confirmDraft,true);assert.equal(captured.expectedAccount,undefined,'page cannot choose another account');
 assert.equal((await api.GET(new Request('https://auto-parse-v2.vyibc.com',{headers:{'x-test-scope':'works'}}),ctx)).status,200);
 assert.equal((await api.GET(new Request('https://auto-parse-v2.vyibc.com'),ctx)).status,401);assert.equal(calls,1,'status read never creates a second draft');
});
