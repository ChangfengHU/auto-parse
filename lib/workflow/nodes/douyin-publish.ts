import type { Page } from 'playwright';
import path from 'node:path';
import type { NodeResult, WorkflowContext } from '../types';
import { publicationIdentity, publicationReceipt, readPublication, reservePublication, finishPublication } from '../douyin-publication-ledger';
import { verifyDouyinDispatch } from '../douyin-runtime';

type Params = {
  requestId: string; expectedAccountId: string; videoUrl: string; title: string;
  aiGenerated: boolean; confirmPublish: boolean;
};

// This is a workflow node: it consumes the current page after credential_login/file_upload.
// It does not create a second publisher or manage Fleet browser sessions.
export async function executeDouyinPublish(page: Page, params: Params, ctx: WorkflowContext): Promise<NodeResult> {
  const log: string[] = [];
  const emit = (message: string) => { log.push(message); ctx.emit?.('log', message); };
  try {
    if (params.confirmPublish !== true || typeof params.aiGenerated !== 'boolean') throw new Error('publication_confirmation_required');
    const { key, fingerprint } = publicationIdentity(params.requestId, params.expectedAccountId, params.videoUrl, params.title, params.aiGenerated);
    const directory = path.join(process.cwd(), '.data', 'douyin-publications');
    const previous = await readPublication(directory, key, fingerprint);
    if (previous?.receipt) return { success: true, log: ['已读取同一请求的真实作品回执，未重复提交'], output: { ...previous.receipt, reused: true } };

    if (ctx.outputs.creatorVerified !== true || ctx.outputs.accountId !== params.expectedAccountId ||
        ctx.outputs.uploadedSourceUrl !== params.videoUrl || ctx.outputs.title !== params.title) {
      throw new Error('publication_workflow_preflight_missing');
    }

    await verifyDouyinDispatch();
    const url = new URL(page.url());
    if (url.origin !== 'https://creator.douyin.com' || !url.pathname.includes('/content/post')) throw new Error('publication_page_invalid');
    const verifyAccount = async () => {
      const accountId = await page.evaluate(async () => {
        const response = await fetch('/web/api/media/user/info/', { credentials: 'include', signal: AbortSignal.timeout(8000) });
        if (!response.ok) return '';
        const data = await response.json();
        return data.status_code === 0 ? String(data.user?.uid || '') : '';
      });
      if (accountId !== params.expectedAccountId) throw new Error('creator_account_mismatch');
    };
    await verifyAccount();
    emit('已确认执行节点可调度和目标账号；等待视频真实上传完成');
    await page.waitForFunction(() => {
      const text = document.body.innerText;
      return /上传失败|上传出错|文件损坏/.test(text) ||
        (!/取消上传/.test(text) && /上传成功|重新上传/.test(text));
    }, null, { timeout: 600000 });
    if (/上传失败|上传出错|文件损坏/.test(await page.locator('body').innerText())) throw new Error('video_upload_failed');
    const title = page.locator('input[placeholder*="作品标题"]:visible');
    if (await title.count() !== 1) throw new Error('title_control_unconfirmed');
    await title.fill(params.title);
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.fill(params.aiGenerated ? '本视频由AI生成。' : '');
    if (params.aiGenerated) {
      const hint = page.getByRole('button', { name: '我知道了', exact: true });
      if (await hint.isVisible()) await hint.click();
      await page.getByText('请选择自主声明', { exact: true }).click();
      const label = page.locator('label').filter({ has: page.getByText('内容由AI生成', { exact: true }) });
      if (await label.count() !== 1) throw new Error('ai_declaration_control_unconfirmed');
      await label.locator('input[type="radio"]').click({ force: true, timeout: 15000 });
      await page.getByText('作者声明：内容由AI生成', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
      await page.getByRole('button', { name: '确定', exact: true }).click();
      await page.getByText('请选择自主声明', { exact: true }).waitFor({ state: 'hidden' });
      await page.getByText('内容由AI生成', { exact: true }).waitFor({ state: 'visible' });
    }
    emit('等待内容检测明确通过；超时不会继续发布');
    await page.waitForFunction(() => /作品未见异常|检测通过|未发现异常|未见风险/.test(document.body.innerText), null, { timeout: 240000 });
    if (/无法发布|检测失败|审核不通过/.test(await page.locator('body').innerText())) throw new Error('content_check_failed');
    const button = page.getByRole('button', { name: '发布', exact: true });
    if (await button.count() !== 1 || !await button.isEnabled()) throw new Error('publish_control_unconfirmed');
    await verifyDouyinDispatch();
    await verifyAccount();
    await reservePublication(directory, key, fingerprint);
    emit('发布意图已持久化；只点击一次，结果不明时禁止自动重试');
    const receiptPromise = page.waitForResponse(r => {
      const u = new URL(r.url());
      return u.origin === 'https://creator.douyin.com' && r.request().method() === 'POST' &&
        /^\/web\/api\/media\/aweme\/create(?:_v2)?\/?$/.test(u.pathname);
    }, { timeout: 60000 }).then(async r => publicationReceipt(r.url(), r.request().method(), r.status(), await r.json())).catch(() => null);
    await button.click({ timeout: 15000 });
    const receipt = await receiptPromise;
    if (!receipt) throw new Error('submission_unknown_do_not_retry');
    await finishPublication(directory, key, fingerprint, receipt);
    emit('已取得真实作品创建回执；平台审核状态仍需另行查询');
    return { success: true, log, output: receipt };
  } catch (error) {
    const message = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'publication_step_failed';
    emit('抖音发布节点停止：' + message);
    return { success: false, log, error: message };
  }
}
