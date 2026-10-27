import {createHash} from 'node:crypto';
import type {Page,Locator,Response} from 'playwright';
import {downloadImage} from './image-text-contract';
export type XImageProof = {mediaIds:string[];thumbHash:string;sha256:string};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function xUploadEndpoint(value:string) {
  try {const u=new URL(value);return ['https://upload.x.com','https://upload.twitter.com'].includes(u.origin)&&u.pathname==='/i/media/upload.json';}
  catch{return false;}
}
export function xFinalizeCommand(url:string,body:string|null) {
  try {
    const direct=new URL(url).searchParams.get('command');
    if(direct)return direct==='FINALIZE';
    return new URLSearchParams(body||'').get('command')==='FINALIZE'||/name="command"\r\n\r\nFINALIZE(?:\r\n|$)/.test(body||'');
  } catch{return false;}
}
export function xUploadedId(value:unknown):string|null {
  if(!value||typeof value!=='object')return null;
  const b=value as Record<string,unknown>;
  if(b.errors||b.error)return null;
  if(typeof b.media_id_string==='string'&&/^\d{6,30}$/.test(b.media_id_string))return b.media_id_string;
  return typeof b.media_key==='string'&&/^3_\d{6,30}$/.test(b.media_key)?b.media_key.slice(2):null;
}
async function thumb(scope:Locator) {
  const images=scope.locator('[data-testid="attachments"] img');
  if(await images.count()!==1)throw new Error('x_image_preview_count_mismatch');
  const source=await images.getAttribute('src');
  if(!source||!await images.evaluate((i)=>i instanceof HTMLImageElement&&i.complete&&i.naturalWidth>0))throw new Error('x_image_preview_not_ready');
  return hash(source);
}
export async function verifyXImage(scope:Locator,proof:XImageProof) {
  if(!proof||proof.mediaIds?.length!==1||!/^\d{6,30}$/.test(proof.mediaIds[0])||await thumb(scope)!==proof.thumbHash)throw new Error('x_image_proof_or_preview_changed');
}
export async function prepareXImage(page:Page,scope:Locator,url:string):Promise<XImageProof> {
  if(await scope.locator('[data-testid="attachments"]').count())throw new Error('x_existing_attachment_requires_review');
  const image=await downloadImage(url);
  if(image.bytes.length>5*1024*1024)throw new Error('x_image_local_size_limit');
  const ids=new Set<string>(),pending:Promise<void>[]=[];
  const listener=(r:Response)=>{
    if(xUploadEndpoint(r.url())&&r.status()>=200&&r.status()<300&&xFinalizeCommand(r.url(),r.request().postData()))pending.push(r.json().then(b=>{const id=xUploadedId(b);if(id)ids.add(id);}).catch(()=>{}));
  };
  page.on('response',listener);
  try {
    const input=scope.locator('input[data-testid="fileInput"]');
    if(await input.count()!==1)throw new Error('x_image_input_ambiguous');
    await input.setInputFiles({name:'image-'+image.sha256.slice(0,12)+'.'+image.extension,mimeType:image.mimeType,buffer:image.bytes},{timeout:30000});
    for(let n=0;n<60;n++){
      await Promise.all([...pending]);
      if(ids.size===1){
        try{return {mediaIds:[...ids],thumbHash:await thumb(scope),sha256:image.sha256};}catch{}
      }
      await page.waitForTimeout(500);
    }
    throw new Error('x_native_image_upload_unconfirmed');
  } finally {page.off('response',listener);}
}
