#!/usr/bin/env node
// Preparation by default; --publish uses the guarded web publisher with explicit confirmation.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright'),ts=require('typescript');
const token=process.env.WECHAT_MCP_TOKEN, mediaId=process.env.WECHAT_DRAFT_MEDIA_ID;
const expected=process.env.WECHAT_WEB_ACCOUNT;
const publish=process.argv.includes('--publish');
if(process.argv.slice(2).some(v=>v!=='--publish')){console.error('wechat_invalid_cli_argument');process.exit(2)}
if(publish&&(process.env.WECHAT_CONFIRM_PUBLISH!=='true'||process.env.WECHAT_AI_GENERATED!=='true'||!process.env.WECHAT_REQUEST_ID||!process.env.WECHAT_EXPECTED_FINGERPRINT)){console.error('wechat_publish_confirmation_required');process.exit(2)}
const endpoint=process.env.WECHAT_MCP_URL||'https://auto-parse-v2.vyibc.com/api/publish/mcp/wechat';
if(!token||!mediaId||!expected){console.error('wechat_prepare_missing_environment');process.exit(2)}
const endpointUrl=new URL(endpoint);
if(endpointUrl.origin!=='https://auto-parse-v2.vyibc.com'||endpointUrl.pathname!=='/api/publish/mcp/wechat')throw Error('wechat_mcp_endpoint_not_allowed');
function lockBrowser(){
 return new Promise((resolve,reject)=>{
  const lock='/run/linux-browser-vnc/activity-9222.lock';
  if(!fs.statSync(lock).isFile())return reject(Error('wechat_browser_lock_missing'));
  const child=spawn('flock',['--nonblock','--no-fork',lock,'sh','-c',"printf 'locked\\n'; cat >/dev/null"],{stdio:['pipe','pipe','ignore']});
  let granted=false;child.stdin.on('error',()=>{});
  child.once('error',()=>reject(Error('wechat_browser_lock_unavailable')));
  child.once('exit',()=>{if(!granted)reject(Error('wechat_browser_busy'))});
  child.stdout.once('data',d=>{if(String(d).trim()!=='locked')return;granted=true;resolve(()=>{child.stdin.end()})});
 });
}
function runRea(scenario,secretEnv){
 return new Promise((resolve,reject)=>{
  const childEnv={...process.env,...secretEnv};delete childEnv.WECHAT_MCP_TOKEN;delete childEnv.WECHAT_DRAFT_MEDIA_ID;
  const child=spawn('npm',['exec','--yes','--package=node@24.22.1','--package=rea-agents@6.8.0','--','rea','capture-browser-scenario','-','--json'],
   {cwd:process.cwd(),env:childEnv,stdio:['pipe','pipe','pipe']});
  let output='',err='';child.stdout.on('data',x=>{output+=x;if(output.length>2_000_000)child.kill()});child.stderr.on('data',x=>{err+=x;if(err.length>200000)child.kill()});
  const timeout=setTimeout(()=>child.kill(),90000);child.on('error',()=>{clearTimeout(timeout);reject(Error('rea_start_failed'))});
  child.on('close',code=>{clearTimeout(timeout);if(code!==0)return reject(Error('rea_scenario_failed'));try{const result=JSON.parse(output);if(result.isError||result.error)throw Error();resolve()}catch{reject(Error('rea_invalid_result'))}});
  child.stdin.end(JSON.stringify(scenario));
 });
}
const fingerprintModule={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/wechat/web-draft-fingerprint.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:fingerprintModule,exports:fingerprintModule.exports,require});
const {webDraftFingerprint}=fingerprintModule.exports;
let release,browser,page,editor,verifier;
try{
 const readDraft=async()=>{
 const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Accept':'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'wechat_get_draft',arguments:{mediaId}}}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('wechat_draft_read_failed');
 const rpc=await response.json();if(rpc.error||rpc.result?.isError)throw Error('wechat_draft_read_failed');
 return JSON.parse(rpc.result.content.find(x=>x.type==='text').text);
 };
 const data=await readDraft(),article=data.news_item?.[0];
 if(data.news_item?.length!==1||article?.article_type!=='newspic')throw Error('wechat_newspic_single_article_required');
 const fingerprint=webDraftFingerprint(data.news_item);
 if(publish&&fingerprint!==process.env.WECHAT_EXPECTED_FINGERPRINT)throw Error('wechat_web_draft_changed_prepare_again');
 const official={title:article.title,createdAt:data.create_time,thumbUrl:article.thumb_url};
 release=await lockBrowser();browser=await chromium.connectOverCDP('http://127.0.0.1:9222');const context=browser.contexts()[0];
 page=await context.newPage();await page.setViewportSize({width:1440,height:1000});await page.goto('https://mp.weixin.qq.com/',{waitUntil:'domcontentloaded',timeout:30000});
 if(new URL(page.url()).origin!=='https://mp.weixin.qq.com'||await page.evaluate(()=>window.wx?.data?.user_name)!==expected)throw Error('wechat_web_account_mismatch');
 const start=new URL(page.url());
 const cdp=await context.newCDPSession(page),info=await cdp.send('Target.getTargetInfo');await cdp.detach();
 const secrets=[],query=[],secretEnv={};let idx=0;for(const [name,value] of start.searchParams){const sid='query_'+idx,env='REA_WECHAT_SECRET_'+idx++;secrets.push({secret_id:sid,environment_variable:env});secretEnv[env]=value;query.push({name,value:{source:'secret',secret_id:sid}})}start.search='';
 const scenario={browser:{mode:'connect',cdp_endpoint:'http://127.0.0.1:9222',target_id:info.targetInfo.targetId},start_url:{url:start.href,query},environment:{viewport:{width:1440,height:1000},service_workers:'allow'},secrets,actions:[
  {step_id:'open_drafts',action:'click',locator:{kind:'role',role:'link',name:'草稿箱'},timeout_ms:20000},
  {step_id:'open_newspic',action:'click',locator:{kind:'css',selector:'button:has-text("贴图")'},timeout_ms:20000},
  {step_id:'wait_cards',action:'wait_for_timeout',duration_ms:2000}
 ]};
 await runRea(scenario,secretEnv);
 if(new URL(page.url()).origin!=='https://mp.weixin.qq.com')throw Error('wechat_web_account_mismatch');
 verifier=await context.newPage();await verifier.goto('https://mp.weixin.qq.com/',{waitUntil:'domcontentloaded',timeout:30000});
 if(new URL(verifier.url()).origin!=='https://mp.weixin.qq.com'||await verifier.evaluate(()=>window.wx?.data?.user_name)!==expected)throw Error('wechat_web_account_mismatch');
 const countText=await page.getByRole('button',{name:/^贴图/}).innerText(),countMatch=countText.match(/^贴图\s*(\d+)$/);
 if(!countMatch)throw Error('wechat_web_total_unknown');
 const total=Number(countMatch[1]);
 const collect=()=>page.evaluate(()=>{const seen=new Set();return [...document.querySelectorAll('*')].map(e=>e.__vue__?.$props?.source).filter(s=>s?.title&&!seen.has(s.app_id+':'+s.file_id)&&seen.add(s.app_id+':'+s.file_id)).map(s=>({title:s.title,create_time:s.create_time,img_url:s.img_url,app_id:s.app_id,file_id:s.file_id}))});
 let cards=await collect();for(let n=0;cards.length<total&&n<8;n++){await page.locator('.publish_card_container').last().scrollIntoViewIfNeeded();await page.mouse.wheel(0,1200);await page.waitForTimeout(1000);cards=await collect();}
 const compiled={exports:{}},src=fs.readFileSync('lib/wechat/web-draft-identity.ts','utf8');vm.runInNewContext(ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:compiled,exports:compiled.exports,URL});
 const matched=compiled.exports.matchWebNewspic(official,cards,cards.length===total);
 const elements=page.locator('.publish_card_container'),targets=[];
 for(let n=0;n<await elements.count();n++){const row=await elements.nth(n).evaluate(e=>e.__vue__?.$props?.source);if(row&&Number(row.app_id)===matched.appId&&Number(row.file_id)===matched.fileId)targets.push(n)}
 if(targets.length!==1)throw Error('wechat_web_draft_element_ambiguous');
 const card=elements.nth(targets[0]);await card.hover();const edit=card.locator('.weui-desktop-tooltip__wrp.weui-desktop-link > a.weui-desktop-icon20');
 if(await edit.count()!==1)throw Error('wechat_web_edit_element_ambiguous');
 [editor]=await Promise.all([page.waitForEvent('popup',{timeout:15000}),edit.click({timeout:12000})]);await editor.waitForLoadState('domcontentloaded');
 const editorUrl=new URL(editor.url());if(editorUrl.origin!=='https://mp.weixin.qq.com'||editorUrl.searchParams.get('appmsgid')!==String(matched.appId))throw Error('wechat_web_editor_id_mismatch');
 const field=editor.locator('.ProseMirror:visible').first();await field.waitFor({state:'visible',timeout:15000});if(await field.innerText()!==official.title)throw Error('wechat_web_editor_title_mismatch');
 if(await editor.locator('button.mass_send:visible').count()!==1)throw Error('wechat_web_publish_button_ambiguous');
 if(publish){
  const fresh=await readDraft();
  if(webDraftFingerprint(fresh.news_item)!==fingerprint)throw Error('wechat_web_draft_changed_prepare_again');
  const cache=new Map();function loadModule(file){if(cache.has(file))return cache.get(file);const m={exports:{}};const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;vm.runInNewContext(output,{module:m,exports:m.exports,require:n=>n.startsWith('.')?loadModule(path.normalize(path.join(path.dirname(file),n))+'.ts'):require(n),URL,URLSearchParams,process,Buffer});cache.set(file,m.exports);return m.exports}
  const api=loadModule('lib/wechat/web-publish.ts');
  const result=await api.publishVerifiedEditor(editor,{mediaId,expectedAccount:expected,requestId:process.env.WECHAT_REQUEST_ID,expectedFingerprint:process.env.WECHAT_EXPECTED_FINGERPRINT,aiGenerated:true},matched.appId,fingerprint);
  console.log(JSON.stringify(result));
  if(result.keepSessionOpen){const deadline=Date.now()+20*60*1000;while(Date.now()<deadline){const record=api.webPublishState(expected,mediaId);if(record&&['submitted','unknown'].includes(record.state)){console.log(JSON.stringify(record));break;}await new Promise(resolve=>setTimeout(resolve,1000));}}
 }else console.log(JSON.stringify({ok:true,stage:'prepared',published:false,engine:'rea-6.8.0',accountVerified:true,uniqueMatch:true,editorVerified:true,draftFingerprint:fingerprint,scanned:cards.length,title:official.title,note:'Matched the draft and editor; no publication performed.'}));
}catch(error){const msg=error instanceof Error&&/^(wechat_|rea_)[a-z_]+$/.test(error.message)?error.message:'wechat_prepare_failed';console.error(JSON.stringify({ok:false,error:msg,published:false}));process.exitCode=1}
finally{if(editor&&!editor.isClosed())await editor.close().catch(()=>{});if(verifier&&!verifier.isClosed())await verifier.close().catch(()=>{});if(page)await page.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});if(release)release()}
