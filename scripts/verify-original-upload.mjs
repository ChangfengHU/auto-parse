import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import http from 'node:http';import https from 'node:https';
import {pipeline} from 'node:stream/promises';import {Transform} from 'node:stream';
import {stripTypeScriptTypes} from 'node:module';import vm from 'node:vm';
import {chromium} from 'playwright';
const [url,expectedHash,byteText,output]=process.argv.slice(2);const expectedBytes=Number(byteText);
if(!/^https:\/\//.test(url||'')||! /^[a-f0-9]{64}$/.test(expectedHash||'')||!(expectedBytes>50*1024*1024&&expectedBytes<=128*1024*1024))throw Error('explicit_original_input_required');
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../lib/workflow/nodes/file-upload.ts',import.meta.url),'utf8'),{mode:'transform'}).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
const sandbox={URL,os,path,fs,http,https,pipeline,Transform,Buffer,captureScreenshot:async()=>undefined};vm.createContext(sandbox);vm.runInContext(source+'\nglobalThis.execute=executeFileUpload;',sandbox);
const server=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><input type="file" id="video">');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
const started=Date.now();const before=os.freemem();
try{
 browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
 const result=await sandbox.execute(page,{url,selector:'#video',transferMode:'buffer'},{emit:()=>{}});assert.equal(result.success,true,JSON.stringify(result));
 const actual=await page.locator('#video').evaluate(async input=>{const file=input.files[0];const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());return {size:file.size,sha256:Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('')};});
 assert.equal(actual.size,expectedBytes);assert.equal(actual.sha256,expectedHash);assert.equal(fs.existsSync(result.output.tmpFile),false);
 const proof={status:'passed',...actual,elapsedMs:Date.now()-started,freeMemoryBefore:before,freeMemoryAfter:os.freemem(),scope:'actual upload node + isolated HTML input + Chromium File bytes; no Douyin upload and no publication',tempCleaned:true};
 if(output)fs.writeFileSync(output,JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
