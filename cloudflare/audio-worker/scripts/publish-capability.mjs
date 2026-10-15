// Read-only preflight by default. Pass "publish" only after live verification.
import {createInterface} from 'node:readline';
import {readFileSync,writeFileSync} from 'node:fs';
const rl=createInterface({input:process.stdin});
const input=await new Promise(resolve=>rl.once('line',line=>{rl.close();resolve(JSON.parse(line));}));
const base=input.publication.publisherOrigin;
if(base!=='https://fleet.vyibc.com')throw new Error('Unexpected marketplace target');
const headers={Authorization:`Bearer ${input.publication.publisherToken}`,'Content-Type':'application/json'};
const preflight=await fetch(`${base}/api/hub/capabilities?kind=mcp&q=auto-parse-audio`,{headers,redirect:'error'});
const inventory=await preflight.json();
console.log(JSON.stringify({preflightStatus:preflight.status,ok:inventory.ok,total:inventory.total,error:inventory.error,capabilities:inventory.capabilities?.map(x=>({id:x.manifest?.capabilityId,distribution:x.distribution}))}));
writeFileSync('../../.data/audio-studio-verification/publication-readback.json',JSON.stringify(inventory,null,2));
if(!preflight.ok||!inventory.ok)throw new Error('Marketplace authorization/read-only preflight failed');
if(process.argv[2]!=='publish')process.exit(0);
const tools=JSON.parse(readFileSync('../../.data/audio-studio-verification/mcp-tools.json','utf8')).map(({name,description,inputSchema,outputSchema})=>({name,description,inputSchema,...outputSchema?{outputSchema}:{}}));
const manifest={schemaVersion:'capability-manifest/v1',capabilityId:'mcp:fleet/auto-parse-audio',catalogId:'auto-parse-audio',kind:'mcp',title:'音频工作室 · 背景音乐与音效',
  description:'私有声音库优先：检索开放授权素材、保存原文件字节及标签、CF ElevenLabs 音乐按需生成、费用确认、持久化任务、人工验收与下载复用。MiniMax 与独立音效生成的可用状态以 audio_capabilities 为准。不公开音频库，不自动付费，不提供第三方素材分发授权。',
  domain:'biz',version:'0.1.0',artifacts:[],dependencies:[],targets:[{consumer:'harness',engine:'sop-native',support:'declared'}],
  authProfileRefs:['vault:service:auto-parse-audio#authorization'],
  spec:{transport:'streamable-http',endpoint:'https://auto-parse-audio.2513120790.workers.dev/mcp',headers:{Authorization:'vault:service:auto-parse-audio#authorization'},tools}};
const publicationKey='auto-parse-audio:0.1.0:20261015';
writeFileSync('../../.data/audio-studio-verification/capability-manifest.json',JSON.stringify(manifest,null,2));
const response=await fetch(`${base}/api/hub/capabilities/import`,{method:'POST',headers,body:JSON.stringify({manifest,publicationKey}),redirect:'error',signal:AbortSignal.timeout(30000)});
const result=await response.json();
console.log(JSON.stringify({publishStatus:response.status,ok:result.ok,error:result.error,releaseId:result.manifest?.releaseId,distributionId:result.distributionId,idempotent:result.idempotent}));
writeFileSync('../../.data/audio-studio-verification/publication-receipt.json',JSON.stringify(result,null,2));
if(!response.ok||!result.ok)throw new Error('Publication not confirmed; keep same publicationKey');
const readback=await fetch(`${base}/api/hub/capabilities?kind=mcp&q=auto-parse-audio`,{headers});
const state=await readback.json();
console.log(JSON.stringify({readback:state.capabilities?.map(x=>({id:x.manifest?.capabilityId,releaseId:x.release?.releaseId,distribution:x.distribution}))}));
