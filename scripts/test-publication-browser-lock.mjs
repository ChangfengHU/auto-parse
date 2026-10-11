import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stripTypeScriptTypes } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
const exec = promisify(execFile);
const source = await readFile(new URL('../lib/workflow/browser-activity.ts', import.meta.url), 'utf8');
const moduleSource = stripTypeScriptTypes(source, { mode: 'transform' });
const { acquireManagedBrowserActivity } = await import('data:text/javascript;base64,' + Buffer.from(moduleSource).toString('base64'));
const endpoint = 'http://127.0.0.1:9223';
const clean = text => stripTypeScriptTypes(text, { mode: 'transform' }).replace(/^import .*;\s*$/gm, '').replace(/^export /gm, '');
const cli = await readFile(new URL('../lib/workflow/workflow-task-cli.ts', import.meta.url), 'utf8');
const startSource = clean(cli.slice(cli.indexOf('async function startWorkflowAsync('), cli.indexOf('\nfunction buildTaskProgress(')));
const runtime = clean(await readFile(new URL('../lib/workflow/douyin-runtime.ts', import.meta.url), 'utf8'));

test('real flock: contention, idempotent release and reusable stable inode', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'publish-lock-'));
  await writeFile(path.join(dir, 'activity-9223.lock'), '');
  try {
    const release = await acquireManagedBrowserActivity(endpoint, dir);
    try { await assert.rejects(acquireManagedBrowserActivity(endpoint, dir), /managed_browser_busy/); }
    finally { await release(); await release(); }
    await (await acquireManagedBrowserActivity(endpoint, dir))();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('missing lock or nonlocal/credential-bearing endpoint fails closed', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'publish-lock-'));
  try {
    await assert.rejects(acquireManagedBrowserActivity(endpoint, dir));
    for (const bad of ['https://127.0.0.1:9223','http://example.com:9223','http://user:secret@127.0.0.1:9223','http://127.0.0.1:9223?token=x']) {
      await assert.rejects(acquireManagedBrowserActivity(bad, dir), /endpoint_invalid/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('kernel releases an activity lock when its holder exits unexpectedly', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'publish-lock-'));
  const lock = path.join(dir, 'activity-9223.lock');
  await writeFile(lock, '');
  const holder = spawn('flock', ['-n', '--no-fork', lock, 'cat'], { stdio: ['pipe','ignore','ignore'] });
  try {
    // Wait for the child to own the lock; do not assume spawn means acquired.
    let busy = false;
    for (let i=0; i<50 && !busy; i++) {
      try { await exec('flock', ['-n', lock, 'true']); }
      catch { busy = true; }
      if (!busy) await new Promise(r => setTimeout(r, 10));
    }
    assert.equal(busy, true);
    const exited = new Promise(r => holder.once('exit', r));
    holder.kill('SIGKILL'); await exited;
    await (await acquireManagedBrowserActivity(endpoint, dir))();
  } finally { holder.stdin.destroy(); holder.kill(); await rm(dir, { recursive: true, force: true }); }
});

for (const mode of ['success','step-failure','bootstrap-failure','lock-busy','stop']) {
  test('actual workflow runner owns lock before browser and releases after cleanup: ' + mode, async () => {
    const events = [];
    const task = { workflowId: 'fixture', status: 'running', initialVars: {}, workflow: { nodes: [
      { type: 'navigate', params: { adsManualCdpUrl: endpoint, useAdsPower: true } },
      { type: 'click', params: { douyinPublication: { prepareOnly: true } } }
    ] } };
    const page = { on: () => {}, isClosed: () => false };
    const sandbox = { URL, Error, process: { env: {} }, console: { error: () => {} },
      acquireManagedBrowserActivity: async () => { events.push('lock'); if (mode==='lock-busy') throw Error('managed_browser_busy'); return async () => events.push('unlock'); },
      shouldDeferNativePageBootstrap: () => false,
      getPersistentContext: async () => { events.push('bootstrap'); if(mode==='bootstrap-failure')throw Error('bootstrap_failed'); return { newPage: async () => page }; },
      registerTaskRuntime: () => {}, wfTaskDiag: () => {}, getTask: () => task,
      closeTaskRuntimeNow: async () => events.push('cleanup'), clearTaskRuntime: () => {},
      runWorkflow: async () => { events.push('run'); if(mode==='step-failure')throw Error('upload_failed'); if(mode==='stop')task.status='stopped'; return { success: true, outputs: {} }; },
      setTaskFinalVars: () => {}, mergeOutputsToFinalVars: () => ({}), updateTaskStatus: () => {},
    };
    vm.createContext(sandbox); vm.runInContext(runtime+'\n'+startSource,sandbox);
    await sandbox.startWorkflowAsync('test',task);
    if(mode==='lock-busy')assert.deepEqual(events,['lock','cleanup']);
    else if(mode==='bootstrap-failure')assert.deepEqual(events,['lock','bootstrap','cleanup','unlock']);
    else assert.deepEqual(events,['lock','bootstrap','run','cleanup','unlock']);
    sandbox.acquireRemoteDouyinBrowser(endpoint)();
  });
}

