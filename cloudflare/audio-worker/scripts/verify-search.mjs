import {createInterface} from 'node:readline';
import {writeFileSync} from 'node:fs';
const rl=createInterface({input:process.stdin});
const {accessToken}=await new Promise(resolve=>rl.once('line',line=>{rl.close();resolve(JSON.parse(line));}));
const results=await Promise.all([
  {provider:'openverse',q:'footsteps',kind:'sound_effect'},
  {provider:'openverse',q:'cinematic',kind:'music'},
  {provider:'wikimedia',q:'rain',kind:'sound_effect'},
].map(async body=>{
  const started=Date.now();
  try{
    const r=await fetch('https://auto-parse-audio.2513120790.workers.dev/v1/search',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${accessToken}`},body:JSON.stringify({...body,page:1}),signal:AbortSignal.timeout(45000)});
    const data=await r.json();const result={...body,status:r.status,ok:r.ok&&data.items?.length>0,count:data.items?.length,error:data.error,ms:Date.now()-started,licenses:[...new Set(data.items?.map(x=>x.license)||[])]};console.log(JSON.stringify(result));return result;
  }catch{const result={...body,ok:false,error:'network_timeout',ms:Date.now()-started};console.log(JSON.stringify(result));return result;}
}));
writeFileSync('../../.data/audio-studio-verification/search-results.json',JSON.stringify(results,null,2));
if(results.some(x=>!x.ok))process.exitCode=1;
