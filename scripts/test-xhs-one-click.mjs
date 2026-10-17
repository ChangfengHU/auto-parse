import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const root = path.resolve(new URL('..',import.meta.url).pathname);
const require = createRequire(path.join(root,'package.json')), ts = require('typescript');
function load(file,mocks={}) {
  const module={exports:{}};
  const source=ts.transpileModule(readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(source,{module,exports:module.exports,require:n=>n in mocks ? mocks[n] : n.startsWith('.') ? load(path.join(path.dirname(file),n+'.ts'),mocks) : require(n),process,URL,Buffer,AbortSignal,console,Error});
  return module.exports;
}
const condition=load('lib/workflow/condition.ts'), ledger=load('lib/workflow/xhs-publication-ledger.ts');
for(const value of [true,'true',false,'false',undefined,'']) test('strict branch variable '+String(value),()=>{
  const vars={directPublish:value}, node={runIf:{variable:'directPublish',equals:true}};
  assert.equal(condition.shouldExecuteNode(node,vars), value===true || value==='true');
  assert.equal(condition.shouldExecuteNode({...node,runIf:{...node.runIf,equals:false}},vars), !(value===true || value==='true'));
  assert.equal(condition.shouldExecuteNode({},vars),true);
});
for(const value of ['TRUE','1','yes',1,{},null]) test('reject ambiguous boolean '+JSON.stringify(value),()=>assert.throws(()=>condition.booleanVariable(value),/true_or_false/));
const p={requestId:'test-request-20261017',expectedAccountId:'11566224305',videoUrl:'https://resource.vyibc.com/fixture.mp4',title:'test',description:'story',aiGenerated:true};
test('content identity prevents changing request ID to re-publish',()=>{
  assert.equal(ledger.xhsPublicationIdentity(p).key,ledger.xhsPublicationIdentity({...p,requestId:'different-request'}).key);
  assert.notEqual(ledger.xhsPublicationIdentity(p).fingerprint,ledger.xhsPublicationIdentity({...p,title:'other'}).fingerprint);
  for(const videoUrl of ['http://resource.vyibc.com/a.mp4','https://evil.test/a.mp4','https://resource.vyibc.com/a.mp4?secret=x']) assert.throws(()=>ledger.xhsPublicationIdentity({...p,videoUrl}));
});
const endpoint='https://creator.xiaohongshu.com/web_api/sns/v2/note';
const body={code:0,success:true,data:{noteId:'6766bb250000000018014413'}};
test('only exact successful creation endpoint with a real-shaped note ID proves submission',()=>{
  assert.equal(ledger.xhsCreationReceipt(endpoint,'POST',200,body).published,true);
  for(const args of [[endpoint,'GET',200,body],[endpoint,'POST',500,body],[endpoint,'POST',200,{...body,code:1}],[endpoint,'POST',200,{code:0,data:{id:'toast-success'}}],[endpoint+'/update','POST',200,body],['https://evil.test/web_api/sns/v2/note','POST',200,body]]) assert.equal(ledger.xhsCreationReceipt(...args),null);
});
test('real creator success response has no code field; conflicting or absent success still fails',()=>{
  assert.equal(ledger.xhsCreationReceipt('https://edith.xiaohongshu.com/web_api/sns/v2/note','POST',200,{success:true,data:{id:body.data.noteId,score:0}}).noteId,body.data.noteId);
  for(const bad of [{data:{id:body.data.noteId}},{success:true,code:1,data:{id:body.data.noteId}},{success:false,data:{id:body.data.noteId}}]) assert.equal(ledger.xhsCreationReceipt(endpoint,'POST',200,bad),null);
});
test('durable reservation survives retry and prevents parallel/different metadata submissions',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'xhs-ledger-test-'));
  try {
    const {key,fingerprint}=ledger.xhsPublicationIdentity(p);
    assert.equal(await ledger.readXhsPublication(dir,key,fingerprint),null);
    await ledger.reserveXhsPublication(dir,key,fingerprint,p.requestId);
    await assert.rejects(ledger.readXhsPublication(dir,key,fingerprint),/unknown_do_not_retry/);
    await assert.rejects(ledger.reserveXhsPublication(dir,key,fingerprint,p.requestId),/already_reserved/);
    await assert.rejects(ledger.readXhsPublication(dir,key,'different'),/different_metadata/);
    await ledger.finishXhsPublication(dir,key,fingerprint,p.requestId,ledger.xhsCreationReceipt(endpoint,'POST',200,body));
    assert.equal((await ledger.readXhsPublication(dir,key,fingerprint)).receipt.noteId,body.data.noteId);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('publication authorization is never supplied by a user variable or truthy false string',async()=>{
  const node=load('lib/workflow/nodes/xhs-publish.ts',{'../utils':{captureScreenshot:async()=>undefined},'./shadow-button':{executeShadowButtonClick:async()=>{throw Error('must_not_click');}}});
  for(const ctx of [{vars:{directPublish:'true',managedPublicationAuthorized:'true'},outputs:{}},{vars:{directPublish:'false'},outputs:{},managedPublicationAuthorized:true}]) {
    const result=await node.executeXhsPublish({},p,ctx);
    assert.equal(result.success,false); assert.equal(result.error,'xhs_authenticated_direct_publication_required');
  }
});
test('workflow validator rejects malformed conditional nodes',()=>{
  const v=load('lib/workflow/validation.ts');
  const workflow={name:'conditional',vars:['directPublish'],nodes:[{type:'click',params:{},runIf:{variable:'directPublish',equals:true}}]};
  assert.equal(v.validateWorkflow(workflow).valid,true);
  for(const runIf of [{variable:'directPublish',equals:'true'},{variable:'__proto__',equals:true},{variable:'directPublish',equals:true,eval:'bad'}]) assert.equal(v.validateWorkflow({...workflow,nodes:[{...workflow.nodes[0],runIf}]}).valid,false);
});

for(const scenario of ['success','no-upload','wrong-account','wrong-title','wrong-description','upload-failed','ai-unapplied','click-error','unknown-receipt','already-published']) test('actual XHS node safety: '+scenario,async()=>{
  let clicks=0,reserved=0,finished=0;
  const receipt=ledger.xhsCreationReceipt(endpoint,'POST',200,body);
  const node=load('lib/workflow/nodes/xhs-publish.ts',{
    '../utils':{captureScreenshot:async()=>undefined},
    './shadow-button':{executeShadowButtonClick:async()=>{clicks++;return{success:scenario!=='click-error'};}},
    '../xhs-publication-ledger':{
      ...ledger,readXhsPublication:async()=>scenario==='already-published'?{receipt}:null,
      reserveXhsPublication:async()=>{reserved++;},finishXhsPublication:async()=>{finished++;},
    },
  });
  const locator=selector=>({
    waitFor:async()=>{}, inputValue:async()=>scenario==='wrong-title'?'other':p.title,
    innerText:async()=>selector==='body'?(scenario==='upload-failed'?'上传失败':'重新上传'):(scenario==='wrong-description'?'other':p.description),
  });
  const page={
    url:()=> 'https://creator.xiaohongshu.com/publish/publish',
    evaluate:async()=>scenario==='wrong-account'?'999999':p.expectedAccountId,
    locator,getByText:text=>{const l={waitFor:async()=>{},isVisible:async()=>true,click:async()=>{},count:async()=>text==='虚构演绎，仅供娱乐'&&scenario==='ai-unapplied'?1:0,and:()=>l};return l;},
    waitForResponse:async predicate=>{
      const r={url:()=>endpoint,request:()=>({method:()=> 'POST'}),status:()=>200,json:async()=>scenario==='unknown-receipt'?{code:0,data:{}}:body};
      assert.equal(predicate(r),true);return r;
    },
  };
  const result=await node.executeXhsPublish(page,p,{vars:{directPublish:'true'},outputs:scenario==='no-upload'?{}:{uploadedSourceUrl:p.videoUrl},managedPublicationAuthorized:true});
  const submitted=['success','click-error','unknown-receipt'].includes(scenario);
  assert.equal(clicks,submitted?1:0); assert.equal(reserved,submitted?1:0);
  assert.equal(finished,scenario==='success'?1:0);
  assert.equal(result.success,['success','already-published'].includes(scenario));
  if(['click-error','unknown-receipt'].includes(scenario)) assert.equal(result.error,'xhs_submission_unknown_do_not_retry');
});

test('creator list reconciliation requires account, exact title, unique ID, time and duration',()=>{
  const note={id:'6ad37843000000001301bb1b',display_title:'雨夜最后一单',type:'video',video_info:{duration:49},visible_time:1792243842,permission_code:0,schedule_post_time:0};
  const list={code:0,success:true,data:{notes:[note]}};
  const expected={title:note.display_title,accountId:'11566224305',observedAccountId:'11566224305',startedAt:1792243610000,finishedAt:1792244000000,durationSeconds:49,publishedTab:true};
  assert.equal(ledger.xhsCreatorListReceipt(list,expected).verificationSource,'creator_note_list');
  for(const changes of [{observedAccountId:'wrong'},{title:'wrong'},{durationSeconds:10},{startedAt:1792245000000},{finishedAt:1792243700000}]) assert.equal(ledger.xhsCreatorListReceipt(list,{...expected,...changes}),null);
  for(const changes of [{permission_code:1},{schedule_post_time:1792245000},{type:'image'},{id:'bad'},{video_info:{duration:90}}]) assert.equal(ledger.xhsCreatorListReceipt({...list,data:{notes:[{...note,...changes}]}},expected),null);
  assert.equal(ledger.xhsCreatorListReceipt({...list,data:{notes:[note,note]}},expected),null);
});
for(const scenario of ['visible','missing','invalid-selector','ambiguous','mixed','publish']) test('bounded optional hint: '+scenario,async()=>{
  const helper=load('lib/workflow/nodes/optional-click.ts');
  const params={selector:'.optional',skipIfMissing:true,timeout:1500};
  if(scenario==='mixed') params.text='unsafe';
  if(scenario==='publish') params.xhsPublication={};
  let waited=0;
  const target={first:()=>target,count:async()=>scenario==='ambiguous'?2:1,waitFor:async({timeout})=>{waited=timeout;if(scenario==='missing'){const e=Error('missing');e.name='TimeoutError';throw e;}if(scenario==='invalid-selector')throw Error('bad selector');}};
  const result=await helper.optionalClickPreflight({locator:()=>target},params);
  if(scenario==='visible')assert.equal(result,undefined);
  else if(scenario==='missing'){assert.equal(result.success,true);assert.equal(result.stepSkipped,true);assert.equal(waited,1500);}
  else assert.equal(result.success,false);
});
