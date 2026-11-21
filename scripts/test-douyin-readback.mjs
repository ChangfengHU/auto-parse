import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const clean=s=>stripTypeScriptTypes(s,{mode:'transform'}).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
const source=clean(await readFile(new URL('../lib/workflow/douyin-publication-readback.ts',import.meta.url),'utf8'));
const parseCreationBody=t=>JSON.parse(t.replace(/("(?:aweme_id|item_id)"\s*:\s*)(\d{16,30})(?=\s*[,}])/g,'$1"$2"'));
for(const mode of ['found','missing','wrong-session','wrong-author','duplicate'])test('creator readback '+mode+' owns its tab and never submits',async()=>{
 const events=[],account='12345678',id='7710524155761822976';
 const item={aweme_id:id,author:{uid:mode==='wrong-author'?'99999999':account},desc:'test',status:{private_status:0},video_control:{allow_download:false},video:{cover:{uri:'cover-uri',url_list:['https://example.com/cover.webp']}}};
 const body={status_code:0,aweme_list:mode==='missing'?[]:mode==='duplicate'?[item,item]:[item]};
 const page={waitForResponse:async pred=>{assert.equal(pred({url:()=> 'https://creator.douyin.com/janus/douyin/creator/pc/work_list',request:()=>({method:()=> 'GET'})}),true);return{ok:()=>true,text:async()=>JSON.stringify(body)}},goto:async()=>events.push('navigate'),evaluate:async()=>mode==='wrong-session'?'99999999':account,close:async()=>events.push('close-tab')};
 const browser={contexts:()=>[{newPage:async()=>page}],close:async()=>events.push('disconnect')};
 const sandbox={Error,URL,Date,Number,Object,String,parseCreationBody,acquireManagedBrowserActivity:async()=>async()=>events.push('release'),chromium:{connectOverCDP:async()=>browser}};
 vm.createContext(sandbox);vm.runInContext(source,sandbox);
 if(['wrong-session','wrong-author','duplicate'].includes(mode))await assert.rejects(sandbox.getDouyinVideoPublication(account,id),/mismatch|ambiguous/);
 else{const r=await sandbox.getDouyinVideoPublication(account,id);assert.equal(r.found,mode==='found');if(r.found){assert.equal(r.downloadPermission,false);assert.equal(r.visibility,'public');assert.equal(r.publicVisibilityVerified,false)}else assert.equal(r.complete,false)}
 assert.deepEqual(events,['navigate','close-tab','disconnect','release']);
});
test('invalid identifiers never acquire a browser lease',async()=>{
 const sandbox={Error,acquireManagedBrowserActivity:()=>assert.fail('lease must not be acquired')};vm.createContext(sandbox);vm.runInContext(source,sandbox);await assert.rejects(sandbox.getDouyinVideoPublication('bad','bad'),/input_invalid/);
});
