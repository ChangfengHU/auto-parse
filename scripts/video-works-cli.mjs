import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {stripTypeScriptTypes} from 'node:module';
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../lib/video-works/store.ts',import.meta.url),'utf8'),{mode:'transform'});
const store=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
if(process.getuid?.()===0)throw Error('run_video_works_cli_as_service_user');
const action=process.argv[2]||'summary';
if(action==='backfill'){
 let imported=0,errors=0;const rejected=[];
 const directory=path.join(process.cwd(),'.data/workflow-tasks');
 for(const name of fs.existsSync(directory)?fs.readdirSync(directory):[]){
  if(!name.endsWith('.json'))continue;
  try{const task=JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));if(store.syncVideoWorkflowTask(task))imported++}catch(e){errors++;rejected.push({file:name,error:e.message})}
 }
 const wechat=path.join(process.cwd(),'.runtime/wechat-media-drafts');
 for(const name of fs.existsSync(wechat)?fs.readdirSync(wechat):[]){
  if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
  try{if(store.syncWechatVideoDraft(JSON.parse(fs.readFileSync(path.join(wechat,name),'utf8'))))imported++}catch(e){errors++;rejected.push({file:name,error:e.message})}
 }
 console.log(JSON.stringify({action,imported,errors,rejected}));
}
if(action==='retain'){
 const requested=process.argv[3];if(!requested)throw Error('work_id_required');
 const work=store.getVideoWork(requested);if(!work)throw Error('work_not_found');
 if(work.archive)console.log(JSON.stringify({status:'already_retained',workId:work.id,bytes:work.archive.bytes}));
 else{
  const url=store.videoSourceUrl(work.sourceUrl),dir=fs.mkdtempSync(path.join(os.tmpdir(),'video-work-archive-')),file=path.join(dir,'original.mp4');
  try{
   const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(300000)});
   if(!response.ok||!response.body)throw Error('archive_source_http_'+response.status);
   if(Number(response.headers.get('content-length'))>536870912)throw Error('archive_source_too_large');
   const space=fs.statfsSync(dir);if(space.bavail*space.bsize<Number(response.headers.get('content-length')||536870912)+268435456)throw Error('archive_disk_space_insufficient');
   const handle=fs.openSync(file,'wx',0o600);let bytes=0;
   try{for await(const chunk of response.body){bytes+=chunk.byteLength;if(bytes>536870912)throw Error('archive_source_too_large');fs.writeSync(handle,chunk)}fs.fsyncSync(handle)}finally{fs.closeSync(handle)}
   const archive=await store.retainVideoOriginal(url,file);console.log(JSON.stringify({status:'retained',workId:work.id,...archive}));
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
 }
}
if(action==='summary'||action==='backfill'){
 const deliveries=store.allVideoDeliveries();let offset=0;const works=[];
 for(;;){const p=store.listVideoWorks({limit:100,offset});works.push(...p.items);if(p.nextOffset===null)break;offset=p.nextOffset}
 console.log(JSON.stringify({works:works.length,deliveries:deliveries.length,states:deliveries.reduce((a,d)=>(a[d.state]=(a[d.state]||0)+1,a),{}),originals:works.filter(w=>w.archive).length,items:works.map(w=>({id:w.id,title:w.title,deliveries:w.deliveries.length,archived:!!w.archive}))}));
}

if(action==='posters'){for(const d of store.allVideoDeliveries()){if(d.archive)await store.ensureVideoPoster(d.archive.sha256)}console.log(JSON.stringify({status:'posters_ready'}))}
