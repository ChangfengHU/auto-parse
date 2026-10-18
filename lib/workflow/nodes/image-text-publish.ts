import path from 'node:path';
import type { Page } from 'playwright';
import type { WorkflowContext, NodeResult } from '../types';
import { booleanVariable } from '../condition';
import { imageTextIdentity, imageCreationReceipt, readImagePublication, reserveImagePublication, finishImagePublication, type ImageTextParams } from '../image-text-contract';
import { imageOrder, imageMetadata, imagePublicationSettings, verifyImageAccount } from '../image-text-browser';
import { xhsCreationEndpoint } from '../xhs-publication-ledger';
import { executeShadowButtonClick } from './shadow-button';

export async function executeImageTextPublish(page: Page, p: ImageTextParams, ctx: WorkflowContext): Promise<NodeResult> {
  let submitting = false;
  try {
    if (!ctx.managedPublicationAuthorized) throw new Error('image_authenticated_browser_required');
    if (!['prepare','publish'].includes(p.mode || '')) throw new Error('image_publication_mode_required');
    const identity = imageTextIdentity(p), publish = p.mode === 'publish';
    const directory = path.join(process.cwd(),'.data','image-text-publications');
    if (publish) {
      if (!booleanVariable(ctx.vars.directPublish)) throw new Error('image_direct_publication_confirmation_required');
      if (identity.urls.some(url=>new URL(url).hostname === 'placehold.co')) throw new Error('image_test_fixture_must_not_be_published');
      const old = await readImagePublication(directory,identity.key,identity.fingerprint);
      if (old?.receipt) return {success:true,log:['复用真实作品回执；没有再次点击发布'],output:{...old.receipt,reused:true}};
    }
    const proof = ctx.outputs.imageUpload as {fingerprint?:string;uploadId?:string;order?:string[];count?:number} | undefined;
    if (!proof?.uploadId || proof.fingerprint !== identity.fingerprint || proof.count !== identity.urls.length) throw new Error('image_workflow_upload_proof_missing');
    const prepared = ctx.outputs.imageTextPrepared as {fingerprint?:string;uploadId?:string} | undefined;
    if (publish && (prepared?.fingerprint !== identity.fingerprint || prepared.uploadId !== proof.uploadId)) throw new Error('image_preparation_proof_missing');
    await verifyImageAccount(page,p.platform,p.expectedAccountId);
    if (JSON.stringify(await imageOrder(page,p.platform,identity.urls.length)) !== JSON.stringify(proof.order)) throw new Error('image_order_or_content_changed');
    await imageMetadata(page,p,identity.aiGenerated,!publish);
    await imagePublicationSettings(page,p.platform);
    if (!publish) return {success:true,log:['图文准备完成：标题、正文、图片顺序及AI声明已核对；尚未发布，也不保证云端草稿已保存'],output:{
      prepared:true,published:false,imageCount:identity.urls.length,imageTextPrepared:{fingerprint:identity.fingerprint,uploadId:proof.uploadId},
    }};
    if (p.platform === 'douyin') {
      await page.waitForFunction(()=>/作品未见异常|检测通过|未发现异常|未见风险/.test(document.body.innerText),null,{timeout:240000});
      if (/无法发布|检测失败|审核不通过/.test(await page.locator('body').innerText())) throw new Error('image_content_check_failed');
      const button = page.getByRole('button',{name:'发布',exact:true});
      if (await button.count() !== 1 || !await button.isEnabled()) throw new Error('image_publish_control_unconfirmed');
    } else await page.locator('xhs-publish-btn[submit-disabled="false"]').waitFor({state:'visible',timeout:15000});
    // Recheck immediately before reserving and clicking. Never replay an uncertain submission.
    await verifyImageAccount(page,p.platform,p.expectedAccountId);
    await imageMetadata(page,p,identity.aiGenerated,false);
    await imagePublicationSettings(page,p.platform);
    if (JSON.stringify(await imageOrder(page,p.platform,identity.urls.length)) !== JSON.stringify(proof.order)) throw new Error('image_order_or_content_changed');
    await reserveImagePublication(directory,identity.key,identity.fingerprint,p.requestId);
    submitting = true;
    const response = page.waitForResponse(r => {
      if (r.request().method() !== 'POST') return false;
      const u = new URL(r.url());
      return p.platform === 'xhs' ? xhsCreationEndpoint(r.url()) : u.origin === 'https://creator.douyin.com' && /^\/web\/api\/media\/aweme\/create(?:_v2)?\/?$/.test(u.pathname);
    },{timeout:60000}).then(async r=>imageCreationReceipt(p.platform,r.url(),r.request().method(),r.status(),await r.text())).catch(()=>null);
    if (p.platform === 'xhs') {
      const click = await executeShadowButtonClick(page,{text:'发布',shadowHostSelector:'xhs-publish-btn[submit-disabled="false"]',timeout:10000});
      if (!click.success) throw new Error('image_submission_unknown_do_not_retry');
    } else await page.getByRole('button',{name:'发布',exact:true}).click({timeout:10000});
    const receipt = await response;
    if (!receipt) throw new Error('image_submission_unknown_do_not_retry');
    await finishImagePublication(directory,identity.key,identity.fingerprint,p.requestId,receipt);
    return {success:true,log:['已取得真实创建回执；审核通过和公开可见仍需另行回查'],output:receipt};
  } catch (e) {
    const error = submitting ? 'image_submission_unknown_do_not_retry' : e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : 'image_text_preparation_or_check_failed';
    return {success:false,log:['图文流程停止：'+error],error};
  }
}
