import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wechat-submit-')),cache=new Map();
 function load(file){if(cache.has(file))return cache.get(file);const m={exports:{}};
 const s=ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(s,{module:m,exports:m.exports,require:n=>n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(file),n))+'.ts'):require(n),URL,URLSearchParams,process:{cwd:()=>root},Buffer});cache.set(file,m.exports);return m.exports}
 return {root,api:load('lib/wechat/web-publish.ts'),fingerprint:load('lib/wechat/web-draft-fingerprint.ts').webDraftFingerprint};
}
const input={mediaId:'media',expectedAccount:'gh_123456789abc',requestId:'test',expectedFingerprint:'fingerprint',aiGenerated:true};
test('final endpoint classification excludes prechecks and foreign origins',()=>{const x=setup();try{assert(x.api.isFinalWechatPublish('https://mp.weixin.qq.com/cgi-bin/masssend?is_release_publish_page=1','POST'));assert(!x.api.isFinalWechatPublish('https://mp.weixin.qq.com/cgi-bin/masssend?is_release_publish_page=1&for_check=1','POST'));assert(!x.api.isFinalWechatPublish('https://evil.test/cgi-bin/masssend?is_release_publish_page=1','POST'))}finally{fs.rmSync(x.root,{recursive:true,force:true})}});
test('changed draft and missing AI declaration fail before browser action',async()=>{const x=setup();try{await assert.rejects(x.api.publishVerifiedEditor({},input,1,'changed'),/draft_changed/);await assert.rejects(x.api.publishVerifiedEditor({},{...input,aiGenerated:false},1,'fingerprint'),/ai_declared/);assert.equal(x.api.webPublishState(input.expectedAccount,input.mediaId),undefined)}finally{fs.rmSync(x.root,{recursive:true,force:true})}});
test('admin wait retains a single intent and suppresses repeat work',async()=>{const x=setup();try{let clicks=0;const loc={click:async()=>{clicks++},filter(){return this},locator(){return this},getByRole(){return this},isChecked:async()=>true,waitFor:async()=>{}};
 const page={once(){},route:async()=>{},locator:()=>loc,getByText:()=>({isVisible:async()=>true}),waitForTimeout:async()=>{}};
 const r=await x.api.publishVerifiedEditor(page,input,1,'fingerprint');assert.equal(r.status,'awaiting_admin_scan');const before=clicks;const repeated=await x.api.publishVerifiedEditor(page,{...input,requestId:'other'},1,'fingerprint');assert.equal(repeated.reused,true);assert.equal(clicks,before)}finally{fs.rmSync(x.root,{recursive:true,force:true})}});
test('one final request records submitted evidence and blocks another attempt',async()=>{const x=setup();try{let handler,clicks=0,fetches=0,aborts=0;const route={request:()=>({url:()=> 'https://mp.weixin.qq.com/cgi-bin/masssend?is_release_publish_page=1',method:()=> 'POST',postData:()=> 'appmsgid=1'}),fetch:async()=>{fetches++;return {json:async()=>({base_resp:{ret:0},msg_id:'receipt-id'}),status:()=>200,ok:()=>true}},fulfill:async()=>{},abort:async()=>{aborts++}};
 const loc={click:async()=>{if(++clicks===4)await handler(route)},filter(){return this},locator(){return this},getByRole(){return this},isChecked:async()=>true,waitFor:async()=>{}};
 const page={once(){},route:async(_,f)=>{handler=f},locator:()=>loc,getByText:()=>({isVisible:async()=>false}),waitForTimeout:async()=>{}};
 const r=await x.api.publishVerifiedEditor(page,input,1,'fingerprint');assert.equal(r.status,'submitted');assert.equal(r.receipt.messageId,'receipt-id');await handler(route);assert.equal(fetches,1);assert.equal(aborts,1)}finally{fs.rmSync(x.root,{recursive:true,force:true})}});

test('navigation and readonly checks pass; wrong appmsgid never submits',async()=>{
 const x=setup();try{
  let handler,continued=0,aborted=0,fetches=0;
  const loc={click:async()=>{},filter(){return this},locator(){return this},getByRole(){return this},isChecked:async()=>true,waitFor:async()=>{}};
  const page={once(){},route:async(_,fn)=>{handler=fn},locator:()=>loc,getByText:()=>({isVisible:async()=>true})};
  await x.api.publishVerifiedEditor(page,input,1,'fingerprint');
  const route=(suffix,body)=>({request:()=>({url:()=> 'https://mp.weixin.qq.com/cgi-bin/'+suffix,method:()=> 'POST',postData:()=>body}),continue:async()=>{continued++},abort:async()=>{aborted++},fetch:async()=>{fetches++;throw Error('never')}});
  await handler(route('masssendpage?appmsgid=1',''));
  await handler(route('masssend?action=get_appmsg_copyright_stat',''));
  await handler(route('masssend?for_check=1',''));
  assert.equal(continued,3);
  await handler(route('masssend?is_release_publish_page=1','appmsgid=99'));
  assert.equal(aborted,1);assert.equal(fetches,0);
  assert.equal(x.api.webPublishState(input.expectedAccount,input.mediaId).state,'unknown');
  await handler(route('masssend?is_release_publish_page=1','appmsgid=1'));assert.equal(fetches,0);assert.equal(aborted,2);
 }finally{fs.rmSync(x.root,{recursive:true,force:true})}
});

test('fingerprint ignores rotating preview link and object order but binds content and image order',()=>{
 const x=setup();try{
  const a=[{title:'t',content:'c',url:'https://preview.test/?signature=first',image_info:{image_list:[{image_media_id:'a'},{image_media_id:'b'}]},thumb_media_id:'a'}];
  const b=[{thumb_media_id:'a',image_info:{image_list:[{image_media_id:'a'},{image_media_id:'b'}]},url:'https://preview.test/?signature=second',content:'c',title:'t'}];
  assert.equal(x.fingerprint(a),x.fingerprint(b));
  for(const patch of [{title:'changed'},{content:'changed'},{thumb_media_id:'b'},{image_info:{image_list:[{image_media_id:'b'},{image_media_id:'a'}]}}])
   assert.notEqual(x.fingerprint(a),x.fingerprint([{...a[0],...patch}]));
 }finally{fs.rmSync(x.root,{recursive:true,force:true})}
});
