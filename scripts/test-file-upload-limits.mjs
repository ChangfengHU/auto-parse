import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {test} from 'node:test';
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../lib/workflow/nodes/file-upload.ts',import.meta.url),'utf8'),{mode:'transform'}).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
const context={URL,fs,os,path,http,https,pipeline,Transform};vm.createContext(context);
vm.runInContext(source+'\nglobalThis.download=downloadToTemp;globalThis.limit=REMOTE_UPLOAD_MAX_BYTES;globalThis.chunk=REMOTE_UPLOAD_CHUNK_BYTES;',context);
test('published cap is512MiB and CDP chunks stay256KiB',()=>{assert.equal(context.limit,536870912);assert.equal(context.chunk,262144);});
for(const mode of ['header-too-large','chunked-too-large','exact-boundary','legacy-over50MiB']){
 test('bounded download: '+mode,async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wf-upload-limit-test-'));const file=path.join(dir,'video.mp4');
  const max=mode==='legacy-over50MiB'?context.limit:1024*1024;
  const total=mode==='legacy-over50MiB'?51*1024*1024:mode==='exact-boundary'?max:max+1;
  const server=http.createServer(async(_req,res)=>{
   res.on('error',()=>{});
   if(mode==='header-too-large'){res.writeHead(200,{'Content-Length':total});res.flushHeaders();return;}
   res.writeHead(200,{'Transfer-Encoding':'chunked'});
   const chunk=Buffer.alloc(64*1024,0x5a);
   for(let sent=0;sent<total;){if(res.destroyed)return;const n=Math.min(chunk.length,total-sent);sent+=n;
    if(!res.write(chunk.subarray(0,n)))await new Promise(resolve=>{const done=()=>{res.off('drain',done);res.off('close',done);resolve();};res.once('drain',done);res.once('close',done);});
   }res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
   const operation=context.download('http://127.0.0.1:'+server.address().port+'/video.mp4',file,max);
   if(mode.endsWith('too-large')){await assert.rejects(operation,/remote_upload_file_too_large/);if(fs.existsSync(file))assert.ok(fs.statSync(file).size<=max);}
   else{await operation;assert.equal(fs.statSync(file).size,total);assert.equal(fs.statSync(file).mode&0o777,0o600);}
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
 });
}
