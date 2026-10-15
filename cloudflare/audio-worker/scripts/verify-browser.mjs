import {createInterface} from 'node:readline';
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {chromium} from '../../../node_modules/playwright/index.mjs';
const rl=createInterface({input:process.stdin});
const input=await new Promise(resolve=>rl.once('line',line=>{rl.close();resolve(JSON.parse(line));}));
const base=input.base||'https://auto-parse-v2.vyibc.com';
const dir='../../.data/audio-studio-verification';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({viewport:{width:1440,height:1050}});const page=await context.newPage();
if(base.startsWith('http://127.0.0.1:'))await page.route('**/api/audio/studio/**',route=>route.continue({headers:{...route.request().headers(),origin:'https://auto-parse-v2.vyibc.com'}}));
const evidence=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('response',response=>{const path=new URL(response.url()).pathname;if(path.startsWith('/api/audio/'))console.log(JSON.stringify({path,status:response.status()}));});
function check(name,ok,detail={}){evidence.push({name,ok,...detail});console.log(JSON.stringify(evidence.at(-1)));writeFileSync(`${dir}/browser-results.json`,JSON.stringify(evidence,null,2));if(!ok)throw new Error(`Failed: ${name}`);}
try{
  await page.goto(`${base}/audio-library`,{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByRole('heading',{name:'连接你的私有声音库'}).waitFor();
  check('page loads without exposing private library',await page.getByText('连接你的私有声音库',{exact:true}).isVisible());
  await page.screenshot({path:`${dir}/desktop-locked.png`,fullPage:true});
  if(base.startsWith('http://')){
    await context.addCookies([{name:'audio_studio_access',value:input.accessToken,url:base+'/api/audio/studio',httpOnly:true,sameSite:'Strict'}]);await page.reload({waitUntil:'domcontentloaded'});
  }else{
    await page.getByLabel('工作室访问密钥').fill(input.accessToken);await page.getByRole('button',{name:'连接工作室',exact:true}).click();
  }
  await page.getByText('● 私有工作室已连接',{exact:true}).waitFor({timeout:60000});
  check('authenticated studio login',true);
  const cookies=await context.cookies(`${base}/api/audio/studio/session`);const cookie=cookies.find(c=>c.name==='audio_studio_access');
  check('HttpOnly SameSite session',cookie?.httpOnly&&cookie?.sameSite==='Strict'&&(!base.startsWith('https')||cookie?.secure));
  await page.getByRole('heading',{name:'我的素材库',exact:true}).waitFor();
  await page.locator('article').first().waitFor({timeout:45000});
  const cards=page.locator('article');check('real saved assets visible',await cards.count()>=1,{count:await cards.count()});
  for(let index=0;index<await page.locator('article audio').count();index++){
    const playback=await page.locator('article audio').nth(index).evaluate(async audio=>{await audio.play();await new Promise(r=>setTimeout(r,1400));const result={duration:audio.duration,currentTime:audio.currentTime,readyState:audio.readyState};audio.pause();return result;});
    check('private R2 browser playback',playback.currentTime>0,{index,playback});
  }
  await page.getByRole('button',{name:'标签与验收',exact:true}).first().click();
  const editor=page.getByRole('region',{name:'素材验收与标签编辑'});
  await editor.getByLabel('标签（逗号分隔）').fill('测试样本, 已验证播放, 日常');
  await editor.getByLabel('适用场景',{exact:true}).fill('音频工作室验证');
  await editor.getByRole('button',{name:'保存标签',exact:true}).click();
  await editor.getByText('标签已保存',{exact:true}).waitFor({timeout:30000});check('tags persisted from page',true);
  check('approval disabled before human confirmations',await editor.getByRole('button',{name:'验收通过并入库'}).isDisabled());
  // Do not falsely assert subjective audio/rights approval on behalf of the owner.
  await editor.getByRole('button',{name:'关闭',exact:true}).click();
  await page.screenshot({path:`${dir}/desktop-library.png`,fullPage:true});
  await page.getByRole('button',{name:'按需生成',exact:true}).first().click();
  await page.getByRole('button',{name:'检查是否有上次未确认的提交'}).click();
  await page.getByRole('button',{name:'获取报价（不扣费）'}).click();
  await page.getByText(/本次预估/).waitFor({timeout:30000});
  check('quote no charge and paid action gated',await page.getByRole('button',{name:'确认付费生成'}).isDisabled());
  await page.screenshot({path:`${dir}/desktop-generate.png`,fullPage:true});
  await page.getByRole('button',{name:'任务记录',exact:true}).click();
  await page.getByRole('heading',{name:'任务与费用记录'}).waitFor();check('jobs page',true);
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'我的素材库',exact:true}).click();await page.waitForTimeout(1000);
  check('mobile no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.screenshot({path:`${dir}/mobile-library.png`,fullPage:true});
  check('no React runtime errors',errors.length===0,{errors});
  if(!base.startsWith('http://')){
    const csrf=await context.request.post(`${base}/api/audio/studio/quote`,{headers:{Origin:'https://evil.example'},data:{}});check('page proxy CSRF rejected',csrf.status()===403);
    await page.getByRole('button',{name:'断开连接',exact:true}).click();await page.getByRole('heading',{name:'连接你的私有声音库'}).waitFor();
    const media=await context.request.get(`${base}/api/audio/studio/media/${JSON.parse(readFileSync(`${dir}/intents.json`,'utf8')).music}`);check('logout revokes media access',media.status()===401);
  }
}catch(error){await page.screenshot({path:`${dir}/browser-failure.png`,fullPage:true});console.log(JSON.stringify({alerts:await page.getByRole('alert').allTextContents(),errors}));throw error;}finally{await browser.close();}
