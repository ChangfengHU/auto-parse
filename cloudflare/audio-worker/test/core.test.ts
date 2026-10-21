import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {execute} from '../src/core';
import {allowedAudioUrl,generation,quote,type AudioEnv} from '../src/schema';
import {readBounded,searchSources} from '../src/sources';

function fixture(){
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001_audio.sql',import.meta.url),'utf8'));
  class Statement {
    values:unknown[]=[];constructor(public sql:string){}
    bind(...values:unknown[]){this.values=values;return this;}
    async first(){return db.prepare(this.sql).get(...this.values as never[])||null;}
    async all(){return {results:db.prepare(this.sql).all(...this.values as never[])};}
    async run(){const r=db.prepare(this.sql).run(...this.values as never[]);return {meta:{changes:Number(r.changes)}};}
  }
  const created=new Set<string>();
  const env={DB:{prepare:(sql:string)=>new Statement(sql),batch:async(stmts:Statement[])=>{db.exec('BEGIN');try{const result=[];for(const s of stmts)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}},
    JOBS:{create:async({id}:{id:string})=>{if(created.has(id))throw new Error('exists');created.add(id);return {id};},get:async(id:string)=>({status:async()=>{if(!created.has(id))throw new Error('missing');return {status:'queued'};}})},
    DAILY_BUDGET_USD:'1',MINIMAX_ENABLED:'false',SFX_COST_USD:'',AUDIO_ACCESS_TOKEN:'test-only',ALLOWED_ORIGIN:'https://example.com'} as unknown as AudioEnv;
  return {db,env,created};
}
test('all eleven shared operations: success paths in isolated DB with no provider charges',async()=>{
  const {env,db}=fixture();const id=crypto.randomUUID(), now=new Date().toISOString();
  const imported=await execute(env,'import',{requestId:id,provider:'wikimedia',sourceId:'File:Test.ogg',kind:'music',rightsAcknowledged:true}) as {job:{id:string}};
  assert.equal(imported.job.id,id);
  db.prepare(`INSERT INTO assets(id,job_id,kind,title,source,source_url,creator,license,license_url,attribution,object_key,sha256,mime,bytes,duration_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,id,'music','Fixture','test','https://example.com','test','CC0','','test','private/key','abcd','audio/mpeg',12,1000,now);
  const caps=await execute(env,'capabilities',{}) as {providers:{id:string;ready:boolean}[]};
  assert.equal(caps.providers.find(p=>p.id==='openverse')?.ready,false);
  const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({batchcomplete:true});
  try {assert.deepEqual((await execute(env,'search',{q:'test',kind:'music'}) as {items:unknown[]}).items,[])}finally{globalThis.fetch=old}
  assert.equal((await execute(env,'library',{}) as {total:number}).total,1);
  assert.equal((await execute(env,'get_asset',{id}) as {id:string}).id,id);
  assert.equal((await execute(env,'quote',input) as {estimatedUsd:number}).estimatedUsd,0.025);
  await execute(env,'generate',{...input,requestId:crypto.randomUUID(),confirmPaid:true,maxCostUsd:0.025});
  assert.equal((await execute(env,'jobs',{}) as {jobs:unknown[]}).jobs.length,2);
  const updated=await execute(env,'update_asset',{id,title:'Changed',tags:['rain','rain'],scene:'test'}) as {title:string;tags:string[]};
  assert.equal(updated.title,'Changed');assert.deepEqual(updated.tags,['rain']);
  await execute(env,'review_asset',{id,decision:'approved',qualityConfirmed:true,rightsConfirmed:true});
  const used=await execute(env,'use_asset',{id,requestId:crypto.randomUUID(),purpose:'isolated fixture test'}) as {asset:{uses:number}};
  assert.equal(used.asset.uses,1);
});
const input={model:'elevenlabs/music-v2',title:'Test piano',prompt:'Warm piano instrumental for a short scene',seconds:10,tags:['warm'],loop:false};
test('published quote, missing SFX key, disabled MiniMax, music loop unsupported',()=>{
  const {env}=fixture();assert.equal(quote(generation.parse(input),env).estimatedUsd,0.025);
  assert.throws(()=>quote(generation.parse({...input,model:'elevenlabs/sound-effects'}),env));
  assert.throws(()=>quote(generation.parse({...input,model:'minimax/music-2.6'}),env));
  assert.throws(()=>quote(generation.parse({...input,loop:true}),env));
});
test('invalid duration and missing confirmation rejected before creating a job',async()=>{
  const {env,created}=fixture();
  await assert.rejects(execute(env,'generate',{...input,requestId:crypto.randomUUID(),seconds:0,confirmPaid:true,maxCostUsd:1}));
  await assert.rejects(execute(env,'generate',{...input,requestId:crypto.randomUUID(),maxCostUsd:1}));
  await assert.rejects(execute(env,'generate',{...input,requestId:crypto.randomUUID(),confirmPaid:true,maxCostUsd:0.001}));
  assert.equal(created.size,0);
});
test('concurrent same request is idempotent and different parameters conflict',async()=>{
  const {env,created,db}=fixture();const body={...input,requestId:crypto.randomUUID(),confirmPaid:true,maxCostUsd:0.025};
  const results=await Promise.all(Array.from({length:8},()=>execute(env,'generate',body)));
  assert.equal(results.length,8);assert.equal(created.size,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM jobs').get()?.n,1);
  await assert.rejects(execute(env,'generate',{...body,title:'Changed'}),/不同参数/);
});
test('atomic budget under concurrent distinct requests never over-reserves',async()=>{
  const {env,db}=fixture();env.DAILY_BUDGET_USD='0.05';
  const results=await Promise.allSettled(Array.from({length:8},()=>execute(env,'generate',{...input,requestId:crypto.randomUUID(),confirmPaid:true,maxCostUsd:0.025})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
  assert.equal(db.prepare('SELECT SUM(reserved_micros) cost FROM jobs').get()?.cost,50000);
});
test('unknown provider result does not release budget or reschedule',async()=>{
  const {env,db,created}=fixture();const body={...input,requestId:crypto.randomUUID(),confirmPaid:true,maxCostUsd:0.025};
  await execute(env,'generate',body);db.prepare("UPDATE jobs SET status='needs_review',receipt=?").run('{"url":"private-signed-url"}');
  const result=await execute(env,'generate',body) as {job:Record<string,unknown>};
  assert.equal(created.size,1);assert.equal(result.job.status,'needs_review');assert.equal(result.job.reserved_micros,25000);assert.equal('receipt' in result.job,false);
});
test('unsafe media destinations and redirected private addresses rejected',()=>{
  for(const url of ['http://upload.wikimedia.org/a','https://127.0.0.1/a','https://localhost/a','https://169.254.169.254/','https://upload.wikimedia.org.evil.test/a','https://user:pw@upload.wikimedia.org/a','https://upload.wikimedia.org:444/a'])assert.throws(()=>allowedAudioUrl(url));
  assert.equal(allowedAudioUrl('https://cdn.freesound.org/previews/1/a.mp3').hostname,'cdn.freesound.org');
  assert.equal(allowedAudioUrl('https://ai-gateway-outputs.0d37909e38d3e99c29fa2cd343ac421a.r2.cloudflarestorage.com/a').protocol,'https:');
});
test('download byte limit enforced even without Content-Length',async()=>{
  await assert.rejects(readBounded(new Response(new Uint8Array(10)),5),/超过/);
  assert.equal((await readBounded(new Response(new Uint8Array(5)),5)).length,5);
});
test('approval requires rights and quality, candidates cannot be reused',async()=>{
  const {env,db}=fixture();const id=crypto.randomUUID();const now=new Date().toISOString();
  db.prepare('INSERT INTO jobs(id,request_hash,operation,payload,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,'hash','import','{}',now,now);
  db.prepare(`INSERT INTO assets(id,job_id,kind,title,source,source_url,creator,license,license_url,attribution,object_key,sha256,mime,bytes,duration_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,id,'music','Test','test','https://example.com','Test','CC0','','test','private/key','abcd','audio/mpeg',12,1000,now);
  await assert.rejects(execute(env,'review_asset',{id,decision:'approved',qualityConfirmed:true,rightsConfirmed:false}));
  await assert.rejects(execute(env,'use_asset',{id,requestId:crypto.randomUUID(),purpose:'video'}));
  await execute(env,'review_asset',{id,decision:'approved',qualityConfirmed:true,rightsConfirmed:true});
  const body={id,requestId:crypto.randomUUID(),purpose:'video'};
  await execute(env,'use_asset',body);await execute(env,'use_asset',body);
  assert.equal(db.prepare('SELECT uses FROM assets WHERE id=?').get(id)?.uses,1);
  await assert.rejects(execute(env,'use_asset',{...body,purpose:'different'}));
  const asset=await execute(env,'get_asset',{id}) as Record<string,unknown>;
  assert.equal('object_key' in asset,false);
});
test('source timeout is explicit 504, not a paid generation error',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>{throw new DOMException('timeout','TimeoutError');};
  try{await assert.rejects(searchSources({provider:'wikimedia',q:'test',kind:'music',page:1}),(error:unknown)=>!!error&&typeof error==='object'&&'status' in error&&error.status===504&&String(error).includes('未扣费'));}
  finally{globalThis.fetch=original;}
});
