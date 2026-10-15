import {createInterface} from 'node:readline';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const rl=createInterface({input:process.stdin});
const input=await new Promise(resolve=>rl.once('line',line=>{rl.close();resolve(JSON.parse(line));}));
const base='https://auto-parse-audio.2513120790.workers.dev';
const dir='../../.data/audio-studio-verification';mkdirSync(dir,{recursive:true});
const intentPath=`${dir}/intents.json`;
const intents=existsSync(intentPath)?JSON.parse(readFileSync(intentPath,'utf8')):{music:randomUUID(),import:randomUUID()};
writeFileSync(intentPath,JSON.stringify(intents,null,2));
const evidence=[];
function check(name,ok,detail={}){evidence.push({name,ok,...detail});writeFileSync(`${dir}/live-results.json`,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence.at(-1)));if(!ok)throw new Error(`Check failed: ${name}`);}
async function api(op,body={},extra={}){
  const r=await fetch(`${base}/v1/${op}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${input.accessToken}`,...extra},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  const data=await r.json();return {r,data};
}
const unauth=await fetch(`${base}/v1/capabilities`,{method:'POST',body:'{}'});check('unauthorized denied',unauth.status===401,{status:unauth.status});
const evil=await api('capabilities',{}, {Origin:'https://evil.example'});check('cross-origin denied',evil.r.status===403,{status:evil.r.status});
const capabilities=await api('capabilities');check('capabilities real configuration',capabilities.r.ok,{ready:capabilities.data.providers?.filter(p=>p.ready).map(p=>p.id)});
let rid=0;
async function rpc(method,params){const r=await fetch(`${base}/mcp`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:`Bearer ${input.accessToken}`},body:JSON.stringify({jsonrpc:'2.0',id:++rid,method,params}),signal:AbortSignal.timeout(30000)});return {r,data:await r.json()};}
const init=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'audio-studio-verifier',version:'1'}});check('MCP initialize',init.r.ok&&!!init.data.result?.serverInfo);
const listing=await rpc('tools/list',{});check('MCP 11 tools',listing.r.ok&&listing.data.result?.tools?.length===11,{names:listing.data.result?.tools?.map(t=>t.name)});
writeFileSync(`${dir}/mcp-tools.json`,JSON.stringify(listing.data.result.tools,null,2));
const capRpc=await rpc('tools/call',{name:'audio_capabilities',arguments:{}});check('MCP shared backend',capRpc.r.ok&&!capRpc.data.result?.isError);
const bad=await api('generate',{model:'elevenlabs/music-v2',title:'Bad request',prompt:'A short instrumental piano loop',seconds:10,requestId:randomUUID(),maxCostUsd:1});check('unconfirmed paid request blocked',bad.r.status===400);
const noSfx=await api('quote',{model:'elevenlabs/sound-effects',title:'Door',prompt:'A wooden door opening slowly',seconds:3});check('missing SFX credentials explicit',noSfx.r.status===503);
const request={requestId:intents.music,model:'elevenlabs/music-v2',title:'CF 实测 · 温馨日常 10 秒',prompt:'Warm lighthearted instrumental background music for a daily-life comedy, soft piano, gentle pizzicato strings, no vocals, clean ending.',seconds:10,tags:['测试样本','温馨','日常'],loop:false,confirmPaid:true,maxCostUsd:0.025};
const [first,second]=await Promise.all([api('generate',request),api('generate',request)]);
check('paid generation accepted once',first.r.ok&&second.r.ok&&first.data.job?.id===second.data.job?.id,{jobId:intents.music,estimatedUsd:0.025});
const conflict=await api('generate',{...request,title:'conflicting'});check('request identity conflict',conflict.r.status===409);
console.log(JSON.stringify({pendingJob:intents.music,next:'Poll jobs; do not submit a new request ID'}));
if(input.importId){const imported=await api('import',{requestId:intents.import,provider:'openverse',sourceId:input.importId,kind:'sound_effect',tags:['测试样本','脚步'],rightsAcknowledged:true});check('licensed source import accepted',imported.r.ok,{jobId:intents.import});}
for(let attempt=0;attempt<60;attempt++){
  const result=await api('jobs');
  const targets=result.data.jobs.filter(j=>[intents.music,input.importId?intents.import:null].includes(j.id));
  console.log(JSON.stringify({jobs:targets.map(j=>({id:j.id,status:j.status,error:j.error}))}));
  if(targets.every(j=>['completed','needs_review','failed'].includes(j.status))){
    for(const job of targets){
      check(`${job.operation} completed`,job.status==='completed',{jobId:job.id,status:job.status});
      const media=await fetch(`${base}/v1/media/${job.asset_id}`,{headers:{Authorization:`Bearer ${input.accessToken}`}});
      const bytes=Buffer.from(await media.arrayBuffer());const hash=createHash('sha256').update(bytes).digest('hex');
      const asset=await api('get_asset',{id:job.asset_id});
      check('R2 original integrity',media.ok&&hash===asset.data.sha256,{id:job.asset_id,sha256:hash,bytes:bytes.length,durationMs:asset.data.duration_ms});
      const file=`${dir}/${job.asset_id}.mp3`;writeFileSync(file,bytes);
      const probe=spawnSync('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_name,sample_rate,channels','-of','json',file],{encoding:'utf8'});
      check('ffprobe audio playable',probe.status===0,{id:job.asset_id,probe:JSON.parse(probe.stdout)});
      const decode=spawnSync('ffmpeg',['-v','error','-i',file,'-f','null','-'],{encoding:'utf8'});check('full audio decode',decode.status===0,{id:job.asset_id});
      const privateFile=await fetch(`${base}/v1/media/${job.asset_id}`);check('private file access denied',privateFile.status===401);
      const partial=await fetch(`${base}/v1/media/${job.asset_id}`,{headers:{Authorization:`Bearer ${input.accessToken}`,Range:'bytes=0-1023'}});check('authenticated Range playback',partial.status===206&&(await partial.arrayBuffer()).byteLength===1024);
      const blockedDownload=await fetch(`${base}/v1/media/${job.asset_id}?download=1`,{headers:{Authorization:`Bearer ${input.accessToken}`}});check('candidate download gated',blockedDownload.status===409);
    }
    break;
  }
  if(attempt===59)throw new Error('Jobs still pending; inspect stored IDs, do not regenerate');
  await new Promise(r=>setTimeout(r,5000));
}
