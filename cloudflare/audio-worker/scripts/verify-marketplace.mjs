// Read-only capability installation acceptance; never submits paid audio jobs.
import {createInterface} from 'node:readline';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from '../../../node_modules/playwright/index.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const rl=createInterface({input:process.stdin});
const input=await new Promise(resolve=>rl.once('line',line=>{rl.close();resolve(JSON.parse(line));}));
const base=input.base||'https://fleet.vyibc.com';
if(!['https://fleet.vyibc.com','https://fleet-console.2513120790.workers.dev'].includes(base))throw Error('Unexpected marketplace');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
const page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
const directory='../../.data/audio-studio-verification';mkdirSync(directory,{recursive:true});
const label=(input.candidate?'candidate':input.admin?'admin':'guest')+'-'+new URL(base).hostname;
const check=(name,ok)=>{checks.push({name,ok});console.log(JSON.stringify({name,ok}));if(!ok)throw Error(name);};
try{
 if(input.candidate){
  const {HUB_WORKSPACE_HTML}=await import(input.candidate);
  await page.route('**/hub-workspace',r=>r.fulfill({contentType:'text/html',body:HUB_WORKSPACE_HTML}));
  await page.route('**/api/hub/registry',async route=>{
   const response=await route.fetch(),r=await response.json();
   const audio=r.mcp.find(m=>m.id==='auto-parse-audio');
   Object.assign(audio,{runtime:'cf',external:true,auth:'token',authModes:['service-token'],tokenScope:'audio:owner-private'});
   delete audio.authDescriptor;
   await route.fulfill({response,json:r});
  });
 }
 // Login is the only allowed POST; no registry/installation/generation mutations.
 await page.route('**/api/**',route=>{
  const r=route.request();if(!['GET','HEAD'].includes(r.method())&&!r.url().endsWith('/api/hub/admin/login'))return route.abort();
  return route.fallback();
 });
 if(input.admin){
  const r=await context.request.post(base+'/api/hub/admin/login',{headers:{Origin:base},data:{username:input.admin.username,password:input.admin.password,remember:false}});
  check('existing administrator login',r.ok());
 }
 await page.goto(base+'/hub-workspace#/hub?view=capabilities',{waitUntil:'domcontentloaded',timeout:60000});
 await page.locator('#syncStatus').getByText(/实时目录|已同步/).waitFor({timeout:60000});
 await page.locator('#tabCapabilities').click();
 await page.locator('#search').fill('auto-parse-audio');
 const row=page.locator('[data-row="mcp:auto-parse-audio"]');await row.waitFor();
 await row.getByRole('button',{name:'安装与配置'}).click();
 await page.locator('#installDialog').waitFor({state:'visible'});
 const copy=page.locator('[data-copy-command="codex-mcp-install"]');await copy.waitFor({timeout:20000});
 check('visible native Codex command',await page.getByRole('heading',{name:'Codex · MCP 安装命令（Bash）'}).isVisible());
 await copy.click();const command=await page.evaluate(()=>navigator.clipboard.readText());
 check('copied endpoint and environment-based authentication',command.includes('codex mcp add')&&command.includes('auto-parse-audio.2513120790.workers.dev/mcp')&&command.includes('--bearer-token-env-var MCP_AUTO_PARSE_AUDIO_TOKEN'));
 check('copy has no credential value',!input.accessToken||!command.includes(input.accessToken));
 check('no unsupported auth warning',!(await page.locator('#installDialog').innerText()).includes('认证方式尚未适配'));
 if(input.admin){
  const jsonCopy=page.locator('[data-copy-command="mcp-config"]');await jsonCopy.waitFor({timeout:40000});
  await jsonCopy.click();const config=JSON.parse(await page.evaluate(()=>navigator.clipboard.readText()));
  check('authorized JSON resolves the audio service token only',config.mcpServers['auto-parse-audio'].headers.Authorization==='Bearer '+input.accessToken);
  check('token masked in visible DOM',!(await page.locator('body').innerText()).includes(input.accessToken));
 }
 await page.screenshot({path:directory+'/mcp-install-'+label+'-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 check('mobile no document overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 check('mobile installation command visible',await copy.isVisible());
 await page.screenshot({path:directory+'/mcp-install-'+label+'-mobile.png'});
 check('no browser runtime errors',errors.length===0);
 if(input.accessToken){
  const client=new Client({name:'audio-install-readonly-verifier',version:'0.1.0'});
  const transport=new StreamableHTTPClientTransport(new URL('https://auto-parse-audio.2513120790.workers.dev/mcp'),{requestInit:{headers:{Authorization:'Bearer '+input.accessToken}}});
  try{await client.connect(transport);const list=await client.listTools();check('actual MCP connection exposes eleven tools',list.tools.length===11);const r=await client.callTool({name:'audio_capabilities',arguments:{}});check('readonly capabilities call succeeds',!r.isError);}finally{await client.close();}
 }
 writeFileSync(directory+'/marketplace-install-'+label+'.json',JSON.stringify({base,candidate:!!input.candidate,checks},null,2));
}finally{await context.clearCookies();await browser.close();}
