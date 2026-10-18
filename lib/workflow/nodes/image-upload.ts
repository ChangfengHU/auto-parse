import { randomUUID } from 'node:crypto';
import type { Page } from 'playwright';
import type { WorkflowContext, NodeResult } from '../types';
import { imageTextIdentity, downloadImage, MAX_TOTAL_IMAGE_BYTES, type ImageTextParams } from '../image-text-contract';
import { imageSelectors, imageOrder, verifyImageAccount } from '../image-text-browser';

export async function executeImageUpload(page: Page, p: ImageTextParams, ctx: WorkflowContext): Promise<NodeResult> {
  try {
    if (!ctx.managedPublicationAuthorized) throw new Error('image_authenticated_browser_required');
    const identity = imageTextIdentity(p);
    await verifyImageAccount(page,p.platform,p.expectedAccountId);
    if (await page.locator(imageSelectors(p.platform).thumbs).count()) throw new Error('image_editor_not_empty');
    const input = page.locator('input[type="file"][multiple]');
    if (await input.count() !== 1) throw new Error('image_upload_control_ambiguous');
    const files = [];
    let total = 0;
    for (const url of identity.urls) {
      const image = await downloadImage(url); total += image.bytes.length;
      if (total > MAX_TOTAL_IMAGE_BYTES) throw new Error('image_batch_too_large');
      files.push(image);
    }
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    try {
      for (const [index,file] of files.entries()) {
        const chunks = await page.evaluateHandle(() => [] as Uint8Array<ArrayBuffer>[]);
        try {
          for (let offset = 0; offset < file.bytes.length; offset += 256 * 1024) {
            await page.evaluate(({chunks,data}) => {chunks.push(Uint8Array.from(atob(data),c=>c.charCodeAt(0)));},
              {chunks,data:file.bytes.subarray(offset,offset+256*1024).toString('base64')});
          }
          await page.evaluate(({transfer,chunks,name,mime}) => {transfer.items.add(new File(chunks,name,{type:mime}));},
            {transfer,chunks,name:String(index+1).padStart(2,'0')+'-'+file.sha256.slice(0,12)+'.'+file.extension,mime:file.mimeType});
        } finally {await chunks.dispose().catch(()=>{});}
      }
      await verifyImageAccount(page,p.platform,p.expectedAccountId);
      await input.evaluate((element,transfer) => {
        if (!(element instanceof HTMLInputElement) || !element.multiple || element.type !== 'file') throw new Error('image_upload_control_invalid');
        element.files = transfer.files;
        element.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
        element.dispatchEvent(new Event('change',{bubbles:true}));
      },transfer);
    } finally {await transfer.dispose().catch(()=>{});}
    const order = await imageOrder(page,p.platform,files.length);
    await verifyImageAccount(page,p.platform,p.expectedAccountId);
    return {success:true,log:['已按输入顺序上传 '+files.length+' 张图片并核对目标账号、数量及缩略图'],output:{
      imageUpload:{fingerprint:identity.fingerprint,uploadId:randomUUID(),order,digests:files.map(f=>f.sha256),count:files.length},
    }};
  } catch (e) {
    const error = e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : 'image_upload_failed';
    return {success:false,log:['图文上传停止：'+error],error};
  }
}
