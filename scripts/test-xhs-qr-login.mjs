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
    }, global: shared, console, process, Buffer, URL, Request, Response, Headers, AbortSignal, AbortController, setTimeout, clearTimeout, performance, structuredClone, crypto: globalThis.crypto, ...globals };
    vm.runInNewContext(source, sandbox, { filename: file });
    return loadedModule.exports;
  }
  return load;
}

function qrRuntime(identity){
 let listener;let closed=0,disconnected=0,released=0;const cookies=[{name:'a1',value:'private-a1',domain:'.xiaohongshu.com'},{name:'web_session',value:'private-session',domain:'.xiaohongshu.com'},{name:'other',value:'excluded',domain:'.example.com'}];
 const context={cookies:async()=>cookies,newPage:async()=>page};
 const page={on:(name,fn)=>{listener=fn;},goto:async()=>{if(identity)listener({url:()=> 'https://edith.xiaohongshu.com/api/sns/web/v2/user/me',json:async()=>({success:true,data:identity})});},locator:()=>({count:async()=>1,isVisible:async()=>true,getAttribute:async()=> 'data:image/png;base64,AAAA'}),waitForTimeout:async()=>{},isClosed:()=>closed>0,close:async()=>{closed++;},context:()=>context};
 const browser={contexts:()=>[context],close:async()=>{disconnected++;}};
 const logs=[];const load=loader({'playwright':{chromium:{connectOverCDP:async()=>browser}},'lib/workflow/browser-activity.ts':{acquireManagedBrowserActivity:async()=>async()=>{released++;}}},{console:{info:(...args)=>logs.push(args.join(' '))}});
 const api=load('lib/analysis/xhs-login-utils.ts');
 const emit=async(path,data,host='edith.xiaohongshu.com')=>{listener({url:()=> 'https://'+host+path,json:async()=>data});await delay(1);};
 return {api,emit,cookies,logs,counts:()=>({closed,disconnected,released})};
}
test('real browser QR creates an opaque handle without exposing cookies or third-party QR URLs',async()=>{
 const r=qrRuntime(),q=await r.api.createXhsQr();
 assert.equal(q.backend,'browser');assert.match(q.loginId,/^[a-f0-9-]{36}$/);assert(q.url.startsWith('data:image/'));
 assert(!JSON.stringify(q).includes('private-'));assert(!('a1' in q));assert.equal((await r.api.pollXhsQr(q.loginId)).status_text,'waiting');
 await r.api.cancelXhsQr(q.loginId);assert.equal(r.counts().released,1);
});
test('guest and foreign-host identity responses never complete login',async()=>{
 const r=qrRuntime(),q=await r.api.createXhsQr();
 await r.emit('/api/sns/web/v2/user/me',{success:true,data:{guest:true,user_id:'guest'}});
 await r.emit('/api/sns/web/v2/user/me',{success:true,data:{guest:false,user_id:'victim'}},'xiaohongshu.com.evil.test');
 assert.equal((await r.api.pollXhsQr(q.loginId)).status_text,'waiting');
 await r.api.cancelXhsQr(q.loginId);
});
test('confirmed native identity plus session is required; completion is retry-readable and closes only the task connection',async()=>{
 const r=qrRuntime(),q=await r.api.createXhsQr();
 await r.emit('/api/qrcode/userinfo',{success:true,data:{codeStatus:1}});
 assert.equal((await r.api.pollXhsQr(q.loginId)).status_text,'scanned');
 await r.emit('/api/sns/web/v2/user/me',{success:true,data:{guest:false,user_id:'user-fixture'}});
 const result=await r.api.pollXhsQr(q.loginId);assert.equal(result.status_text,'success');assert.equal(result.cookies.web_session,'private-session');assert(!result.cookies.other);
 assert.equal((await r.api.pollXhsQr(q.loginId)).status_text,'success');
 assert.equal(r.counts().closed,1);assert.equal(r.counts().disconnected,1);assert.equal(r.counts().released,1);
 assert(!r.logs.join('').includes('private-session'));await r.api.cancelXhsQr(q.loginId);
});
test('native upstream error terminates and releases instead of endless polling',async()=>{
 const r=qrRuntime(),q=await r.api.createXhsQr();
 await r.emit('/api/qrcode/userinfo',{success:false,code:-1});
 assert.equal((await r.api.pollXhsQr(q.loginId)).status_text,'failed');assert.equal(r.counts().released,1);await r.api.cancelXhsQr(q.loginId);
});
test('cancelled or missing QR returns expired and cannot report success',async()=>{
 const r=qrRuntime(),q=await r.api.createXhsQr();await r.api.cancelXhsQr(q.loginId);await r.api.cancelXhsQr(q.loginId);
 assert.equal((await r.api.pollXhsQr(q.loginId)).status_text,'expired');assert.equal(r.counts().released,1);
});
test('client polling never overlaps pending requests and ignores late completion after cancellation',async()=>{
 const start=loader()('lib/analysis/xhs-qr-polling.ts').startXhsQrPolling;
 let resolve,calls=0,updates=0;const stop=start(()=>{calls++;return new Promise(r=>resolve=r);},()=>updates++,()=>assert.fail('unexpected error'),2);
 await delay(10);assert.equal(calls,1);stop();resolve({status_text:'waiting'});await delay(10);assert.equal(calls,1);assert.equal(updates,0);
});
test('client terminal state and error stop all future polling',async()=>{
 const start=loader()('lib/analysis/xhs-qr-polling.ts').startXhsQrPolling;
 for(const state of ['success','expired','failed']){
  let calls=0;start(async()=>{calls++;return{status_text:state};},()=>{},()=>assert.fail('unexpected'),2);
  await delay(10);assert.equal(calls,1);
 }
 let errors=0,calls=0;start(async()=>{calls++;throw Error('fixture');},()=>{},()=>errors++,2);await delay(10);assert.equal(calls,1);assert.equal(errors,1);
});
test('public poll persists credentials server-side and never returns raw session cookies',async()=>{
 let stored='';
 const load=loader({'next/server':{NextResponse:{json:Response.json}},'lib/analysis/xhs-login-utils.ts':{pollXhsQr:async()=>({ok:true,status_text:'success',cookies:{a1:'private-a1',web_session:'private-session'}}),xhsQrError:()=>({reason:'safe',error:'safe'})},'lib/analysis/xhs-cookie.ts':{setXhsCookie:c=>stored=c},'lib/analysis/platform-session.ts':{upsertPlatformSession:async()=>{}}});
 const route=load('app/api/analysis/xhs/login/poll/route.ts');
 const res=await route.POST(new Request('https://auto-parse-v2.vyibc.com/api/analysis/xhs/login/poll',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({loginId:'11111111-1111-1111-1111-111111111111'})}));
 const data=await res.json();assert.equal(data.status_text,'success');assert(stored.includes('private-session'));assert(!JSON.stringify(data).includes('private-'));assert(!('cookies' in data));
});
test('legacy cookie-bearing poll requests are rejected without executing login',async()=>{
 let executed=false;
 const load=loader({'next/server':{NextResponse:{json:Response.json}},'lib/analysis/xhs-login-utils.ts':{pollXhsQr:async()=>{executed=true;},xhsQrError:()=>({reason:'safe',error:'safe'})},'lib/analysis/xhs-cookie.ts':{setXhsCookie:()=>{}},'lib/analysis/platform-session.ts':{upsertPlatformSession:async()=>{}}});
 const route=load('app/api/analysis/xhs/login/poll/route.ts');const res=await route.POST(new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({qr_id:'old',cookies:{web_session:'private'}})}));
 assert.equal(res.status,400);assert.equal(executed,false);
});

