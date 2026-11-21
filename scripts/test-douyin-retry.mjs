import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const clean=s=>stripTypeScriptTypes(s,{mode:'transform'}).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
const src=clean(await fs.readFile(new URL('../lib/workflow/douyin-request-retry.ts',import.meta.url),'utf8'));
const ledger=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(await fs.readFile(new URL('../lib/workflow/douyin-publication-ledger.ts',import.meta.url),'utf8'),{mode:'transform'})).toString('base64'));
const wid='34f421be-f97c-498a-9c80-5214564abd1c',oldId='00000000-0000-4000-8000-000000000001',nextId='00000000-0000-4000-8000-000000000002';
for(const mode of ['busy','not-submitted','unknown','ledger-exists','concurrent'])test('guarded same-request retry '+mode,async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'douyin-retry-'));const req={requestId:'stable-request-123',expectedAccountId:'12345678',videoUrl:'https://resource.vyibc.com/a.mp4',title:'test',description:'body',topics:[],aiGenerated:true,confirmPublish:true,prepareOnly:false};
 const id=ledger.publicationIdentity(req.requestId,req.expectedAccountId,req.videoUrl,req.title,req.aiGenerated,req);
 const folder=path.join(dir,'.data','douyin-workflow-requests');await fs.mkdir(folder,{recursive:true});
 const file=path.join(folder,'publish-'+id.key+'.json');await fs.writeFile(file,JSON.stringify({fingerprint:id.fingerprint,taskId:oldId}));
 const task={taskId:oldId,workflowId:wid,status:'error',errorMessage:'managed_browser_busy',steps:[{status:'pending'}],workflow:{nodes:[{params:{douyinPublication:req}}]}};
 if(mode==='unknown'||mode==='not-submitted'){task.errorMessage='publication_failed';task.steps=[{status:'error',output:{publicationDiagnostic:{submissionState:mode==='unknown'?'unknown':'not_submitted'}}}]}
 if(mode==='ledger-exists'){await fs.mkdir(path.join(dir,'.data','douyin-publications'));await fs.writeFile(path.join(dir,'.data','douyin-publications',id.key+'.json'),'{}')}
 let starts=0;const tasks=new Map([[oldId,task]]);
 const box={...fs,path,spawn,Error,JSON,String,Promise,setTimeout,clearTimeout,structuredClone,process:{cwd:()=>dir},DOUYIN_WORKFLOW_ID:wid,publicationIdentity:ledger.publicationIdentity,getWorkflowTask:id=>tasks.get(id),startDouyinWorkflow:async p=>{starts++;assert.equal(p.requestId,req.requestId);await new Promise(r=>setTimeout(r,80));const fd=await fs.open(file,'wx');await fd.writeFile(JSON.stringify({fingerprint:id.fingerprint,taskId:nextId}));await fd.close();tasks.set(nextId,{status:'running'});return{ok:true,taskId:nextId,status:'running'}}};
 vm.createContext(box);vm.runInContext(src,box);
 try{
  if(mode==='unknown'||mode==='ledger-exists'){await assert.rejects(box.retryDouyinVideoTask(oldId,true),/retry_not_safe|submission_exists/);assert.equal(starts,0);assert.equal(JSON.parse(await fs.readFile(file)).taskId,oldId)}
  else{
   if(mode==='concurrent'){const results=await Promise.allSettled([box.retryDouyinVideoTask(oldId,true),box.retryDouyinVideoTask(oldId,true)]);assert.ok(results.some(r=>r.status==='fulfilled'))}
   else {const r=await box.retryDouyinVideoTask(oldId,true);assert.equal(r.taskId,nextId);assert.equal(r.sameRequestId,true)}
   const again=await box.retryDouyinVideoTask(oldId,true);assert.equal(again.taskId,nextId);assert.equal(again.reused,true);assert.equal(starts,1);assert.equal(JSON.parse(await fs.readFile(file+'.before-retry-'+oldId+'.json')).taskId,oldId);
  }
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
