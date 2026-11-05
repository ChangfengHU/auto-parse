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
test('changed draft and missing AI declaration fail before browser action',async()=>{const x=setup();try{await assert.rejects(x.api.publishVerifiedEditor({},input,1,'changed'),/draft_changed/);await assert.rejects(x.api.publishVerifiedEditor({},{...input,aiGenerated:undefined},1,'fingerprint'),/ai_declaration_required/);assert.equal(x.api.webPublishState(input.expectedAccount,input.mediaId),undefined)}finally{fs.rmSync(x.root,{recursive:true,force:true})}});
test('admin wait retains a single intent and suppresses repeat work',async()=>{const x=setup();try{let clicks=0;const loc={click:async()=>{clicks++},count:async()=>1,filter(){return this},locator(){return this},getByRole(){return this},isChecked:async()=>true,waitFor:async()=>{}};
 const page={once(){},route:async()=>{},locator:()=>loc,getByText:()=>({isVisible:async()=>true}),waitForTimeout:async()=>{}};
 const r=await x.api.publishVerifiedEditor(page,input,1,'fingerprint');assert.equal(r.status,'awaiting_admin_scan');const before=clicks;const repeated=await x.api.publishVerifiedEditor(page,{...input,requestId:'other'},1,'fingerprint');assert.equal(repeated.reused,true);assert.equal(clicks,before)}finally{fs.rmSync(x.root,{recursive:true,force:true})}});
test('one final request records submitted evidence and blocks another attempt',async()=>{const x=setup();try{let handler,clicks=0,fetches=0,aborts=0;const route={request:()=>({url:()=> 'https://mp.weixin.qq.com/cgi-bin/masssend?is_release_publish_page=1',method:()=> 'POST',postData:()=> 'appmsgid=1'}),fetch:async()=>{fetches++;return {json:async()=>({base_resp:{ret:0},msg_id:'receipt-id'}),status:()=>200,ok:()=>true}},fulfill:async()=>{},abort:async()=>{aborts++}};
 const loc={click:async()=>{if(++clicks===4)await handler(route)},count:async()=>1,filter(){return this},locator(){return this},getByRole(){return this},isChecked:async()=>true,waitFor:async()=>{}};
 const page={once(){},route:async(_,f)=>{handler=f},locator:()=>loc,getByText:()=>({isVisible:async()=>false}),waitForTimeout:async()=>{}};
 const r=await x.api.publishVerifiedEditor(page,input,1,'fingerprint');assert.equal(r.status,'submitted');assert.equal(r.receipt.messageId,'receipt-id');await handler(route);assert.equal(fetches,1);assert.equal(aborts,1)}finally{fs.rmSync(x.root,{recursive:true,force:true})}});

