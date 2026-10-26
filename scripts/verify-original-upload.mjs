import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import http from 'node:http';import https from 'node:https';import {createHash,randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';import {Transform} from 'node:stream';import {stripTypeScriptTypes} from 'node:module';import vm from 'node:vm';import {chromium} from 'playwright';
let [url,expectedHash,byteText,output]=process.argv.slice(2);const expectedBytes=Number(byteText);
if(!(/^(https:\/\/|fixture:)/.test(url||''))||! /^[a-f0-9]{64}$/.test(expectedHash||'')||!(expectedBytes>0&&expectedBytes<=512*1024*1024))throw Error('explicit_original_input_required');
const load=file=>stripTypeScriptTypes(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{mode:'transform'}).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
const sandbox={URL,os,path,fs,http,https,pipeline,Transform,Buffer,randomUUID,captureScreenshot:async()=>undefined};vm.createContext(sandbox);
vm.runInContext(load('../lib/workflow/browser-file-upload.ts')+'\n'+load('../lib/workflow/nodes/file-upload.ts')+'\nglobalThis.execute=executeFileUpload;',sandbox);
let verified;
const server=http.createServer(async(req,res)=>{try{
 if(req.url==='/verify'){const h=createHash('sha256');let size=0;for await(const chunk of req){size+=chunk.length;h.update(chunk);}verified={size,sha256:h.digest('hex')};res.end(JSON.stringify(verified));return;}
 if(req.url==='/source'){res.writeHead(200,{'Content-Length':expectedBytes});const chunk=Buffer.alloc(256*1024);for(let sent=0;sent<expectedBytes;){if(res.destroyed)return;const n=Math.min(chunk.length,expectedBytes-sent);sent+=n;if(!res.write(chunk.subarray(0,n)))await new Promise(resolve=>{const done=()=>{res.off('drain',done);res.off('close',done);resolve();};res.once('drain',done);res.once('close',done);});}res.end();return;}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><input type="file" id="video"><script>document.querySelector("input").onchange=async()=>{try{window.uploadVerified=await(await fetch("/verify",{method:"POST",body:document.querySelector("input").files[0]})).json()}catch{window.uploadFailed=true}};</script>');
 }catch{res.destroy();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));if(url.startsWith('fixture:'))url='http://127.0.0.1:'+server.address().port+'/source';
let browser;const started=Date.now(),before=os.freemem();
try{
 browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
 // Isolated page consumes its selected File before the real node's cleanup,
 // just as the creator site does. Never call file.arrayBuffer() on the full video.
 const uploadPage=new Proxy(page,{get(target,key){if(key==='waitForTimeout')return async()=>{await page.waitForFunction(()=>window.uploadVerified||window.uploadFailed,null,{timeout:300000});};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const result=await sandbox.execute(uploadPage,{url,selector:'#video',transferMode:'buffer'},{emit:()=>{}});assert.equal(result.success,true,JSON.stringify(result));
 assert.equal(verified?.size,expectedBytes);assert.equal(verified?.sha256,expectedHash);assert.equal(fs.existsSync(result.output.tmpFile),false);
 const remaining=await page.evaluate(async()=>{const root=await navigator.storage.getDirectory();const owner=await root.getDirectoryHandle('vyibc-workflow-upload-v1');const names=[];for await(const key of owner.keys())names.push(key);return names;});assert.equal(remaining.length,0);
 const proof={status:'passed',...verified,elapsedMs:Date.now()-started,freeMemoryBefore:before,freeMemoryAfter:os.freemem(),scope:'actual upload node + disk-backed Chromium File + native streaming HTTP upload, no Douyin publication',tempCleaned:true,browserTempCleaned:true,wholeFileArrayBufferUsed:false};if(output)fs.writeFileSync(output,JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
}finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
