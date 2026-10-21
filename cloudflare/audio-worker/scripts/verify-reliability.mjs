// Live read-only/replay checks. No new generation/import, approvals or asset edits.
// Supply {accessToken, base?, worker?} on echo-disabled stdin; never on argv.
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '../../../node_modules/playwright/index.mjs';
const rl = createInterface({input:process.stdin});
const input = await new Promise(resolve => rl.once('line', line => {rl.close();resolve(JSON.parse(line));}));
const base = input.base || 'https://auto-parse-v2.vyibc.com';
const worker = input.worker || 'https://auto-parse-audio.2513120790.workers.dev';
const evidence=[];
const dir = new URL('../../../.data/audio-reliability-20261021/', import.meta.url);
mkdirSync(dir,{recursive:true});
function record(name,ok,detail={}) {
  const row={name,ok,...detail};evidence.push(row);console.log(JSON.stringify(row));
  writeFileSync(new URL('results.json',dir),JSON.stringify(evidence,null,2));
}
let seq=0;
async function rpc(method,params={}) {
  const r=await fetch(worker+'/mcp',{method:'POST',headers:{Authorization:`Bearer ${input.accessToken}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:++seq,method,params}),signal:AbortSignal.timeout(20000)});
  const d=await r.json();if(!r.ok||d.error)throw Error(`MCP transport ${r.status}: ${d.error?.code || ''}`);return d.result;
}
async function call(name,args={},expectedError=false) {
  const t=Date.now();const r=await rpc('tools/call',{name,arguments:args});
  const text=r.content.find(c=>c.type==='text').text;
  let data;
  try { data=JSON.parse(text); } catch { if(!r.isError)throw Error('Successful tool returned malformed JSON'); data={error:text.slice(0,300)}; }
  record(name,!!r.isError===expectedError,{ms:Date.now()-t,expectedError,error:data.error});return data;
}
try {
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'audio-reliability',version:'1'}});
  const tools=await rpc('tools/list');record('MCP tools/list',tools.tools?.length===11,{count:tools.tools?.length});
  writeFileSync(new URL('mcp-tools.json',dir),JSON.stringify(tools.tools,null,2));
  const caps=await call('audio_capabilities');record('Openverse accurately unavailable',caps.providers?.find(p=>p.id==='openverse')?.ready===false);
  for(const q of ['piano','footsteps','雨声','zzqxnosuchsound20261021']){
    const t=Date.now();const data=await call('audio_search',{q,kind:q==='piano'?'music':'sound_effect'});
    record('MCP search '+q,Array.isArray(data.items)&&(q.startsWith('zzqx')?data.items.length===0:data.items.length>0),{count:data.items?.length,ms:Date.now()-t});
  }
  await call('audio_search',{q:'piano',kind:'music',provider:'openverse'},true);
  const library=await call('audio_library');const asset=library.items?.[0];
  if(asset)await call('audio_get_asset',{id:asset.id});else record('asset read coverage',false,{reason:'no existing asset'});
  const gen={model:'elevenlabs/music-v2',title:'Read only quote',prompt:'Gentle instrumental piano background music',seconds:10};
  await call('audio_quote',gen);
  await call('audio_generate',{...gen,requestId:crypto.randomUUID(),confirmPaid:false,maxCostUsd:0.025},true);
  const jobs=await call('audio_jobs');
  for(const operation of ['generate','import']) {
    const completed=jobs.jobs?.find(j=>j.operation===operation&&j.status==='completed');
    if(completed){const d=await call('audio_'+operation,{...completed.payload,requestId:completed.id});record(operation+' completed replay only',d.reused===true&&d.job?.id===completed.id);}
    else record(operation+' replay not covered',false,{reason:'no safe completed request'});
  }
  const missing='00000000-0000-4000-8000-000000000001';
  await call('audio_update_asset',{id:missing,title:'Validation only'},true);
  await call('audio_review_asset',{id:missing,decision:'approved',qualityConfirmed:false,rightsConfirmed:false},true);
  await call('audio_use_asset',{id:missing,requestId:crypto.randomUUID(),purpose:'validation only'},true);
}catch(e){record('MCP suite',false,{error:e.message});}
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
let activePage;
try {
  const context=await browser.newContext({viewport:{width:1440,height:1050}});const page=await context.newPage();page.setDefaultTimeout(20000);
  activePage=page;
  // Keep the real HTTPS origin/cookie semantics while exercising the isolated candidate build.
  if(input.candidateUrl)await page.route(base+'/**',async route=>{
    try {
      const url=new URL(route.request().url());
      const response=await route.fetch({url:input.candidateUrl+url.pathname+url.search});
      await route.fulfill({response});
    } catch { await route.abort().catch(()=>{}); } // Closing a context must never dump request cookies.
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  if(base.startsWith('http://127.0.0.1'))await page.route('**/api/audio/studio/**',r=>r.continue({headers:{...r.request().headers(),origin:'https://auto-parse-v2.vyibc.com'}}));
  const session=page.waitForResponse(r=>r.url().includes('/api/audio/studio/session'));
  await page.goto(base+'/audio-library',{waitUntil:'domcontentloaded'});await session;
  await page.getByRole('button',{name:'发现素材',exact:true}).click();
  await page.locator('article').first().waitFor();record('public search cards',await page.locator('article').count()>0);
  const repeat=page.waitForResponse(r=>r.url().includes('/api/audio/search'));
  await page.getByRole('button',{name:'搜索素材',exact:true}).click();record('same query resubmits',(await repeat).status()===200);
  async function search(q){const r=page.waitForResponse(r=>r.url().includes('/api/audio/search'));await page.getByLabel('搜索音频素材').fill(q);await page.getByRole('button',{name:'搜索素材',exact:true}).click();return r;}
  for(const q of ['footsteps','雨声','zzqxnosuchsound20261021']){const r=await search(q);const d=await r.json();record('public search '+q,r.ok()&&Array.isArray(d.items)&&(q.startsWith('zzqx')?d.items.length===0:d.items.length>0),{count:d.items?.length});}
  await search('piano');await page.locator('article').first().waitFor();
  const before=await page.locator('article').count();
  await page.route('**/api/audio/search?**',route=>route.fulfill({status:502,contentType:'text/html',body:'<html>Bad Gateway</html>'}),{times:1});
  await search('test-html');await page.getByText(/返回格式异常/).waitFor();
  record('HTML failure friendly and previous results retained',await page.locator('article').count()===before);
  const retry=page.waitForResponse(r=>r.url().includes('/api/audio/search'));await page.getByRole('button',{name:'重试',exact:true}).click();record('retry button requests',(await retry).status()===200);
  await search('piano');await page.locator('article').first().waitFor();
  const filterResponse=page.waitForResponse(r=>r.url().includes('length=shortest'));await page.getByLabel('时长筛选').selectOption('shortest');const filtered=await (await filterResponse).json();
  record('duration filter applied',filtered.items.every(x=>x.durationMs!==null&&x.durationMs<30000));
  const licenseResponse=page.waitForResponse(r=>r.url().includes('license=cc0'));await page.getByLabel('授权筛选').selectOption('cc0');const licensed=await (await licenseResponse).json();
  record('license filter applied',licensed.items.every(x=>/^(CC[ -]?0|Public domain)/i.test(x.license)));
  await page.setViewportSize({width:390,height:844});record('mobile no overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1440,height:1050});
  await page.getByRole('button',{name:'我的素材库',exact:true}).first().click();
  if(base.startsWith('http:')){await context.addCookies([{name:'audio_studio_access',value:input.accessToken,url:base+'/api/audio/studio',httpOnly:true,sameSite:'Strict'}]);await page.reload({waitUntil:'domcontentloaded'});}
  else{await page.getByLabel('工作室访问密钥').fill(input.accessToken);await page.getByRole('button',{name:'连接工作室',exact:true}).click();}
  await page.getByText('● 私有工作室已连接',{exact:true}).waitFor();await page.locator('article audio').first().waitFor();record('private library visible',true);
  const playback=await page.locator('article audio').first().evaluate(async a=>{await Promise.race([a.play(),new Promise((_,reject)=>setTimeout(()=>reject(Error('play timeout')),10000))]);await new Promise(r=>setTimeout(r,1200));a.pause();return {currentTime:a.currentTime,duration:a.duration};});record('private audio playback',playback.currentTime>0,playback);
  await page.getByRole('button',{name:'按需生成',exact:true}).first().click();await page.getByRole('button',{name:'检查是否有上次未确认的提交'}).click();await page.getByRole('button',{name:'获取报价（不扣费）'}).click();await page.getByText(/本次预估/).waitFor();record('quote and paid confirmation gate',await page.getByRole('button',{name:'确认付费生成'}).isDisabled());
  await page.getByRole('button',{name:'任务记录',exact:true}).click();await page.getByRole('heading',{name:'任务与费用记录'}).waitFor();
  await page.locator('article').first().waitFor();record('task page renders actual records',await page.locator('article').count()>0);
  record('no browser runtime errors',errors.length===0,{errors});
  await page.screenshot({path:new URL('browser.png',dir).pathname,fullPage:true});
}catch(e){record('browser suite',false,{error:e.message.split('\n')[0].replaceAll(input.accessToken,'[REDACTED]'),alerts:await activePage?.getByRole('alert').allTextContents()});}finally{await activePage?.unrouteAll({behavior:'wait'});await browser.close();}
console.log(JSON.stringify({summary:{passed:evidence.filter(r=>r.ok).length,failed:evidence.filter(r=>!r.ok).length},noNewPaidJobs:true}));
if(evidence.some(r=>!r.ok))process.exitCode=1;
