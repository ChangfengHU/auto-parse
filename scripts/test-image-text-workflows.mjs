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
const c=load('lib/workflow/image-text-contract.ts');
const p={platform:'xhs',expectedAccountId:'6766bb250000000018014413',imageUrls:['https://resource.vyibc.com/a.png','https://cdn.vyibc.com/b.jpg'],title:'图文测试',description:'正文',aiGenerated:true,requestId:'image-text-test',mode:'prepare'};
test('image sources accept JSON/lines and preserve order',()=>{
 assert.equal(JSON.stringify(c.imageSources(JSON.stringify(p.imageUrls))),JSON.stringify(p.imageUrls));
 assert.equal(JSON.stringify(c.imageSources(p.imageUrls.join('\n'))),JSON.stringify(p.imageUrls));
});
for(const value of [[],Array(10).fill(p.imageUrls[0]),[p.imageUrls[0],p.imageUrls[0]],['http://resource.vyibc.com/a.png'],['https://evil.test/a.jpg'],['https://resource.vyibc.com/a.mp4'],['https://resource.vyibc.com/a.png?token=secret'],['https://127.0.0.1/a.png'],['https://resource.vyibc.com:8080/a.png'],['https://u:p@resource.vyibc.com/a.png'],['https://placehold.co/720x960/png?text=anything']]) test('reject unsafe image sources '+JSON.stringify(value),()=>assert.throws(()=>c.imageSources(value)));
test('requestId and source reordering cannot bypass reservation; ordered metadata differs',()=>{
 const a=c.imageTextIdentity(p),b=c.imageTextIdentity({...p,requestId:'different-request'}),d=c.imageTextIdentity({...p,imageUrls:[...p.imageUrls].reverse()});
 assert.equal(a.key,b.key);assert.equal(a.key,d.key);assert.notEqual(a.fingerprint,d.fingerprint);
 for(const patch of [{title:'a'.repeat(21)},{aiGenerated:'yes'},{expectedAccountId:'11566224305'},{platform:'invalid'},{description:'a'.repeat(901)}]) assert.throws(()=>c.imageTextIdentity({...p,...patch}));
});
test('unresolved title and description placeholders cannot become published text',()=>{
 for(const patch of [{title:'{{title}}'},{description:'{{description}}'}]) assert.throws(()=>c.imageTextIdentity({...p,...patch}),/input_invalid/);
});
test('download enforces no redirects, MIME sniff and byte cap',async()=>{
 const png=Buffer.from([137,80,78,71,13,10,26,10]);
 const result=await c.downloadImage(p.imageUrls[0],async(u,opts)=>{assert.equal(opts.redirect,'error');return new Response(png);});
 assert.equal(result.mimeType,'image/png');assert.equal(result.sha256,c.digest(png));
 await assert.rejects(c.downloadImage(p.imageUrls[0],async()=>new Response('<html>not an image</html>')),/unsupported_image/);
 await assert.rejects(c.downloadImage(p.imageUrls[0],async()=>new Response(png,{headers:{'content-length':String(c.MAX_IMAGE_BYTES+1)}})),/too_large/);
 await assert.rejects(c.downloadImage(p.imageUrls[0],async()=>new Response(Buffer.alloc(c.MAX_IMAGE_BYTES+1))),/image_too_large/);
});
test('PNG/JPEG/WebP signatures only',()=>{
 assert.equal(c.imageMime(Buffer.from([255,216,255,0])).extension,'jpg');
 assert.equal(c.imageMime(Buffer.from('RIFFxxxxWEBP')).extension,'webp');
 assert.throws(()=>c.imageMime(Buffer.from('GIF89a')));
});
const endpoint='https://edith.xiaohongshu.com/web_api/sns/v2/note',id='6766bb250000000018014413';
const receipt=c.imageCreationReceipt('xhs',endpoint,'POST',200,JSON.stringify({success:true,data:{id}}));
test('creation receipt requires native success and preserves long Douyin IDs',()=>{
 assert.equal(receipt.postId,id);
 const dy=c.imageCreationReceipt('douyin','https://creator.douyin.com/web/api/media/aweme/create/','POST',200,'{"status_code":0,"aweme_id":1234567890123456789}');
 assert.equal(dy.postId,'1234567890123456789');assert.match(dy.postUrl,/\/note\//);
 assert.equal(c.imageCreationReceipt('xhs',endpoint,'POST',200,'{"success":false}'),null);
 assert.equal(c.imageCreationReceipt('xhs',endpoint,'GET',200,JSON.stringify({success:true,data:{id}})),null);
});
test('durable reservation fails closed and cannot be claimed by a different request',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'image-ledger-test-')),a=c.imageTextIdentity(p);
 try {
  assert.equal(await c.readImagePublication(dir,a.key,a.fingerprint),null);
  await c.reserveImagePublication(dir,a.key,a.fingerprint,p.requestId);
  await assert.rejects(c.readImagePublication(dir,a.key,a.fingerprint),/unknown_do_not_retry/);
  await assert.rejects(c.reserveImagePublication(dir,a.key,a.fingerprint,p.requestId),/already_reserved/);
  await assert.rejects(c.finishImagePublication(dir,a.key,a.fingerprint,'other-request',receipt),/reservation_mismatch/);
  await c.finishImagePublication(dir,a.key,a.fingerprint,p.requestId,receipt);
  assert.equal((await c.readImagePublication(dir,a.key,a.fingerprint)).receipt.postId,id);
  await assert.rejects(c.readImagePublication(dir,a.key,'different'),/different_metadata/);
 } finally {await rm(dir,{recursive:true,force:true});}
});
for(const scenario of ['prepare','publish','unauthorized','no-confirmation','fixture','no-upload','no-prepare','wrong-account','changed-order','bad-metadata','unknown-receipt','reused']) test('actual node boundary: '+scenario,async()=>{
 let clicks=0,reservations=0,finished=0;
 const identity=c.imageTextIdentity(p);
 const node=load('lib/workflow/nodes/image-text-publish.ts',{
 '../image-text-contract':{...c,readImagePublication:async()=>scenario==='reused'?{receipt}:null,reserveImagePublication:async()=>{reservations++;},finishImagePublication:async()=>{finished++;}},
 '../image-text-browser':{
  verifyImageAccount:async()=>{if(scenario==='wrong-account')throw Error('image_creator_account_mismatch');},
  imageOrder:async()=>scenario==='changed-order'?['b','a']:['a','b'],
  imageMetadata:async()=>{if(scenario==='bad-metadata')throw Error('image_metadata_mismatch');},
  imagePublicationSettings:async()=>{},
 },
 './shadow-button':{executeShadowButtonClick:async()=>{clicks++;return{success:true};}},
 });
 const page={locator:()=>({waitFor:async()=>{}}),waitForResponse:async predicate=>{
  const r={url:()=>endpoint,request:()=>({method:()=> 'POST'}),status:()=>200,text:async()=>JSON.stringify(scenario==='unknown-receipt'?{success:true,data:{}}:{success:true,data:{id}})};
  assert.equal(predicate(r),true);return r;
 }};
 const output={imageUpload:{fingerprint:identity.fingerprint,uploadId:'upload-one',count:2,order:['a','b']},imageTextPrepared:{fingerprint:identity.fingerprint,uploadId:'upload-one'}};
 if(scenario==='no-upload')delete output.imageUpload;if(scenario==='no-prepare')delete output.imageTextPrepared;
 const result=await node.executeImageTextPublish(page,{...p,mode:scenario==='prepare'?'prepare':'publish',...(scenario==='fixture'?{imageUrls:['https://placehold.co/720x960/png?text=WORKFLOW_TEST_01']}: {})},
 {managedPublicationAuthorized:scenario!=='unauthorized',vars:{directPublish:scenario==='no-confirmation'?'false':'true'},outputs:output});
 assert.equal(result.success,['prepare','publish','reused'].includes(scenario));
 assert.equal(clicks,['publish','unknown-receipt'].includes(scenario)?1:0);
 assert.equal(reservations,clicks);assert.equal(finished,scenario==='publish'?1:0);
 if(scenario==='prepare'){assert.equal(result.output.prepared,true);assert.equal(result.output.published,false);}
});
test('upload requires server authorization, not user vars',async()=>{
 const node=load('lib/workflow/nodes/image-upload.ts');
 const result=await node.executeImageUpload({},p,{vars:{managedPublicationAuthorized:'true'},outputs:{}});
 assert.equal(result.error,'image_authenticated_browser_required');
});
test('account helper rejects wrong origin and mismatched stable user ID',async()=>{
 const b=load('lib/workflow/image-text-browser.ts');
 await assert.rejects(b.verifyImageAccount({url:()=> 'https://evil.test/publish/publish'},'xhs',p.expectedAccountId),/page_invalid/);
 await assert.rejects(b.verifyImageAccount({url:()=> 'https://creator.xiaohongshu.com/publish/publish',evaluate:async()=> 'wrong'},'xhs',p.expectedAccountId),/account_mismatch/);
});
test('new types validate and expose managed capability without enabling legacy video guard',()=>{
 const v=load('lib/workflow/validation.ts');
 for(const type of ['image_upload','image_text_publish']) assert.equal(v.validateWorkflow({name:'new',vars:[],nodes:[{type,params:{}}]}).valid,true);
});
for(const platform of ['xhs','douyin']) test('publication settings fail closed: '+platform,async()=>{
 const b=load('lib/workflow/image-text-browser.ts');
 const locator={count:async()=>0,and:()=>locator,filter:()=>locator};
 await assert.rejects(b.imagePublicationSettings({locator:()=>locator,getByText:()=>locator},platform),/unconfirmed/);
});
