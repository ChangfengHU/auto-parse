import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { chromium } from 'playwright';

const source = stripTypeScriptTypes(await readFile(new URL('../lib/workflow/douyin-cover.ts', import.meta.url), 'utf8'), {mode:'transform'}).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
function api(fetcher = async()=>new Response(png)) {
 const s={URL,Buffer,AbortSignal,Response,Error,createHash,fetch:fetcher};vm.createContext(s);vm.runInContext(source+';globalThis.api={validateCoverUrl,downloadDouyinCover,fillDouyinCovers,douyinCoverControl,douyinCoverPreview}',s);return s.api;
}
for (const url of ['garbage','http://127.0.0.1/a.png','https://resource.vyibc.com/a.png?q=1','https://resource.vyibc.com/a.gif','https://user:pass@resource.vyibc.com/a.png']) test('reject unsafe cover URL '+url.replace(/user:pass/,'redacted'),()=>assert.throws(()=>api().validateCoverUrl(url),/cover_url_invalid/));
test('download hashes actual bytes and bounds requests',async()=>{
 let args;const a=api(async(...x)=>{args=x;return new Response(png)});
 const x=await a.downloadDouyinCover('https://resource.vyibc.com/cover.png');assert.equal(x.mimeType,'image/png');assert.equal(x.sha256,createHash('sha256').update(png).digest('hex'));assert.equal(args[1].redirect,'error');assert.ok(args[1].signal);
});
for(const [name,res,pattern] of [
 ['http',()=>new Response('missing',{status:404}),/cover_download_failed/],
 ['header limit',()=>new Response(png,{headers:{'content-length':String(8*1024*1024+1)}}),/cover_too_large/],
 ['stream limit',()=>new Response(Buffer.alloc(8*1024*1024+1)),/cover_too_large/],
 ['invalid bytes',()=>new Response('<html>not an image</html>'),/cover_format_invalid/]
])test('reject '+name+' before touching browser',async()=>{await assert.rejects(api(async()=>res()).downloadDouyinCover('https://resource.vyibc.com/cover.png'),pattern)});
let browser;async function fixture(mode='normal'){
 browser ||= await chromium.launch({headless:true,...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{}),args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.setContent(`<img src="data:image/png;base64,${png.toString('base64')}" alt="unrelated">
 ${[['horizontal','横封面4:3'],['vertical','竖封面3:4']].map(([id,label])=>`<div class="coverControl-test" data-orientation="${id}"><div class="cover-test" style="width:160px;height:120px;background:#ddd" onclick="openCover('${id}')"><span>选择封面</span></div><div><div>${label}</div></div></div>`).join('')}
 <script>
 let active,pending;
 function openCover(id){active=id;document.body.insertAdjacentHTML('beforeend','<div role="dialog"><button id="choose">上传封面</button><div class="semi-upload"><input class="semi-upload-hidden-input" id="file" type="file" accept="image/png,image/jpeg" hidden><div>点击上传文件或拖拽文件到这里</div></div><button id="done" disabled>完成</button></div>');
 document.querySelector('#choose').onclick=()=>document.querySelector('#file').click();
 document.querySelector('#file').onchange=e=>{const reader=new FileReader();reader.onload=()=>{pending=reader.result;document.querySelector('#done').disabled=false};reader.readAsDataURL(e.target.files[0]);};
 const commit=()=>{const mode='${mode}';if(mode!=='ignore'){for(const c of document.querySelectorAll('[data-orientation]'))if(c.dataset.orientation===active||mode==='overwrite')c.querySelector('.cover-test').style.backgroundImage='url("'+pending+'#'+active+'")';}document.querySelector('[role="dialog"]').remove();};document.querySelector('#done').onclick=()=>{if('${mode}'==='offer'){const popup=document.createElement('div');popup.setAttribute('role','dialog');popup.innerHTML='<h2>设置横封面获更多流量</h2><button>暂不设置</button>';popup.querySelector('button').onclick=()=>{commit();popup.remove()};document.body.appendChild(popup)}else commit()};}
 </script>`);
 return page;
}
after(async()=>{await browser?.close()});
test('real browser chooses by orientation despite horizontal-first DOM and verifies CSS previews',async()=>{
 const page=await fixture();try{const a=api(),out=await a.fillDouyinCovers(page,{verticalUrl:'https://resource.vyibc.com/v.png',horizontalUrl:'https://resource.vyibc.com/h.png'});assert.equal(out.urls.vertical,'https://resource.vyibc.com/v.png');assert.equal(out.urls.horizontal,'https://resource.vyibc.com/h.png');assert.ok(out.evidence.vertical.previewChanged);assert.ok(out.evidence.horizontal.dialogConfirmed);for(const key of ['vertical','horizontal'])assert.equal(out.evidence[key].sha256,createHash('sha256').update(png).digest('hex'));}finally{await page.close()}
});
test('unrelated image cannot certify cover application; failure preserves orientation and stage',async()=>{
 const page=await fixture('ignore');page.waitForTimeout=async()=>{};try{await assert.rejects(api().fillDouyinCovers(page,{verticalUrl:'https://resource.vyibc.com/v.png'}),e=>e.message==='publication_cover_not_applied'&&e.orientation==='vertical'&&e.stage==='verify_preview')}finally{await page.close()}
});
test('second orientation cannot silently overwrite the first',async()=>{
 const page=await fixture('overwrite');try{await assert.rejects(api().fillDouyinCovers(page,{verticalUrl:'https://resource.vyibc.com/v.png',horizontalUrl:'https://resource.vyibc.com/h.png'}),/previous_orientation_changed/)}finally{await page.close()}
});

test('optional second-orientation recommendation is dismissed without blocking requested covers',async()=>{
 const page=await fixture('offer');try{const out=await api().fillDouyinCovers(page,{verticalUrl:'https://resource.vyibc.com/v.png',horizontalUrl:'https://resource.vyibc.com/h.png'});assert.ok(out.evidence.vertical.dialogConfirmed);assert.ok(out.evidence.horizontal.dialogConfirmed);assert.equal(await page.getByRole('dialog').count(),0);}finally{await page.close()}
});