test('navigation and readonly checks pass; wrong appmsgid never submits',async()=>{
 const x=setup();try{
  let handler,continued=0,aborted=0,fetches=0;
  const loc={click:async()=>{},count:async()=>1,filter(){return this},locator(){return this},getByRole(){return this},isChecked:async()=>true,waitFor:async()=>{}};
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


test('after administrator scan a retained session records one final submission',async()=>{
 const x=setup();try{
  let handler,close,fetches=0;
  const loc={click:async()=>{},count:async()=>1,filter(){return this},locator(){return this},getByRole(){return this},isChecked:async()=>true,waitFor:async()=>{}};
  const page={once:(event,fn)=>{if(event==='close')close=fn},route:async(_,fn)=>{handler=fn},locator:()=>loc,getByText:()=>({isVisible:async()=>true})};
  const wait=await x.api.publishVerifiedEditor(page,input,1,'fingerprint');assert.equal(wait.status,'awaiting_admin_scan');
  const req={request:()=>({url:()=> 'https://mp.weixin.qq.com/cgi-bin/masssend?is_release_publish_page=1',method:()=> 'POST',postData:()=> 'appmsgid=1'}),fetch:async()=>{fetches++;return {json:async()=>({base_resp:{ret:0},msg_id:'after-scan'}),status:()=>200,ok:()=>true}},fulfill:async()=>{},abort:async()=>{}};
  await handler(req);
  const record=x.api.webPublishState(input.expectedAccount,input.mediaId);assert.equal(record.state,'submitted');assert.equal(record.receipt.messageId,'after-scan');
  await handler(req);assert.equal(fetches,1);close();assert.equal(x.api.webPublishState(input.expectedAccount,input.mediaId).state,'submitted');
 }finally{fs.rmSync(x.root,{recursive:true,force:true})}
});

test('article publish disables default mass notification before confirmation and retains QR session',async()=>{
 const x=setup();try{
  const clicks=[];let checked=true;
  const loc={click:async()=>{},count:async()=>1,filter(){return this},locator(){return this},getByRole(){return this},isChecked:async()=>true,waitFor:async()=>{}};
  const notify={count:async()=>1,isChecked:async()=>checked};
  const dialog={waitFor:async()=>{},locator:(selector)=>selector.includes('input')?notify:{click:async()=>{clicks.push('disable');checked=false}},getByRole:()=>({click:async()=>{clicks.push('dialog-publish')}})};
  const warning={waitFor:async()=>{},getByRole:()=>({click:async()=>{clicks.push('continue')}})};
  const page={once(){},route:async()=>{},locator:(selector)=>selector.includes('dialog')?{filter:({hasText})=>hasText==='群发通知'?dialog:hasText==='未开启群发通知'?warning:loc}:loc,getByText:()=>({isVisible:async()=>true})};
  const r=await x.api.publishVerifiedEditor(page,input,1,'fingerprint','news');
  assert.equal(checked,false);assert.deepEqual(clicks,['disable','dialog-publish','continue']);assert.equal(r.status,'awaiting_admin_scan');
 }finally{fs.rmSync(x.root,{recursive:true,force:true})}
});

test('news can explicitly enable follower notification and records the requested setting',async()=>{
 const x=setup();try{
  let checked=false;const clicks=[];
  const base={click:async()=>{},count:async()=>1,filter(){return this},locator(){return this},getByRole(){return this},isChecked:async()=>true,waitFor:async()=>{}};
  const notify={count:async()=>1,isChecked:async()=>checked};
  const dialog={waitFor:async()=>{},locator:s=>s.includes('input')?notify:{click:async()=>{checked=true;clicks.push('enable')}},getByRole:()=>({click:async()=>{clicks.push('dialog-publish')}})};
  const page={once(){},route:async()=>{},locator:s=>s.includes('dialog')?{filter:({hasText})=>hasText==='群发通知'?dialog:base}:base,getByText:()=>({isVisible:async()=>true})};
  const result=await x.api.publishVerifiedEditor(page,{...input,notifyFollowers:true},1,'fingerprint','news');
  assert.equal(result.status,'awaiting_admin_scan');assert.equal(checked,true);assert.deepEqual(clicks,['enable','dialog-publish']);
  assert.equal(x.api.webPublishState(input.expectedAccount,input.mediaId).requestedSettings.notifyFollowers,true);
 }finally{fs.rmSync(x.root,{recursive:true,force:true})}
});
test('newspic rejects unsupported follower notification before creating an intent',async()=>{
 const x=setup();try{await assert.rejects(x.api.publishVerifiedEditor({},{...input,notifyFollowers:true},1,'fingerprint','newspic'),/newspic_notification_unsupported/);assert.equal(x.api.webPublishState(input.expectedAccount,input.mediaId),undefined);}finally{fs.rmSync(x.root,{recursive:true,force:true})}
});

test('source declarations enforce the real single-choice rule before browser work',async()=>{
 const x=setup();try{
  await assert.rejects(x.api.publishVerifiedEditor({},{...input,articleStatement:'personal_opinion'},1,'fingerprint'),/wechat_web_ai_statement_conflict/);
  await assert.rejects(x.api.publishVerifiedEditor({},{...input,aiGenerated:false,articleStatement:'ai_generated'},1,'fingerprint'),/wechat_web_ai_statement_conflict/);
  await assert.rejects(x.api.publishVerifiedEditor({},{...input,aiGenerated:false,articleStatement:'repost'},1,'fingerprint'),/wechat_web_invalid_article_statement/);
  assert.equal(x.api.webPublishState(input.expectedAccount,input.mediaId),undefined);
 }finally{fs.rmSync(x.root,{recursive:true,force:true})}
});
test('non-AI defaults to personal opinion and verifies the selected radio',async()=>{
 const x=setup();try{
  let selected=false,selection='';
  const base={count:async()=>1,click:async()=>{},filter(){return this},locator(){return this},getByRole(){return this},isChecked:async()=>true,waitFor:async()=>{}};
  const choice={count:async()=>1,locator:()=>({isChecked:async()=>selected}),click:async()=>{selected=true}};
  const source={locator:()=>({filter:({hasText})=>{selection=hasText;return choice}}),getByRole:()=>base};
  const page={once(){},route:async()=>{},locator:s=>s.includes('dialog')?{filter:({hasText})=>hasText==='声明类型'?source:base}:base,getByText:()=>({isVisible:async()=>true})};
  const result=await x.api.publishVerifiedEditor(page,{...input,aiGenerated:false},1,'fingerprint');
  assert.equal(result.status,'awaiting_admin_scan');assert.equal(selection,'个人观点，仅供参考');assert.equal(selected,true);
  assert.equal(x.api.webPublishState(input.expectedAccount,input.mediaId).requestedSettings.articleStatement,'personal_opinion');
 }finally{fs.rmSync(x.root,{recursive:true,force:true})}
});

test('original declaration requires user agreement and author before reservation',async()=>{
 const x=setup();try{
  await assert.rejects(x.api.publishVerifiedEditor({},{...input,declareOriginal:true,originalAuthor:'Author'},1,'fingerprint','news'),/original_author_and_agreement_required/);
  await assert.rejects(x.api.publishVerifiedEditor({},{...input,declareOriginal:true,originalAuthor:'Author',confirmOriginalAgreement:true},1,'fingerprint','newspic'),/newspic_original_unsupported/);
  assert.equal(x.api.webPublishState(input.expectedAccount,input.mediaId),undefined);
 }finally{fs.rmSync(x.root,{recursive:true,force:true})}
});
test('news original declaration uses explicit author and agreement before publication',async()=>{
 const x=setup();try{
  let agreed=false,author='',dismissed=false;
  const base={count:async()=>1,click:async()=>{},filter(){return this},locator(){return this},getByRole(){return this},isChecked:async()=>true,waitFor:async()=>{}};
  const radio={isChecked:async()=>true,check:async()=>{}};
  const field={count:async()=>1,fill:async v=>{author=v},inputValue:async()=>author};
  const agreement={count:async()=>1,isChecked:async()=>agreed,check:async()=>{agreed=true}};
  const original={count:async()=>1,locator:s=>s.includes('original_type')?{first:()=>radio}:s.includes('js_counter')?field:agreement,getByRole:()=>({click:async()=>{dismissed=true}}),waitFor:async()=>{}};
  const notify={count:async()=>1,isChecked:async()=>true};const dialog={waitFor:async()=>{},locator:()=>notify,getByRole:()=>base};
  const unset={count:async()=>1,isVisible:async()=>!dismissed};
  const page={once(){},route:async()=>{},locator:s=>s.includes('js_unset')?unset:s.includes('dialog')?{filter:({hasText})=>hasText.includes('原创声明')?original:hasText==='群发通知'?dialog:base}:base,getByText:()=>({isVisible:async()=>true})};
  const result=await x.api.publishVerifiedEditor(page,{...input,declareOriginal:true,originalAuthor:'Author',confirmOriginalAgreement:true,notifyFollowers:true},1,'fingerprint','news');
  assert.equal(result.status,'awaiting_admin_scan');assert.equal(author,'Author');assert.equal(agreed,true);assert.equal(x.api.webPublishState(input.expectedAccount,input.mediaId).requestedSettings.declareOriginal,true);
 }finally{fs.rmSync(x.root,{recursive:true,force:true})}
});
