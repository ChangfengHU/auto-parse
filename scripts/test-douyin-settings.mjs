import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const raw=stripTypeScriptTypes(await readFile(new URL('../lib/workflow/douyin-settings.ts',import.meta.url),'utf8'),{mode:'transform'}).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
const s={URL,Date,Intl,Error,RegExp,Object};vm.createContext(s);vm.runInContext(raw+';globalThis.api={normalizeDouyinSettings,validateDouyinSchedule,scheduledDisplay,applyDouyinSettings}',s);
const api=s.api;
test('legacy omission stays omitted; explicit settings normalize in stable order',()=>{
 assert.equal(api.normalizeDouyinSettings(undefined),undefined);
 const a=api.normalizeDouyinSettings({allowDownload:false,visibility:'private'});
 const b=api.normalizeDouyinSettings({visibility:'private',allowDownload:false});
 assert.equal(JSON.stringify(a),JSON.stringify(b));assert.equal(a.collectionName,null);assert.equal(a.scheduledAt,null);
});
for(const input of [null,[],{scheduledAt:'2026-02-30T12:00:00Z'},{extra:true},{visibility:'secret'},{allowDownload:'false'},{collectionName:''},{scheduledAt:'2026-11-22 12:00'},{scheduledAt:'2026-11-22T12:00:30Z'}])test('invalid settings fail before browser '+JSON.stringify(input),()=>assert.throws(()=>api.normalizeDouyinSettings(input),/publication_/));
test('schedule preserves the instant across offsets and enforces minute precision',()=>{assert.equal(api.normalizeDouyinSettings({scheduledAt:'2026-11-22T20:00:00+08:00'}).scheduledAt,'2026-11-22T12:00:00.000Z');assert.equal(api.scheduledDisplay('2026-11-22T12:00:00Z','Asia/Shanghai'),'2026-11-22 20:00');assert.equal(api.scheduledDisplay('2026-11-22T12:00:00Z','America/New_York'),'2026-11-22 07:00')});
test('schedule boundary is checked at execution and remains 2 hours to 14 days',()=>{const now=Date.parse('2026-11-21T00:00Z');api.validateDouyinSchedule(new Date(now+7200000).toISOString(),now);assert.throws(()=>api.validateDouyinSchedule(new Date(now+7199999).toISOString(),now),/outside_window/);assert.throws(()=>api.validateDouyinSchedule(new Date(now+14*86400000+1).toISOString(),now),/outside_window/)});
test('old request fingerprints remain unchanged; changed settings change the fingerprint',async()=>{
 const text=stripTypeScriptTypes(await readFile(new URL('../lib/workflow/douyin-publication-ledger.ts',import.meta.url),'utf8'),{mode:'transform'});
 const m=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
 const args=['request-12345','12345678','https://resource.vyibc.com/a.mp4','test',true];
 const meta={description:'body',topics:[],cover:null};
 const old=createHash('sha256').update(JSON.stringify([args[1],args[2],args[3],true,meta])).digest('hex');
 assert.equal(m.publicationIdentity(...args,meta).fingerprint,old);
 const extra={...meta,settings:api.normalizeDouyinSettings({allowDownload:false})};
 assert.notEqual(m.publicationIdentity(...args,extra).fingerprint,old);
});
let browser;after(async()=>{await browser?.close()});
async function fixture(){
 browser ||= await chromium.launch({headless:true,args:['--no-sandbox']});
 const p=await browser.newPage({timezoneId:'Asia/Shanghai',viewport:{width:1440,height:1000}});
 const groups=[['谁可以看',['公开','好友可见','仅自己可见']],['保存权限',['允许','不允许']],['同时发布',['不同时发布','同时发布到']],['发布时间',['立即发布','定时发布']]];
 await p.setContent(groups.map(([h,opts])=>'<section class="new-layout-test"><h3>'+h+'</h3>'+opts.map((t,i)=>'<label data-checked="'+(i===0)+'" onclick="pick(this)"><input type="checkbox" '+(i===1?'checked':'')+'><span style="pointer-events:none">'+t+'</span></label>').join('')+(h==='发布时间'?'<input placeholder="日期和时间">':'')+'</section>').join('')+
 '<section class="new-layout-test"><h3>添加合集</h3><div class="semi-select select-mix-type-test">合集</div><div class="semi-select" id="picker" onclick="openOptions()">请选择合集</div></section>'+
 `<script>function pick(el){for(const l of el.parentElement.querySelectorAll('label'))l.dataset.checked=String(l===el)}
 function openOptions(){const box=document.createElement('div');box.setAttribute('role','listbox');for(const name of ['不选择合集','AI · 每日(测试)']){const o=document.createElement('div');o.setAttribute('role','option');o.innerText=name;o.onclick=()=>{document.querySelector('#picker').innerText=name;box.remove()};box.append(o)}document.body.append(box)}</script>`);
 return p;
}
test('real DOM: all visibility values and download choices use labels rather than stale native checked flags',async()=>{
 const p=await fixture();try{for(const visibility of ['private','friends','public']){const r=await api.applyDouyinSettings(p,{visibility,allowDownload:false});assert.equal(r.visibility,visibility);assert.equal(r.allowDownload,false);assert.equal(r.editorVerified,true);assert.equal(r.crossPosting,'none')}}finally{await p.close()}
});
test('real DOM: exact collection names with regex characters and scheduled timezone are verified',async()=>{
 const p=await fixture();try{const when=new Date(Math.ceil((Date.now()+4*3600000)/60000)*60000).toISOString();const r=await api.applyDouyinSettings(p,{collectionName:'AI · 每日(测试)',scheduledAt:when});assert.equal(r.collectionName,'AI · 每日(测试)');assert.equal(r.timeZone,'Asia/Shanghai');assert.equal(r.scheduledAt,when);assert.equal(r.collectionOptions.complete,false);assert.ok(r.collectionOptions.observedNames.includes('AI · 每日(测试)'))}finally{await p.close()}
});
test('missing controls fail with the exact field and never claim editor verification',async()=>{
 const p=await fixture();try{await p.getByText('保存权限',{exact:true}).locator('..').evaluate(e=>e.remove());await assert.rejects(api.applyDouyinSettings(p,{allowDownload:false}),e=>e.field==='allowDownload'&&e.message==='publication_settings_control_unconfirmed')}finally{await p.close()}
});

test('already-empty collection must not open a native popup that can block the next declaration',async()=>{
 const p=await fixture();try{await p.evaluate(()=>{window.openOptions=()=>{throw Error('empty collection must not reopen')}});const r=await api.applyDouyinSettings(p,{visibility:'public',allowDownload:false});assert.equal(r.collectionName,null);assert.equal(r.editorVerified,true);assert.equal(await p.getByRole('listbox').count(),0)}finally{await p.close()}
});
