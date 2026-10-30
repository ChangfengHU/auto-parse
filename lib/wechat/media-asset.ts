import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {MEDIA_MAX_BYTES,mediaAssetUrl,type MediaDraftInput} from './media-draft';
const execute=promisify(execFile);
export async function downloadMediaAsset(input:MediaDraftInput){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'wechat-media-'));await fs.chmod(directory,0o700);
 const filename=path.join(directory,input.kind==='video'?'upload.mp4':'upload.mp3');
 try{
  let url=mediaAssetUrl(input.sourceUrl),response:Response|undefined;
  for(let i=0;i<4;i++){
   response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(120000)});
   if(response.status>=300&&response.status<400){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('media_redirect_invalid');url=mediaAssetUrl(new URL(location,url).href);continue}
   break;
  }
  if(!response?.ok||!response.body)throw Error('media_download_http_'+(response?.status||0));
  if(Number(response.headers.get('content-length')||0)>MEDIA_MAX_BYTES){await response.body.cancel();throw Error('media_file_too_large')}
  const fd=await fs.open(filename,'wx',0o600);let size=0;const reader=response.body.getReader();
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>MEDIA_MAX_BYTES)throw Error('media_file_too_large');await fd.writeFile(chunk.value)}}finally{await reader.cancel().catch(()=>{});await fd.close()}
  const {stdout}=await execute('ffprobe',['-v','error','-show_entries','format=duration,format_name:stream=codec_type,codec_name','-of','json',filename],{timeout:20000,maxBuffer:65536});
  const metadata=JSON.parse(stdout) as {format?:{duration?:string;format_name?:string};streams?:Array<{codec_type:string;codec_name:string}>};
  const duration=Number(metadata.format?.duration),streams=metadata.streams||[];
  if(!Number.isFinite(duration)||duration<=0||duration>3600)throw Error('media_duration_invalid');
  if(input.kind==='video'){
   if(!metadata.format?.format_name?.includes('mp4')||!streams.some(x=>x.codec_type==='video'&&x.codec_name==='h264')||streams.some(x=>(x.codec_type==='audio'&&x.codec_name!=='aac')||(x.codec_type==='video'&&x.codec_name!=='h264')))throw Error('media_requires_h264_mp4');
  }else if(metadata.format?.format_name!=='mp3'||streams.some(x=>x.codec_type!=='audio'||x.codec_name!=='mp3'))throw Error('media_requires_mp3');
  return {filename,size,duration,cleanup:()=>fs.rm(directory,{recursive:true,force:true})};
 }catch(error){await fs.rm(directory,{recursive:true,force:true});throw error}
}