test('browser synchronization requires a non-guest native identity, returns only the selected domain internally and releases ownership',async()=>{
 const r=qrRuntime({guest:false,user_id:'user-fixture',nickname:'Fixture'});
 const result=await r.api.syncXhsBrowserLogin(2);assert.equal(result.userId,'user-fixture');assert.equal(result.browserInstance,2);assert.equal(result.cookies.web_session,'private-session');assert(!result.cookies.other);
 assert.equal(r.counts().released,1);assert.equal(r.counts().closed,1);
 const guest=qrRuntime({guest:true,user_id:'guest'});
 await assert.rejects(guest.api.syncXhsBrowserLogin(1),/xhs_browser_not_logged_in/);assert.equal(guest.counts().released,1);
 await assert.rejects(r.api.syncXhsBrowserLogin(3),/xhs_browser_instance_invalid/);
});
test('browser sync HTTP requires explicit selection and never returns the browser Cookie',async()=>{
 let executed=0,stored='';
 const load=loader({'next/server':{NextResponse:{json:Response.json}},'lib/analysis/xhs-login-utils.ts':{syncXhsBrowserLogin:async browserInstance=>{executed++;return{browserInstance,userId:'user-fixture',cookies:{a1:'private-a1',web_session:'private-session'}};},xhsQrError:()=>({reason:'safe',error:'safe'})},'lib/analysis/xhs-cookie.ts':{setXhsCookie:c=>stored=c},'lib/analysis/platform-session.ts':{upsertPlatformSession:async()=>{}}});
 const route=load('app/api/analysis/xhs/login/browser/route.ts');
 const request=b=>new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});
 assert.equal((await route.POST(request({browserInstance:2}))).status,400);assert.equal(executed,0);
 const res=await route.POST(request({browserInstance:2,confirmBrowserControl:true})),data=await res.json();
 assert.equal(data.ok,true);assert.equal(data.browserInstance,2);assert(stored.includes('private-session'));assert(!JSON.stringify(data).includes('private-session'));assert(!('cookies' in data));
});
