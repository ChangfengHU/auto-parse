import type {Page,Locator} from 'playwright';
import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';

// The legacy workflow parameter remains "buffer". Bytes now spool to private
// origin disk storage instead of accumulating a whole-file Uint8Array list.
export async function transferFileToBrowserDisk(page:Page,input:Locator,file:string,chunkBytes:number,emit?:(type:'log',message:string)=>void):Promise<()=>Promise<void>>{
 const size=(await fs.promises.stat(file)).size;
 const job='upload-'+Date.now()+'-'+randomUUID();
 const stage=await page.evaluateHandle(async({size,job,name})=>{
  if(!navigator.storage?.getDirectory)throw Error('remote_upload_disk_unavailable');
  const estimate=await navigator.storage.estimate();
  if(estimate.quota&&estimate.quota-(estimate.usage||0)<size+64*1024*1024)throw Error('remote_upload_disk_quota');
  const root=await navigator.storage.getDirectory();
  const owner=await root.getDirectoryHandle('vyibc-workflow-upload-v1',{create:true});
  // Only this tool's expired temporary jobs; never touch platform data.
  const entries=owner as unknown as {entries:()=>AsyncIterableIterator<[string,FileSystemHandle]>};
  let swept=0;
  for await(const [key] of entries.entries()){
   const match=/^upload-(\d{13})-[a-f0-9-]{36}$/.exec(key);
   if(match&&Date.now()-Number(match[1])>24*60*60*1000&&swept++<64)await owner.removeEntry(key,{recursive:true}).catch(()=>undefined);
  }
  const directory=await owner.getDirectoryHandle(job,{create:true});
  try{const handle=await directory.getFileHandle(name,{create:true});const writer=await handle.createWritable();return {owner,handle,writer,job,closed:false};}
  catch(error){await owner.removeEntry(job,{recursive:true}).catch(()=>undefined);throw error;}
 },{size,job,name:path.basename(file)});
 let cleaned=false;
 const cleanup=async()=>{
  if(cleaned)return;cleaned=true;
  try{await page.evaluate(async stage=>{try{if(!stage.closed)await stage.writer.abort().catch(()=>undefined);}finally{await stage.owner.removeEntry(stage.job,{recursive:true});}},stage);}
  finally{await stage.dispose().catch(()=>undefined);}
 };
 try{
  const deadline=Date.now()+Math.min(1800000,180000+Math.ceil(size/1048576)*1000);
  let sent=0,lastProgress=Date.now();
  for await(const chunk of fs.createReadStream(file,{highWaterMark:chunkBytes})){
   if(Date.now()>deadline)throw Error('remote_upload_transfer_timeout');
   await page.evaluate(async({stage,data})=>{await stage.writer.write(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));},{stage,data:(chunk as Buffer).toString('base64')});
   sent+=chunk.length;if(Date.now()-lastProgress>5000){lastProgress=Date.now();emit?.('log','磁盘分块传输 '+Math.round(sent/size*100)+'%');}
  }
  await page.evaluate(async stage=>{await stage.writer.close();stage.closed=true;},stage);
  await input.evaluate(async(element,{stage,name,mimeType,size})=>{
   if(!(element instanceof HTMLInputElement)||element.type!=='file')throw Error('upload_input_invalid');
   const disk=await stage.handle.getFile();if(disk.size!==size)throw Error('remote_upload_disk_size_mismatch');
   const transfer=new DataTransfer();transfer.items.add(new File([disk],name,{type:mimeType}));
   element.files=transfer.files;
   element.dispatchEvent(new Event('input',{bubbles:true,composed:true}));element.dispatchEvent(new Event('change',{bubbles:true}));
  },{stage,name:path.basename(file),mimeType:path.extname(file).toLowerCase()==='.mp4'?'video/mp4':'application/octet-stream',size});
  return cleanup;
 }catch(error){await cleanup().catch(()=>undefined);throw error;}
}
