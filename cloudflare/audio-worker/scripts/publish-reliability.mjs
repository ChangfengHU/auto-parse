// Refresh only this service's existing marketplace metadata after live validation.
import {createInterface} from 'node:readline';
import {readFileSync,writeFileSync} from 'node:fs';
const rl=createInterface({input:process.stdin});
const input=await new Promise(resolve=>rl.once('line',line=>{rl.close();resolve(JSON.parse(line));}));
const p=input.publication;
if(p?.publisherOrigin!=='https://fleet.vyibc.com')throw Error('Unexpected publication target');
const headers={Authorization:`Bearer ${p.publisherToken}`,'Content-Type':'application/json'};
const url=p.publisherOrigin+'/api/hub/capabilities?kind=mcp&q=auto-parse-audio';
const r=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(15000)});const d=await r.json();
const old=d.capabilities?.find(c=>c.manifest?.capabilityId==='mcp:fleet/auto-parse-audio');
if(!r.ok||!old)throw Error('Existing capability authorization/preflight failed');
if(process.argv[2]==='check') {console.log(JSON.stringify({version:old.manifest.version,distribution:old.distribution}));process.exit(0);}
const tools=JSON.parse(readFileSync(new URL('../../../.data/audio-reliability-20261021/mcp-tools.json',import.meta.url),'utf8'))
  .map(({name,description,inputSchema,outputSchema})=>({name,description,inputSchema,...outputSchema?{outputSchema}:{}}));
if(tools.length!==11)throw Error('Unexpected tool list');
const manifest={schemaVersion:'capability-manifest/v1',capabilityId:'mcp:fleet/auto-parse-audio',catalogId:'auto-parse-audio',kind:'mcp',title:'音频工作室 · 背景音乐与音效',
  description:'私有声音库、Wikimedia检索与授权导入、CF音乐生成、费用确认、任务查询、人工验收和下载复用。Openverse搜索暂时停用。生成必须确认费用；未配置线路以audio_capabilities为准。',
  domain:'biz',version:'0.1.1',artifacts:[],dependencies:[],targets:[{consumer:'harness',engine:'sop-native',support:'declared'}],authProfileRefs:['vault:service:auto-parse-audio#authorization'],
  spec:{transport:'streamable-http',endpoint:'https://auto-parse-audio.2513120790.workers.dev/mcp',headers:{Authorization:'vault:service:auto-parse-audio#authorization'},tools}};
const response=await fetch(p.publisherOrigin+'/api/hub/capabilities/import',{method:'POST',headers,redirect:'error',body:JSON.stringify({manifest,publicationKey:'auto-parse-audio:0.1.1:20261021'}),signal:AbortSignal.timeout(25000)});
const result=await response.json();
const receipt={status:response.status,ok:result.ok,releaseId:result.manifest?.releaseId,distributionId:result.distributionId,error:result.error,details:result.details};
console.log(JSON.stringify(receipt));writeFileSync(new URL('../../../.data/audio-reliability-20261021/publication.json',import.meta.url),JSON.stringify(receipt,null,2));
if(!response.ok||!result.ok)throw Error('Publication not confirmed; do not change publicationKey');
const after=await fetch(url,{headers,signal:AbortSignal.timeout(15000)}).then(r=>r.json());
console.log(JSON.stringify({readback:after.capabilities?.filter(c=>c.manifest?.capabilityId==='mcp:fleet/auto-parse-audio').map(c=>({version:c.manifest.version,distribution:c.distribution}))}));