test('installed memory maintenance cannot execute systemctl while external lock is held', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'publish-maintenance-'));
  await writeFile(path.join(dir,'activity-9223.lock'),'');
  const installed = await readFile('/usr/local/lib/chatgpt-image-service/server/chatgpt-image-http.mjs','utf8');
  const fn = installed.slice(installed.indexOf('async function restartBrowser('),installed.indexOf('\nasync function softRecycleWorker('));
  let restarts = 0;
  const worker = { port: '9223', active: false };
  const sandbox = { videoService:{held:()=>false}, browserReservations:new Set(), loginProbeHeld:()=>false,
    instanceOfPort:()=>2, workers:[worker], config:{browserUnit:'linux-browser-vnc-browser@%d.service'},
    acquireBrowserActivity: async () => { try {return await acquireManagedBrowserActivity(endpoint,dir);}catch{return null;} },
    spawn:(_cmd,args)=>{ assert.deepEqual(Array.from(args),['restart','linux-browser-vnc-browser@2.service']); restarts++; return {on:(event,fn)=>{if(event==='exit')fn(0);}}; },
    setTimeout:fn=>fn(), Date, console:{log:()=>{}} };
  vm.createContext(sandbox); vm.runInContext(fn,sandbox);
  try {
    const release=await acquireManagedBrowserActivity(endpoint,dir);
    try {await sandbox.restartBrowser(worker,'test');assert.equal(restarts,0);assert.match(worker.recycleError,/external browser task/);}
    finally {await release();}
    await sandbox.restartBrowser(worker,'test');assert.equal(restarts,1);
    await (await acquireManagedBrowserActivity(endpoint,dir))();
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('soft recycle cannot close publication tabs; connection failure releases lock', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'publish-soft-'));
  await writeFile(path.join(dir,'activity-9223.lock'),'');
  const installed = await readFile('/usr/local/lib/chatgpt-image-service/server/chatgpt-image-http.mjs','utf8');
  const fn = installed.slice(installed.indexOf('async function softRecycleWorker('),installed.indexOf('\nfunction toMb('));
  let connects = 0;
  const worker = {port:'9223'};
  const sandbox = {acquireBrowserActivity:async()=>{try{return await acquireManagedBrowserActivity(endpoint,dir);}catch{return null;}},
    chromium:{connectOverCDP:async()=>{connects++;throw Error('connection_failed');}},process:{stderr:{write:()=>{}}}};
  vm.createContext(sandbox);vm.runInContext(fn,sandbox);
  try {
    const release=await acquireManagedBrowserActivity(endpoint,dir);
    try {await sandbox.softRecycleWorker(worker,'fixture');assert.equal(connects,0);}
    finally {await release();}
    await sandbox.softRecycleWorker(worker,'fixture');assert.equal(connects,1);
    await (await acquireManagedBrowserActivity(endpoint,dir))();
  }finally{await rm(dir,{recursive:true,force:true});}
});

for(const mode of ['held','idle','missing'])test('installed CDP guard uses same lock: '+mode,async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'publish-cdpguard-'));
  const lock=path.join(dir,'activity-9223.lock');
  const log=path.join(dir,'actions');
  if(mode!=='missing')await writeFile(lock,'');
  const envfile=path.join(dir,'desktop.env');
  await writeFile(envfile,'BROWSER_DEBUG_PORT=9222\nVNC_INSTANCES=2\nVNC_ACTIVE_INSTANCES=2\n');
  for(const [name,body]of Object.entries({curl:'exit 1',sleep:'exit 0',logger:'exit 0',systemctl:'case "$1" in is-enabled) echo enabled;; show) echo loaded;; restart) echo restart >> "$GUARD_TEST_LOG";; esac'})) {
    await writeFile(path.join(dir,name),'#!/bin/sh\n'+body+'\n',{mode:0o755});
  }
  const script=(await readFile('/usr/local/lib/linux-browser-vnc/scripts/browser_cdpguard.sh','utf8'))
    .replace('ENV_FILE=/etc/linux-browser-vnc/desktop.env','ENV_FILE='+JSON.stringify(envfile))
    .replace('lock="/run/linux-browser-vnc/activity-${port}.lock"','lock='+JSON.stringify(lock));
  let release;
  try {
    if(mode==='held')release=await acquireManagedBrowserActivity(endpoint,dir);
    await exec('bash',['-c',script],{env:{...process.env,PATH:dir+':'+process.env.PATH,GUARD_TEST_LOG:log}});
    const actions=await readFile(log,'utf8').catch(()=> '');
    assert.equal(actions,mode==='idle'?'restart\n':'');
  }finally{if(release)await release();await rm(dir,{recursive:true,force:true});}
});
