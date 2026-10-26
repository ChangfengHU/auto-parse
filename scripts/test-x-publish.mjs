import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const require=createRequire(path.join(root,'package.json')),ts=require('typescript');
function load(file,mocks={}) {
 const loadedModule={exports:{}};
 const source=ts.transpileModule(readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 vm.runInNewContext(source,{module:loadedModule,exports:loadedModule.exports,require:n=>n in mocks?mocks[n]:n.startsWith('.')?load(path.join(path.dirname(file),n+'.ts'),mocks):require(n),process,URL,Buffer,AbortSignal,Response,fetch,console,Error});
 return loadedModule.exports;
}

const c=load('lib/workflow/x-publication.ts');
const p={mode:'prepare',expectedUsername:'@Example_User',text:'这是一条预览测试。\nHello 🌍 #demo',requestId:'x-test-0001'};
const expected=c.xIdentity(p),endpoint='https://x.com/i/api/graphql/dynamicHash/CreateTweet';
function body(text=p.text,username='Example_User',id='1234567890123456789'){
 return {data:{create_tweet:{tweet_results:{result:{rest_id:id,legacy:{full_text:text,is_quote_status:false},core:{user_results:{result:{legacy:{screen_name:username}}}}}}}}};
}
test('identity is account/content scoped and ignores new requestId',()=>{
 assert.equal(expected.key,c.xIdentity({...p,expectedUsername:'example_user',requestId:'x-other-0002'}).key);
 assert.notEqual(expected.key,c.xIdentity({...p,text:p.text+' changed'}).key);
 assert.equal(c.xIdentity({...p,text:'a\r\nb'}).key,c.xIdentity({...p,text:'a\nb'}).key);
});
for(const patch of [{text:''},{text:'   '},{text:' space'},{text:'{{text}}'},{text:'a'.repeat(10001)},{expectedUsername:'@bad-name'},{expectedUsername:'a'.repeat(16)},{requestId:'short'}]){
 test('invalid input '+JSON.stringify(patch).slice(0,70),()=>assert.throws(()=>c.xIdentity({...p,...patch}),/input_invalid/));
}
test('native receipt requires account, exact text and string IDs',()=>{
 const r=c.xCreationReceipt(endpoint,'POST',200,body(),expected);
 assert.equal(r.postId,'1234567890123456789');assert.match(r.postUrl,/example_user\/status/);
 const current=body();const user=current.data.create_tweet.tweet_results.result.core.user_results.result;user.core={screen_name:'Example_User'};delete user.legacy;
 assert.equal(c.xCreationReceipt(endpoint,'POST',200,current,expected).published,true);
});
for(const [name,url,method,status,reply] of [
 ['wrong endpoint','https://evil.example/i/api/graphql/id/CreateTweet','POST',200,body()],
 ['wrong operation','https://x.com/i/api/graphql/id/DeleteTweet','POST',200,body()],
 ['wrong method',endpoint,'GET',200,body()],
 ['failed status',endpoint,'POST',403,body()],
 ['wrong account',endpoint,'POST',200,body(p.text,'someone_else')],
 ['wrong text',endpoint,'POST',200,body('other')],
 ['numeric lossy ID',endpoint,'POST',200,body(p.text,'Example_User',1234567890123456789)],
 ['GraphQL HTTP200 error',endpoint,'POST',200,{...body(),errors:[{message:'error'}]}],
 ['missing result',endpoint,'POST',200,{data:{}}],
 ['unexpected media',endpoint,'POST',200,(()=>{const b=body();b.data.create_tweet.tweet_results.result.legacy.extended_entities={media:[{}]};return b;})()],
 ['reply',endpoint,'POST',200,(()=>{const b=body();b.data.create_tweet.tweet_results.result.legacy.in_reply_to_status_id_str='12345';return b;})()],
])test('receipt rejects '+name,()=>assert.equal(c.xCreationReceipt(url,method,status,reply,expected),null));
test('native t.co response resolves only declared entities before exact comparison',()=>{
 const original={...p,text:'链接 🌍 https://example.com/article'};
 const e=c.xIdentity(original),b=body('链接 🌍 https://t.co/abc123');
 b.data.create_tweet.tweet_results.result.legacy.entities={urls:[{url:'https://t.co/abc123',expanded_url:'https://example.com/article'}]};
 assert.equal(c.xCreationReceipt(endpoint,'POST',200,b,e).published,true);
 b.data.create_tweet.tweet_results.result.legacy.entities.urls[0].expanded_url='https://wrong.example';
 assert.equal(c.xCreationReceipt(endpoint,'POST',200,b,e),null);
});
test('durable reservation survives new callers, is atomic and excludes plaintext',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'x-ledger-'));
 try{
  assert.equal(await c.xRecord(dir,expected.key,expected.fingerprint),null);
  const attempts=await Promise.allSettled(Array.from({length:8},()=>c.reserveX(dir,expected.key,expected.fingerprint,p.requestId)));
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  const r=await c.xRecord(dir,expected.key,expected.fingerprint);assert.equal(r.state,'submitting');
  assert.equal(JSON.stringify(r).includes(p.text),false);
  await assert.rejects(c.finishX(dir,expected.key,expected.fingerprint,'different',{}),/reservation_mismatch/);
  const receipt=c.xCreationReceipt(endpoint,'POST',200,body(),expected);
  await c.finishX(dir,expected.key,expected.fingerprint,p.requestId,receipt);
  assert.equal((await c.xRecord(dir,expected.key,expected.fingerprint)).receipt.postId,receipt.postId);
  await assert.rejects(c.reserveX(dir,expected.key,expected.fingerprint,'new-request'),/already_reserved/);
  await assert.rejects(c.xRecord(dir,expected.key,'bad-fingerprint'),/record_invalid/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
for(const scenario of ['prepare','publish','unauthorized','unconfirmed','no-proof','wrong-account','wrong-text','thread','media','draft','disabled','unknown-response','click-failed','reused','uncertain']){
 test('executor boundary '+scenario,async()=>{
  let text='',clicks=0,reserves=0,finishes=0;
  const field={waitFor:async()=>{},innerText:async()=>scenario==='draft'?'old draft':text,fill:async value=>{text=value;}};
  const fields={count:async()=>scenario==='thread'?2:1,innerText:async()=>scenario==='wrong-text'?'other':text};
  const button={count:async()=>1,waitFor:async()=>{},isEnabled:async()=>scenario!=='disabled',click:async()=>{clicks++;if(scenario==='click-failed')throw Error('transport');}};
  const scope={first:()=>scope,waitFor:async()=>{},count:async()=>1,filter:()=>scope,locator:s=>{
   if(s.includes('contenteditable'))return fields;
   if(s.includes('tweetTextarea'))return field;
   if(s.includes('tweetButton'))return button;
   return {count:async()=>scenario==='media'?1:0};
  }};
  const page={url:()=> 'https://x.com/compose/post',goto:async()=>{},locator:s=>{
   if(s.includes('AppTabBar_Profile_Link'))return {waitFor:async()=>{},getAttribute:async()=>scenario==='wrong-account'?'/other':'/Example_User'};
   if(s.includes('Account menu'))return {isVisible:async()=>true};
   return scope;
  },waitForResponse:async predicate=>{
   const reply={url:()=>endpoint,request:()=>({method:()=> 'POST',postDataJSON:()=>({variables:{tweet_text:p.text}})}),status:()=>200,json:async()=>scenario==='unknown-response'?{}:body()};
   assert.equal(predicate(reply),true);return reply;
  }};
  const receipt=c.xCreationReceipt(endpoint,'POST',200,body(),expected);
  const node=load('lib/workflow/nodes/x-publish.ts',{'../x-publication':{...c,xRecord:async()=>scenario==='reused'?{receipt}:scenario==='uncertain'?{state:'submitting'}:null,reserveX:async()=>{reserves++;},finishX:async()=>{finishes++;}}});
  const preview=['prepare','draft'].includes(scenario);
  text=preview?'':p.text;
  const result=await node.executeXPublish(page,{...p,mode:preview?'prepare':'publish'},{
   managedPublicationAuthorized:scenario!=='unauthorized',vars:{directPublish:scenario==='unconfirmed'?'false':'true'},
   outputs:scenario==='no-proof'?{}:{xPrepared:{fingerprint:expected.fingerprint,requestId:p.requestId}},
  });
  assert.equal(result.success,['prepare','publish','reused'].includes(scenario),result.error);
  assert.equal(clicks,['publish','unknown-response','click-failed'].includes(scenario)?1:0);
  assert.equal(reserves,clicks);assert.equal(finishes,scenario==='publish'?1:0);
  if(scenario==='prepare'){assert.equal(result.output.published,false);assert.equal(result.output.prepared,true);}
  if(['unknown-response','click-failed','uncertain'].includes(scenario))assert.equal(result.error,'x_submission_unknown_do_not_retry');
 });
}
test('catalog, validation and MCP expose X without inline auth',()=>{
 const v=load('lib/workflow/validation.ts');assert.equal(v.validateWorkflow({name:'X test',vars:[],nodes:[{type:'x_publish',params:{}}]}).valid,true);
 const contract=load('lib/workflow/mcp-contract.ts');
 assert.equal(contract.WORKFLOW_MCP_TOOLS.find(t=>t.name==='x_publication_status').annotations.readOnlyHint,true);
});
