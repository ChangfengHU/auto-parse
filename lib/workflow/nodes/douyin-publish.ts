import type { Page } from 'playwright';
import path from 'node:path';
import { fillDouyinCovers } from '../douyin-cover';
import { captureScreenshot } from '../utils';
import type { NodeResult, WorkflowContext } from '../types';
import { publicationIdentity, publicationReceipt, parseCreationBody, readPublication, reservePublication, finishPublication } from '../douyin-publication-ledger';

type Params = {
  requestId: string; expectedAccountId: string; videoUrl: string; title: string;
  aiGenerated: boolean; confirmPublish: boolean;
  verifyCurrentSession?: boolean;
  prepareOnly?: boolean; description?: string; topics?: string[];
  cover?: { verticalUrl?: string; horizontalUrl?: string };
};

// This is a workflow node: it consumes the current page after credential_login/file_upload.
// It does not create a second publisher or manage Fleet browser sessions.
export async function executeDouyinPublish(page: Page, params: Params, ctx: WorkflowContext): Promise<NodeResult> {
  const log: string[] = [];
  let phase = 'preflight';
  const emit = (message: string) => { log.push(message); ctx.emit?.('log', message); };
  try {
    if ((params.confirmPublish !== true && params.prepareOnly !== true) || typeof params.aiGenerated !== 'boolean' ||
        (params.prepareOnly === true && params.confirmPublish === true)) throw new Error('publication_confirmation_required');
    const { key, fingerprint } = publicationIdentity(params.requestId, params.expectedAccountId, params.videoUrl, params.title, params.aiGenerated, params);
    const directory = path.join(process.cwd(), '.data', 'douyin-publications');
    const previous = await readPublication(directory, key, fingerprint);
    if (previous?.receipt) return { success: true, log: ['已读取同一请求的真实作品回执，未重复提交'], output: { ...previous.receipt, reused: true } };

    if ((params.verifyCurrentSession !== true &&
        (ctx.outputs.creatorVerified !== true || ctx.outputs.accountId !== params.expectedAccountId)) ||
        ctx.outputs.uploadedSourceUrl !== params.videoUrl || ctx.outputs.title !== params.title) {
      throw new Error('publication_workflow_preflight_missing');
    }

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
    emit('已确认目标账号；等待视频真实上传完成');
    phase = 'upload';
    await page.waitForFunction(() => {
      const text = document.body.innerText;
      return /上传失败|上传出错|文件损坏/.test(text) ||
        (!/取消上传/.test(text) && /上传成功|重新上传/.test(text));
    }, null, { timeout: 600000 });
    if (/上传失败|上传出错|文件损坏/.test(await page.locator('body').innerText())) throw new Error('video_upload_failed');
    const title = page.locator('input[placeholder*="作品标题"]:visible');
    phase = 'title';
    if (await title.count() !== 1) throw new Error('title_control_unconfirmed');
    await title.fill(params.title);
    const editor = page.locator('[contenteditable="true"]').first();
    phase = 'description';
    const description = params.description ?? await editor.innerText();
    const topics = params.topics ?? [];
    if (topics.length > 5 || topics.some(topic => typeof topic !== 'string' || !/^[\p{L}\p{N}_]{1,30}$/u.test(topic))) {
      throw new Error('publication_topics_invalid');
    }
    const caption = [description.trim(), topics.map(topic => '#' + topic).join(' '),
      params.aiGenerated && !description.includes('本视频由AI生成') ? '本视频由AI生成。' : ''].filter(Boolean).join('\n');
    if (caption.length > 1000) throw new Error('publication_description_too_long');
    // Slate keeps its own selection/model: fill alone can append to old text.
    await editor.click();
    await editor.press('ControlOrMeta+A');
    await editor.press('Backspace');
    await editor.fill(caption);
    const normalizeCaption = (value: string) => value.replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
    if (normalizeCaption(await editor.innerText()) !== normalizeCaption(caption)) throw new Error('publication_description_not_applied');
    let appliedCover;
    if (params.cover) {
      phase = 'cover';
      await page.setViewportSize({ width: 1440, height: 1000 });
      appliedCover = await fillDouyinCovers(page, params.cover);
    }
    if (params.aiGenerated) {
      phase = 'ai_declaration';
      const hint = page.getByRole('button', { name: '我知道了', exact: true });
      if (await hint.isVisible()) await hint.click();
      await page.getByText('请选择自主声明', { exact: true }).click();
      const label = page.locator('label').filter({ has: page.getByText('内容由AI生成', { exact: true }) });
      if (await label.count() !== 1) throw new Error('ai_declaration_control_unconfirmed');
      await label.click({ timeout: 15000 });
      phase = 'ai_declaration_confirm';
      emit('AI声明控件状态：' + JSON.stringify(await label.evaluate(el =>
        [el, ...Array.from(el.querySelectorAll('*'))].map(n => ({
          tag: n.tagName, className: n.className, role: n.getAttribute('role'),
          ariaChecked: n.getAttribute('aria-checked'), checked: (n as HTMLInputElement).checked,
        }))
      )));
      // Douyin's Semi Radio renders selection in the component class; its hidden
      // native input stays unchecked even after a real user click.
      const selected = (el: Element) => el.classList.contains('semi-radio-checked') ||
        el.getAttribute('aria-checked') === 'true' || Boolean(el.querySelector<HTMLInputElement>('input[type="radio"]')?.checked);
      const labelHandle = await label.elementHandle();
      if (!labelHandle) throw new Error('ai_declaration_control_unconfirmed');
      await page.waitForFunction(selected, labelHandle, { timeout: 15000 });
      if (!await label.evaluate(selected)) throw new Error('ai_declaration_not_selected');
      phase = 'ai_confirm_button';
      await page.getByRole('button', { name: '确定', exact: true }).click();
      phase = 'ai_applied';
      await page.getByText('请选择自主声明', { exact: true }).waitFor({ state: 'hidden' });
      // The applied field and preview both show this label; either visible copy
      // confirms it only after the selection and dialog confirmation above.
      await page.getByText('内容由AI生成', { exact: true }).and(page.locator(':visible')).first().waitFor({ state: 'visible' });
    }
    if (params.prepareOnly) {
      emit('发布预览已准备；未点击发布、未占用发布编号');
      return { success: true, log, screenshot: await captureScreenshot(page), output: {
        prepared: true, published: false, title: params.title, description: caption, topics,
        topicMode: 'caption_text', cover: appliedCover ?? null,
      } };
    }
    emit('等待内容检测明确通过；超时不会继续发布');
    phase = 'content_check';
    await page.waitForFunction(() => /作品未见异常|检测通过|未发现异常|未见风险/.test(document.body.innerText), null, { timeout: 240000 });
    if (/无法发布|检测失败|审核不通过/.test(await page.locator('body').innerText())) throw new Error('content_check_failed');
    const button = page.getByRole('button', { name: '发布', exact: true });
    if (await button.count() !== 1 || !await button.isEnabled()) throw new Error('publish_control_unconfirmed');
    await verifyAccount();
    await reservePublication(directory, key, fingerprint);
    phase = 'submission';
    emit('发布意图已持久化；只点击一次，结果不明时禁止自动重试');
    const receiptPromise = page.waitForResponse(r => {
      const u = new URL(r.url());
      return u.origin === 'https://creator.douyin.com' && r.request().method() === 'POST' &&
        /^\/web\/api\/media\/aweme\/create(?:_v2)?\/?$/.test(u.pathname);
    }, { timeout: 60000 }).then(async r => {
      const body = parseCreationBody(await r.text());
      const receipt = publicationReceipt(r.url(), r.request().method(), r.status(), body);
      if (!receipt) emit('创建回执未确认：' + JSON.stringify({
        httpStatus: r.status(), statusCode: body.status_code, fields: Object.keys(body),
      }));
      return receipt;
    }).catch(() => null);
    await button.click({ timeout: 15000 });
    const receipt = await receiptPromise;
    if (!receipt) throw new Error('submission_unknown_do_not_retry');
    await finishPublication(directory, key, fingerprint, receipt);
    emit('已取得真实作品创建回执；平台审核状态仍需另行查询');
    return { success: true, log, output: receipt };
  } catch (error) {
    const detail = error instanceof Error ? (error.name === 'TimeoutError' ? 'timeout' :
      error.message.includes('strict mode violation') ? 'selector_ambiguous' : 'operation_failed') : 'operation_failed';
    emit('发布检查阶段：' + phase + '；类别：' + detail);
    const message = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'publication_' + phase + '_failed';
    emit('抖音发布节点停止：' + message);
    const screenshot = await captureScreenshot(page).catch(() => undefined);
    return { success: false, log, error: message, screenshot };
  }
}
