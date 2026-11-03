import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
function setup(){
 const store=new Map(),runtime={};const module={exports:{}};
 const source=fs.readFileSync(new URL('../lib/wechat/web-verification-link.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const local=n=>n.includes('session-store')?{getSession:id=>store.get(id)}:require(n);
 vm.runInNewContext(code,{module,exports:module.exports,require:local,global:runtime,Date,Map});
 return {store,api:module.exports};
}
test('verification grant resolves only its live owned publication session',()=>{
 const x=setup();let open=true;
 const session={workflowId:'cea6d731-ce15-46d8-95fb-f420ebfacb93',_managedByMcp:true,_page:{isClosed:()=>!open}};
 x.store.set('s1',session);const a=x.api.issueWechatVerificationLink('s1'),b=x.api.issueWechatVerificationLink('s1');
 const token=a.url.split('#').pop();assert.notEqual(a.url,b.url);assert.equal(x.api.resolveWechatVerificationGrant(token),session);
 assert.equal(x.api.resolveWechatVerificationGrant('wrong'),undefined);
 open=false;assert.equal(x.api.resolveWechatVerificationGrant(token),undefined);
});
test('grant rejects unowned and incorrect workflows',()=>{
 const x=setup();const session={workflowId:'unrelated',_managedByMcp:true,_page:{isClosed:()=>false}};x.store.set('s1',session);
 const token=x.api.issueWechatVerificationLink('s1').url.split('#').pop();assert.equal(x.api.resolveWechatVerificationGrant(token),undefined);
});

test('verification grants are time-limited and are revoked after session removal',()=>{
 const store=new Map(),runtime={},module={exports:{}},source=fs.readFileSync(new URL('../lib/wechat/web-verification-link.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 let now=1000000000000;class FakeDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 vm.runInNewContext(code,{module,exports:module.exports,require:n=>n.includes('session-store')?{getSession:id=>store.get(id)}:require(n),global:runtime,Date:FakeDate,Map});
 store.set('s1',{workflowId:'cea6d731-ce15-46d8-95fb-f420ebfacb93',_managedByMcp:true,_page:{isClosed:()=>false}});
 const first=module.exports.issueWechatVerificationLink('s1').url.split('#').pop();now+=10*60*1000;assert.equal(module.exports.resolveWechatVerificationGrant(first),undefined);
 const second=module.exports.issueWechatVerificationLink('s1').url.split('#').pop();store.delete('s1');assert.equal(module.exports.resolveWechatVerificationGrant(second),undefined);
});
