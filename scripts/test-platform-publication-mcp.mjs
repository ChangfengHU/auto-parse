import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
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
    }, global: shared, console, process, Buffer, URL, Request, Response, Headers, AbortSignal, setTimeout, clearTimeout, performance, structuredClone, crypto: globalThis.crypto, ...globals };
    vm.runInNewContext(source, sandbox, { filename: file });
    return loadedModule.exports;
  }
  return load;
}

const contract=loader()('lib/workflow/platform-mcp-contract.ts');
const platforms=['douyin','xiaohongshu','x'],env={WORKFLOW_MCP_TOKEN:'fixture-workflow-only'};
for(const p of platforms)test(p+' has a distinct scoped credential and a restricted catalog',()=>{
 const t=contract.platformMcpToken(p,env);
 assert.notEqual(t,env.WORKFLOW_MCP_TOKEN);
 const req=(token,origin)=>new Request('https://auto-parse-v2.vyibc.com/api/publish/mcp/'+p,{headers:{authorization:'Bearer '+token,...origin?{origin}:{}}});
 assert.equal(contract.authorizePlatformMcp(req(t),p,env),200);
 assert.equal(contract.authorizePlatformMcp(req(t,'https://evil.test'),p,env),403);
 assert.equal(contract.authorizePlatformMcp(req(env.WORKFLOW_MCP_TOKEN),p,env),401);
 assert.equal(contract.authorizePlatformMcp(req(t),p,{}),503);
 for(const other of platforms.filter(v=>v!==p))assert.equal(contract.authorizePlatformMcp(req(contract.platformMcpToken(other,env)),p,env),401);
 const names=contract.platformMcpTools(p).map(t=>t.name);
 for(const n of ['workflow_create','workflow_update','workflow_set_session_nodes','workflow_save_session','workflow_node_catalog'])assert(!names.includes(n));
 assert.equal(names.includes('x_publication_status'),p==='x');
 assert.equal(names.includes('publish_video'),p==='douyin');
});
function runtime(deferClose=false){
 let serial=0;const sessions=new Map(),calls=[],starts=[],tasks=new Map();
 const load=loader({
 'lib/workflow/mcp-service.ts':{callWorkflowTool:async(name,input)=>{
  calls.push({name,input});
  if(name==='workflow_get')return{id:input.workflowId,name:'fixture',nodes:[],vars:[],updatedAt:'fixture'};
  if(name==='workflow_capabilities')return{sessionIdleMinutes:20,imageTextPublication:{platforms:['xhs','douyin']},xPublication:{maxImages:1}};
  if(name==='workflow_open_session'){const id='session-'+(++serial);sessions.set(id,{workflowId:input.workflowId});return{sessionId:id};}
  if(name==='workflow_close_session'||name==='workflow_stop'){if(!deferClose)sessions.delete(input.sessionId);return{status:deferClose?'stopping':'closed'};}
  return{name,...input};
 }},
 'lib/workflow/session-store.ts':{getSession:id=>sessions.get(id)},
 'lib/workflow/douyin-workflow-service.ts':{DOUYIN_WORKFLOW_ID:'approved-douyin',startDouyinWorkflow:async p=>{starts.push(p);return{taskId:'video-1'};}},
 'lib/workflow/workflow-task-cli.ts':{getWorkflowTask:id=>tasks.get(id),getWorkflowTaskSummary:id=>({taskId:id})},
 'lib/workflow/douyin-reconcile.ts':{reconcileDouyinTask:async(id,awemeId)=>({awemeId})},
 });
 return{call:load('lib/workflow/platform-mcp-service.ts').callPlatformTool,sessions,calls,starts,tasks};
}
for(const p of platforms)test(p+' lists only approved workflows and rejects foreign workflow IDs before browser access',async()=>{
 const r=runtime(),rows=await r.call(p,'workflow_list',{});
 assert.deepEqual(Array.from(rows.items,w=>w.id),Object.keys(contract.PLATFORM_WORKFLOWS[p]));
 const foreign=Object.keys(contract.PLATFORM_WORKFLOWS[platforms.find(v=>v!==p)])[0];
 const before=r.calls.length;
 await assert.rejects(r.call(p,'workflow_get',{workflowId:foreign}),/platform_workflow_not_allowed/);
 await assert.rejects(r.call(p,'workflow_open_session',{workflowId:foreign,browserInstance:1}),/platform_workflow_not_allowed/);
 assert.equal(r.calls.length,before);
 const id=Object.keys(contract.PLATFORM_WORKFLOWS[p])[0],instance=contract.PLATFORM_WORKFLOWS[p][id];
 await assert.rejects(r.call(p,'workflow_open_session',{workflowId:id,browserInstance:instance===1?2:1}),/platform_browser_mismatch/);
});
test('sessions belong to the endpoint that opened them; cross-platform and general-runtime sessions are rejected',async()=>{
 const r=runtime(),id=Object.keys(contract.PLATFORM_WORKFLOWS.x)[0];
 const opened=await r.call('x','workflow_open_session',{workflowId:id,browserInstance:2});
 await r.call('x','workflow_get_session',{sessionId:opened.sessionId});
 for(const p of ['douyin','xiaohongshu'])await assert.rejects(r.call(p,'workflow_get_session',{sessionId:opened.sessionId}),/platform_session_not_owned/);
 r.sessions.set('generic-session',{workflowId:id});
 await assert.rejects(r.call('x','workflow_run',{sessionId:'generic-session'}),/platform_session_not_owned/);
 await r.call('x','workflow_close_session',{sessionId:opened.sessionId});
 await assert.rejects(r.call('x','workflow_get_session',{sessionId:opened.sessionId}),/platform_session_not_owned/);
});
test('expired session is an unknown-result recovery boundary, not a new execution',async()=>{
 const r=runtime(),id=Object.keys(contract.PLATFORM_WORKFLOWS.x)[0];
 const opened=await r.call('x','workflow_open_session',{workflowId:id,browserInstance:2});
 r.sessions.delete(opened.sessionId);
 const before=r.calls.length;
 await assert.rejects(r.call('x','workflow_run',{sessionId:opened.sessionId}),/expired_do_not_retry/);
 assert.equal(r.calls.length,before);
});
test('Douyin video adapter projects explicit approval and never starts in another platform',async()=>{
 const r=runtime(),input={accountId:'fixture',videoUrl:'https://resource.vyibc.com/fixture.mp4',title:'fixture',requestId:'fixture-request',aiGenerated:true};
 await r.call('douyin','prepare_video',input);assert.equal(r.starts[0].prepareOnly,true);assert.equal(r.starts[0].confirmPublish,false);
 await r.call('douyin','publish_video',{...input,confirmPublish:true});assert.equal(r.starts[1].prepareOnly,false);assert.equal(r.starts[1].confirmPublish,true);
 await assert.rejects(r.call('xiaohongshu','publish_video',input),/platform_tool_not_allowed/);
 r.tasks.set('foreign',{workflowId:'foreign'});
 await assert.rejects(r.call('douyin','get_video_task',{taskId:'foreign'}),/platform_video_task_not_found/);
 r.tasks.set('valid',{workflowId:'approved-douyin',taskId:'valid',steps:[],status:'running'});
 assert.equal((await r.call('douyin','get_video_task',{taskId:'valid'})).status,'running');
});
test('X status is read-only and X-only',async()=>{
 const r=runtime();await r.call('x','x_publication_status',{});
 assert.equal(r.calls[0].name,'x_publication_status');
 await assert.rejects(r.call('douyin','x_publication_status',{}),/platform_tool_not_allowed/);
});
test('HTTP endpoint scopes identity, rejects cross credentials and validates publication confirmation',async()=>{
 const old=process.env.WORKFLOW_MCP_TOKEN;process.env.WORKFLOW_MCP_TOKEN=env.WORKFLOW_MCP_TOKEN;
 try{
  const route=loader({'lib/workflow/platform-mcp-service.ts':{callPlatformTool:async()=>({ok:true})}})('lib/workflow/platform-mcp-route.ts');
  const req=(p,method,params,token=contract.platformMcpToken(p,env))=>new Request('https://auto-parse-v2.vyibc.com/api/publish/mcp/'+p,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  for(const p of platforms){
   const init=await (await route.handlePlatformMcp(req(p,'initialize',{}),p)).json();
   assert.equal(init.result.serverInfo.name,'auto-parse-'+p+'-publish');
   assert.equal((await route.handlePlatformMcp(req(p,'tools/list',{},'wrong'),p)).status,401);
  }
  assert.equal((await route.handlePlatformMcp(req('x','tools/list',{}),'unknown')).status,404);
  const denied=await (await route.handlePlatformMcp(req('x','tools/call',{name:'publish_video',arguments:{}}),'x')).json();assert.equal(denied.error.code,-32602);
  const invalid=await (await route.handlePlatformMcp(req('douyin','tools/call',{name:'publish_video',arguments:{accountId:'a',title:'t',videoUrl:'u',aiGenerated:true,requestId:'r',confirmPublish:false}}),'douyin')).json();assert.equal(invalid.error.code,-32602);
 }finally{if(old===undefined)delete process.env.WORKFLOW_MCP_TOKEN;else process.env.WORKFLOW_MCP_TOKEN=old;}
});

test('an in-flight stop preserves ownership until asynchronous cleanup finishes',async()=>{
 const r=runtime(true),id=Object.keys(contract.PLATFORM_WORKFLOWS.x)[0];
 const opened=await r.call('x','workflow_open_session',{workflowId:id,browserInstance:2});
 assert.equal((await r.call('x','workflow_stop',{sessionId:opened.sessionId})).status,'stopping');
 await r.call('x','workflow_get_session',{sessionId:opened.sessionId});
 await assert.rejects(r.call('xiaohongshu','workflow_get_session',{sessionId:opened.sessionId}),/platform_session_not_owned/);
 r.sessions.delete(opened.sessionId);
 await assert.rejects(r.call('x','workflow_get_session',{sessionId:opened.sessionId}),/expired_do_not_retry/);
});

test('wechat permits only its preparation workflow',async()=>{
 const r=runtime(),id=Object.keys(contract.PLATFORM_WORKFLOWS.wechat)[0];
 const rows=await r.call('wechat','workflow_list',{});
 assert.deepEqual(Array.from(rows.items,w=>w.id),[id]);
 await assert.rejects(r.call('wechat','workflow_get',{workflowId:Object.keys(contract.PLATFORM_WORKFLOWS.x)[0]}),/platform_workflow_not_allowed/);
 await assert.rejects(r.call('wechat','workflow_open_session',{workflowId:id,browserInstance:2}),/platform_browser_mismatch/);
});
