import path from 'node:path';
import type { Page } from 'playwright';
import type { ClickParams, NodeResult, WorkflowContext } from '../types';
import { booleanVariable } from '../condition';
import { captureScreenshot } from '../utils';
import { executeShadowButtonClick } from './shadow-button';
import { xhsPublicationIdentity, xhsCreationEndpoint, xhsCreationReceipt, readXhsPublication, reserveXhsPublication, finishXhsPublication } from '../xhs-publication-ledger';

/** Final node on the SAME workflow page. No separate publisher or HTTP publish call. */
export async function executeXhsPublish(page: Page, params: NonNullable<ClickParams['xhsPublication']>, ctx: WorkflowContext): Promise<NodeResult> {
  const log: string[] = [];
  let phase = 'preflight';
  try {
    if (!ctx.managedPublicationAuthorized || !booleanVariable(ctx.vars.directPublish)) throw new Error('xhs_authenticated_direct_publication_required');
    if (![true, false, 'true', 'false'].includes(params.aiGenerated)) throw new Error('xhs_ai_declaration_required');
    const p = { ...params, aiGenerated: booleanVariable(params.aiGenerated) };
    const { key, fingerprint } = xhsPublicationIdentity(p);
    const dir = path.join(process.cwd(), '.data', 'xhs-publications');
    const old = await readXhsPublication(dir, key, fingerprint);
    if (old?.receipt) return { success: true, log: ['已读取同一素材的真实发布回执，未重复点击'], output: { ...old.receipt, reused: true } };
    const url = new URL(page.url());
    if (url.origin !== 'https://creator.xiaohongshu.com' || url.pathname !== '/publish/publish') throw new Error('xhs_publication_page_invalid');
    if (ctx.outputs.uploadedSourceUrl !== p.videoUrl) throw new Error('xhs_workflow_upload_proof_missing');
    const verifyAccount = async () => {
      const id = await page.evaluate(async () => {
        const r = await fetch('/api/galaxy/user/info', {credentials:'include',signal:AbortSignal.timeout(10000)});
        if (!r.ok) return '';
        const data = await r.json();
        return data.success === true && data.code === 0 ? String(data.data?.redId || '') : '';
      });
      if (id !== p.expectedAccountId) throw new Error('xhs_creator_account_mismatch');
    };
    await verifyAccount();
    phase = 'upload_check';
    await page.getByText('重新上传',{exact:true}).waitFor({state:'visible',timeout:180000});
    const text = await page.locator('body').innerText();
    if (/上传失败|上传出错|文件损坏|上传中/.test(text)) throw new Error('xhs_upload_not_complete');
    if (await page.locator('input[placeholder="填写标题会有更多赞哦"]').inputValue() !== p.title) throw new Error('xhs_title_mismatch');
    const normalize = (s: string) => s.replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim();
    if (normalize(await page.locator('div.tiptap.ProseMirror[role="textbox"]').innerText()) !== normalize(p.description)) throw new Error('xhs_description_mismatch');
    phase = 'ai_declaration';
    if (p.aiGenerated) {
      const applied = page.getByText('笔记含AI合成内容', {exact:true}).and(page.locator(':visible'));
      if (!await applied.isVisible()) {
        await page.getByText('添加内容类型声明',{exact:true}).click({timeout:10000});
        await applied.click({timeout:10000});
      }
      await applied.waitFor({state:'visible',timeout:10000});
      // A choice must be applied, not merely visible in the open dropdown.
      if (await page.getByText('虚构演绎，仅供娱乐',{exact:true}).and(page.locator(':visible')).count()) throw new Error('xhs_ai_declaration_not_applied');
    }
    phase = 'submit';
    await verifyAccount();
    await page.locator('xhs-publish-btn[submit-disabled="false"]').waitFor({state:'visible',timeout:15000});
    await reserveXhsPublication(dir,key,fingerprint,p.requestId);
    log.push('发布意图已持久化；真实浏览器只点击一次，未知结果禁止重试');
    const receiptPromise = page.waitForResponse(r => r.request().method() === 'POST' && xhsCreationEndpoint(r.url()), {timeout:60000})
      .then(async r => {
        const body = await r.json();
        const receipt = xhsCreationReceipt(r.url(),r.request().method(),r.status(),body);
        if (!receipt) log.push('创建回执未确认：' + JSON.stringify({status:r.status(),code:body.code,success:body.success,dataFields:Object.keys(body.data || {})}));
        return receipt;
      }).catch(() => null);
    const click = await executeShadowButtonClick(page,{text:'发布',shadowHostSelector:'xhs-publish-btn[submit-disabled="false"]',timeout:10000});
    if (!click.success) throw new Error('xhs_submission_unknown_do_not_retry');
    const receipt = await receiptPromise;
    if (!receipt) throw new Error('xhs_submission_unknown_do_not_retry');
    await finishXhsPublication(dir,key,fingerprint,p.requestId,receipt);
    log.push('已取得作品创建回执；审核与公开可见状态需另行回查');
    return {success:true,log,output:receipt,screenshot:await captureScreenshot(page)};
  } catch (error) {
    const message = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'xhs_publication_' + phase + '_failed';
    log.push('小红书发布停止：' + message);
    return {success:false,log,error:message,screenshot:await captureScreenshot(page)};
  }
}
