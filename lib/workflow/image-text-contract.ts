import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { booleanVariable } from './condition';
import { xhsCreationReceipt } from './xhs-publication-ledger';
import { publicationReceipt, parseCreationBody } from './douyin-publication-ledger';

export type ImagePlatform = 'xhs' | 'douyin';
export type ImageTextParams = {
  platform: ImagePlatform; expectedAccountId: string; imageUrls: string | string[];
  title: string; description: string; aiGenerated: boolean | string; requestId: string;
  mode?: 'prepare' | 'publish';
};
export type ImageReceipt = {
  published: true; platform: ImagePlatform; postId: string; postUrl: string;
  moderation: string; verificationSource: 'creation_response'; verifiedAt: string;
};
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 50 * 1024 * 1024;
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export function imageSources(value: unknown): string[] {
  let sources: unknown = value;
  if (typeof value === 'string') {
    try { sources = value.trim().startsWith('[') ? JSON.parse(value) : value.trim().split(/\r?\n/); }
    catch { throw new Error('image_urls_invalid'); }
  }
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 9 ||
      sources.some(v => typeof v !== 'string' || !v.trim())) throw new Error('image_count_or_urls_invalid');
  const urls = sources.map(v => {
    let u: URL; try { u = new URL(v); } catch { throw new Error('image_url_invalid'); }
    const asset = ['resource.vyibc.com','cdn.vyibc.com'].includes(u.hostname) &&
      /\.(png|jpe?g|webp)$/i.test(u.pathname) && !u.search;
    // Deliberately labelled, bounded test fixtures; the publish guard rejects them.
    const fixture = u.hostname === 'placehold.co' && u.pathname === '/720x960/png' &&
      /^\?text=WORKFLOW_TEST_0[1-9]$/.test(u.search);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash || (!asset && !fixture)) throw new Error('image_url_not_allowed');
    return u.href;
  });
  if (new Set(urls).size !== urls.length) throw new Error('duplicate_image_sources');
  return urls;
}
export function imageTextIdentity(p: ImageTextParams) {
  if (!['xhs','douyin'].includes(p.platform) ||
      !(p.platform === 'xhs' ? /^[a-f0-9]{24}$/ : /^\d{5,30}$/).test(p.expectedAccountId) ||
      !/^[A-Za-z0-9_-]{8,100}$/.test(p.requestId) ||
      typeof p.title !== 'string' || !p.title.trim() || [...p.title].length > 20 ||
      typeof p.description !== 'string' || p.description.length > 900 ||
      /\{\{\w+\}\}/.test(p.title + p.description) ||
      ![true,false,'true','false'].includes(p.aiGenerated)) throw new Error('image_text_input_invalid');
  const urls = imageSources(p.imageUrls), aiGenerated = booleanVariable(p.aiGenerated);
  return {
    urls, aiGenerated,
    key: digest(JSON.stringify([p.platform,p.expectedAccountId,[...urls].sort()])),
    fingerprint: digest(JSON.stringify([p.platform,p.expectedAccountId,urls,p.title,p.description,aiGenerated])),
  };
}
export function imageMime(bytes: Buffer) {
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return {mimeType:'image/png',extension:'png'};
  if (bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return {mimeType:'image/jpeg',extension:'jpg'};
  if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') return {mimeType:'image/webp',extension:'webp'};
  throw new Error('unsupported_image_bytes');
}
export async function downloadImage(url: string, fetcher: typeof fetch = fetch) {
  imageSources([url]);
  const response = await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('image_download_failed_or_too_large');
  const reader = response.body.getReader(), chunks: Buffer[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length; if (size > MAX_IMAGE_BYTES) throw new Error('image_too_large');
      chunks.push(Buffer.from(next.value));
    }
  } finally { await reader.cancel().catch(()=>{}); }
  const bytes = Buffer.concat(chunks);
  if (!bytes.length) throw new Error('empty_image');
  return {bytes,...imageMime(bytes),sha256:digest(bytes)};
}
export function imageCreationReceipt(platform: ImagePlatform, url: string, method: string, status: number, text: string): ImageReceipt | null {
  const body = parseCreationBody(text);
  const receipt = platform === 'xhs' ? xhsCreationReceipt(url,method,status,body) : publicationReceipt(url,method,status,body);
  if (!receipt) return null;
  const id = 'noteId' in receipt ? receipt.noteId : receipt.awemeId;
  return {published:true,platform,postId:id,postUrl:platform === 'xhs' ? 'https://www.xiaohongshu.com/explore/'+id : 'https://www.douyin.com/note/'+id,
    moderation:'pending_or_unknown',verificationSource:'creation_response',verifiedAt:new Date().toISOString()};
}
type ImageRecord = {fingerprint:string;requestId:string;state:'submitting'|'published';receipt?:ImageReceipt};
function recordPath(directory: string,key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('image_publication_key_invalid');
  return path.join(directory,key+'.json');
}
async function syncDirectory(directory:string) {const f=await open(directory,'r');try{await f.sync();}finally{await f.close();}}
export async function readImagePublication(directory:string,key:string,fingerprint:string): Promise<ImageRecord|null> {
  let record:ImageRecord;
  try{record=JSON.parse(await readFile(recordPath(directory,key),'utf8'));}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw new Error('image_publication_record_unreadable');}
  if(record.fingerprint!==fingerprint)throw new Error('image_sources_already_used_with_different_metadata');
  if(record.state!=='published'||!record.receipt?.published||!(record.receipt.platform==='xhs'?/^[a-f0-9]{24}$/:/^\d{10,30}$/).test(record.receipt.postId))
    throw new Error('image_submission_unknown_do_not_retry');
  return record;
}
export async function reserveImagePublication(directory:string,key:string,fingerprint:string,requestId:string) {
  await mkdir(directory,{recursive:true,mode:0o700});
  const f=await open(recordPath(directory,key),'wx',0o600).catch(()=>{throw new Error('image_publication_already_reserved');});
  try{await f.writeFile(JSON.stringify({fingerprint,requestId,state:'submitting'}));await f.sync();}finally{await f.close();}
  await syncDirectory(directory);
}
export async function finishImagePublication(directory:string,key:string,fingerprint:string,requestId:string,receipt:ImageReceipt) {
  const target=recordPath(directory,key),temporary=target+'.'+randomUUID()+'.tmp';
  const record:ImageRecord=JSON.parse(await readFile(target,'utf8'));
  if(record.state!=='submitting'||record.fingerprint!==fingerprint||record.requestId!==requestId)throw new Error('image_publication_reservation_mismatch');
  try{const f=await open(temporary,'wx',0o600);try{await f.writeFile(JSON.stringify({fingerprint,requestId,state:'published',receipt}));await f.sync();}finally{await f.close();}
    await rename(temporary,target);await syncDirectory(directory);
  }finally{await unlink(temporary).catch(()=>{});}
}

