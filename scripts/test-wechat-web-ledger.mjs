import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript'),source=fs.readFileSync(new URL('../lib/wechat/web-publication-ledger.ts',import.meta.url),'utf8'),mod={exports:{}};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{module:mod,exports:mod.exports,require,Buffer});
const {reserveWebPublication,readWebPublication,finishWebPublication}=mod.exports;
function setup(){return fs.mkdtempSync(path.join(os.tmpdir(),'wechat-web-ledger-'))}
const account='gh_123456789abc',media='fixture-media';
test('reserves one durable intent per account and draft despite changed request ID',()=>{const d=setup();try{reserveWebPublication(d,account,media,'first');assert.equal(readWebPublication(d,account,media).state,'submitting');assert.throws(()=>reserveWebPublication(d,account,media,'second'),/existing_publication/);assert.equal(fs.readdirSync(d).length,1)}finally{fs.rmSync(d,{recursive:true,force:true})}});
test('unknown results cannot be silently retried',()=>{const d=setup();try{reserveWebPublication(d,account,media,'first');finishWebPublication(d,account,media,'first','unknown');assert.equal(readWebPublication(d,account,media).state,'unknown');assert.throws(()=>reserveWebPublication(d,account,media,'second'),/existing_publication/)}finally{fs.rmSync(d,{recursive:true,force:true})}});
test('requires matching request and evidence for submitted state',()=>{const d=setup();try{reserveWebPublication(d,account,media,'first');assert.throws(()=>finishWebPublication(d,account,media,'wrong','unknown'),/state_mismatch/);assert.throws(()=>finishWebPublication(d,account,media,'first','submitted'),/receipt_required/);finishWebPublication(d,account,media,'first','submitted',{id:'evidence'});assert.equal(readWebPublication(d,account,media).state,'submitted')}finally{fs.rmSync(d,{recursive:true,force:true})}});
