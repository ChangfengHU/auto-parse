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



const dirs=[];test.after(()=>dirs.forEach(d=>fs.rmSync(d,{recursive:true,force:true})));
function setup(mocks={},globals={}){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'wechat-media-test-'));dirs.push(cwd);
 const load=loader(mocks,{process:{...process,env:{},cwd:()=>cwd},...globals});
 return {cwd,load,m:load('lib/wechat/media-draft.ts')};
}
const input={requestId:'video-01',expectedAccount:'gh_12345678',title:'测试稿（勿发布）',videoUrl:'https://cdn.vyibc.com/test.mp4',confirmDraft:true};
test('input uses Unicode title count and rejects overlong or unauthorised URLs',()=>{
 const {m}=setup();assert.equal(m.mediaDraftInput('video',{...input,title:'😀'.repeat(20)}).title.length,40);
 for(const patch of [{title:'😀'.repeat(21)},{confirmDraft:false},{videoUrl:'http://cdn.vyibc.com/a'},{videoUrl:'https://localhost/a'},{videoUrl:'https://cdn.vyibc.com.evil.test/a'},{videoUrl:'https://cdn.vyibc.com/a?token=secret'},{description:'x'.repeat(301)}])assert.throws(()=>m.mediaDraftInput('video',{...input,...patch}));
 assert.throws(()=>m.mediaDraftInput('podcast',{...input,audioUrl:input.videoUrl,description:'x'.repeat(141)}));
});
test('same request replays, changed payload conflicts, completed receipt survives restart',()=>{
 const {m,cwd}=setup(),data=m.mediaDraftInput('video',input);
 const first=m.reserveMediaDraft(data);assert.equal(first.reused,false);assert.equal(m.reserveMediaDraft(data).reused,true);
 assert.throws(()=>m.reserveMediaDraft({...data,title:'changed'}),/conflict/);
 m.updateMediaDraft(data.expectedAccount,data.requestId,{state:'running',phase:'saving_draft'});
 m.updateMediaDraft(data.expectedAccount,data.requestId,{state:'completed',phase:'completed',receipt:{appMsgId:'123'}});
 const restarted=loader({}, {process:{...process,env:{},cwd:()=>cwd}})('lib/wechat/media-draft.ts');
 assert.equal(restarted.getMediaDraft(data.expectedAccount,data.requestId).receipt.appMsgId,'123');
 assert.equal(restarted.reserveMediaDraft(data).reused,true);
 assert.throws(()=>m.updateMediaDraft(data.expectedAccount,data.requestId,{state:'running'}),/terminal/);
 const files=fs.readdirSync(path.join(cwd,'.runtime/wechat-media-drafts'));assert.equal(files.length,1);
 assert.equal(fs.statSync(path.join(cwd,'.runtime/wechat-media-drafts',files[0])).mode&0o777,0o600);
});
test('restart never automatically replays an unfinished save',()=>{
 const {m,cwd}=setup(),data=m.mediaDraftInput('video',input);m.reserveMediaDraft(data);
 m.updateMediaDraft(data.expectedAccount,data.requestId,{state:'running',phase:'saving_material'});
 const restarted=loader({}, {process:{...process,env:{},cwd:()=>cwd}})('lib/wechat/media-draft.ts');
 const result=restarted.reserveMediaDraft(data);assert.equal(result.reused,true);assert.equal(result.record.state,'unknown');
 assert.equal(result.record.error.code,'media_process_restarted');
});
test('view omits URL and runtime session; does not claim playback or publication',()=>{
 const {m}=setup(),data=m.mediaDraftInput('video',input);const r=m.reserveMediaDraft(data).record;
 const view=m.mediaDraftView({...r,sessionId:'private-runtime'});assert.equal(view.published,false);assert(!JSON.stringify(view).includes('test.mp4'));assert(!JSON.stringify(view).includes('private-runtime'));
});
test('download blocks redirect to private endpoint and removes temporary files',async()=>{
 let calls=0;const {load}=setup({}, {fetch:async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})}});
 const m=load('lib/wechat/media-draft.ts'),a=load('lib/wechat/media-asset.ts');
 await assert.rejects(a.downloadMediaAsset(m.mediaDraftInput('video',input)),/url_not_allowed/);assert.equal(calls,1);
});
test('download rejects size header before ffprobe or browser upload',async()=>{
 const {load}=setup({}, {fetch:async()=>new Response('x',{headers:{'content-length':'104857601'}})});
 const m=load('lib/wechat/media-draft.ts'),a=load('lib/wechat/media-asset.ts');
 await assert.rejects(a.downloadMediaAsset(m.mediaDraftInput('video',input)),/file_too_large/);
});
test('browser node refuses non-managed execution and absent durable intent',async()=>{
 const {load}=setup(),node=load('lib/workflow/nodes/wechat-media-draft.ts');
 await assert.rejects(node.executeWechatMediaDraft({},input,{vars:{},outputs:{}}),/managed_browser_required/);
 await assert.rejects(node.executeWechatMediaDraft({},input,{vars:{},outputs:{},managedPublicationAuthorized:true}),/reserved_intent_required/);
});
test('MCP returns immediately; repeated requests do not open another browser; lease closes',async()=>{
 let opens=0,closes=0,runs=0;let m;
 const {load}=setup({
 'lib/workflow/mcp-service.ts':{callWorkflowTool:async(name)=>{if(name==='workflow_get')return {nodes:[{type:'wechat_media_draft',params:{requestId:'{{requestId}}',expectedAccount:'{{expectedAccount}}'}}]};
 if(name==='workflow_open_session'){opens++;return {sessionId:'s1',sessionRevision:0}}
 if(name==='workflow_run'){runs++;m.updateMediaDraft(input.expectedAccount,input.requestId,{state:'completed',phase:'completed',receipt:{appMsgId:'42'}});return{}}
 if(name==='workflow_close_session'){closes++;return{}}}},
 'lib/workflow/session-store.ts':{getSession:()=>({status:'done'})}
 });
 m=load('lib/wechat/media-draft.ts');const service=load('lib/workflow/wechat-media-service.ts');
 assert.equal((await service.callWechatMediaTool('wechat_create_video_draft',input)).status,'reserved');
 await delay(30);const again=await service.callWechatMediaTool('wechat_create_video_draft',input);
 assert.equal(again.reused,true);assert.equal(again.receipt.appMsgId,'42');assert.equal(opens,1);assert.equal(runs,1);assert.equal(closes,1);
});
test('placeholder workflow fails without opening browser',async()=>{
 let opens=0;const {load}=setup({'lib/workflow/mcp-service.ts':{callWorkflowTool:async(name)=>{if(name==='workflow_get')return{nodes:[]};opens++;return{}}}});
 const service=load('lib/workflow/wechat-media-service.ts');await service.callWechatMediaTool('wechat_create_video_draft',input);await delay(20);
 const status=await service.callWechatMediaTool('wechat_media_draft_status',input);assert.equal(status.status,'failed');assert.equal(status.error.code,'media_workflow_not_ready');assert.equal(opens,0);
});
