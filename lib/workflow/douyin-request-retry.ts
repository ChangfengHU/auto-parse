import {spawn} from 'node:child_process';
import path from 'node:path';
import {open,readFile,rename,stat} from 'node:fs/promises';
import {getWorkflowTask} from './workflow-task-cli';
import {startDouyinWorkflow,DOUYIN_WORKFLOW_ID} from './douyin-workflow-service';
import {publicationIdentity} from './douyin-publication-ledger';
import type {ClickParams} from './types';

async function exists(file:string){try{await stat(file);return true}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e}}
async function retryLock(file:string):Promise<()=>Promise<void>>{
 const fd=await open(file,'a',0o600);await fd.close();
 return new Promise((resolve,reject)=>{
  const child=spawn('flock',['--nonblock','--no-fork',file,'sh','-c',"printf 'locked\\n'; cat >/dev/null"],{stdio:['pipe','pipe','ignore']});
  let granted=false;const ended=new Promise<void>(done=>child.once('exit',()=>done()));
  const timer=setTimeout(()=>{child.stdin.destroy();child.kill();reject(Error('publication_retry_lock_timeout'))},5000);
  child.stdin.on('error',()=>{});
  child.once('error',()=>{clearTimeout(timer);child.stdin.destroy();reject(Error('publication_retry_lock_unavailable'))});
  child.once('exit',()=>{clearTimeout(timer);if(!granted)reject(Error('publication_retry_busy'))});
  child.stdout.once('data',data=>{if(String(data).trim()!=='locked'){child.stdin.destroy();child.kill();return}granted=true;clearTimeout(timer);resolve(async()=>{child.stdin.end();await ended})});
 });
}
export async function retryDouyinVideoTask(taskId:string,confirmRetry:boolean){
 if(!/^[a-f0-9-]{36}$/.test(taskId))throw Error('publication_input_invalid');
 if(confirmRetry!==true)throw Error('publication_retry_confirmation_required');
 const old=getWorkflowTask(taskId);
 if(!old||old.workflowId!==DOUYIN_WORKFLOW_ID)throw Error('platform_video_task_not_found');
 const index=old.workflow.nodes.findIndex(n=>n.params.douyinPublication);
 const params=old.workflow.nodes[index]?.params.douyinPublication as NonNullable<ClickParams['douyinPublication']>|undefined;
 if(!params||old.publication||old.status!=='error')throw Error('publication_retry_not_safe');
 const safeBootstrap=old.errorMessage==='managed_browser_busy'&&old.steps.every(s=>s.status==='pending');
 const diagnostic=old.steps.find(s=>s.status==='error')?.output?.publicationDiagnostic as {submissionState?:string}|undefined;
 const safeBefore=index>=0&&old.steps.slice(index).every(s=>s.status==='pending')&&old.steps.slice(0,index).some(s=>s.status==='error');
 if(!safeBootstrap&&diagnostic?.submissionState!=='not_submitted'&&!safeBefore)throw Error('publication_retry_not_safe');
 const identity=publicationIdentity(params.requestId,params.expectedAccountId,params.videoUrl,params.title,params.aiGenerated,params);
 const dir=path.join(process.cwd(),'.data','douyin-workflow-requests');
 const file=path.join(dir,(params.prepareOnly?'preview-':'publish-')+identity.key+'.json');
 const release=await retryLock(file+'.retry.lock');
 try{
  const saved=JSON.parse(await readFile(file,'utf8'));
  if(saved.fingerprint!==identity.fingerprint)throw Error('publication_request_conflict');
  if(!saved.taskId)throw Error('publication_start_unknown_do_not_retry');
  if(saved.taskId!==taskId){const current=getWorkflowTask(saved.taskId);return{ok:true,taskId:saved.taskId,status:current?.status||'unknown',reused:true,retryOf:taskId,requestId:params.requestId,sameRequestId:true}}
  if(await exists(path.join(process.cwd(),'.data','douyin-publications',identity.key+'.json')))throw Error('publication_retry_submission_exists');
  const backup=file+'.before-retry-'+taskId+'.json';
  if(await exists(backup))throw Error('publication_retry_state_unknown');
  await rename(file,backup);
  const result=await startDouyinWorkflow(structuredClone(params));
  return{...result,retryOf:taskId,requestId:params.requestId,sameRequestId:true};
 }finally{await release()}
}
