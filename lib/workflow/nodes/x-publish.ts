import path from 'node:path';
import type { Page, Locator } from 'playwright';
import type { WorkflowContext, NodeResult } from '../types';
import { booleanVariable } from '../condition';
import { xIdentity, xText, xCreationEndpoint, xCreationReceipt, xRecord, reserveX, finishX, type XPostParams } from '../x-publication';
const directory = () => path.join(process.cwd(), '.data', 'x-publications');
async function account(page: Page, username: string) {
  const url = new URL(page.url());
  if (url.origin !== 'https://x.com' || url.pathname !== '/compose/post') throw new Error('x_composer_page_invalid');
  const profile = page.locator('[data-testid="AppTabBar_Profile_Link"]');
  await profile.waitFor({ state: 'attached', timeout: 15000 });
  if ((await profile.getAttribute('href'))?.toLowerCase() !== '/' + username) throw new Error('x_account_mismatch');
  if (!await page.locator('[aria-label="Account menu"]').isVisible()) throw new Error('x_login_required');
}
async function composer(page: Page): Promise<Locator> {
  const scope = page.locator('[role="dialog"]:visible').filter({ has: page.locator('[data-testid="tweetTextarea_0"]') });
  await scope.first().waitFor({state:'visible',timeout:15000});
  if (await scope.count() !== 1) throw new Error('x_composer_ambiguous');
  return scope;
}
async function verify(scope: Locator, text: string) {
  const fields = scope.locator('[contenteditable="true"][role="textbox"]');
  if (await fields.count() !== 1 || xText(await fields.innerText()) !== text) throw new Error('x_text_or_thread_mismatch');
  if (await scope.locator('[data-testid="attachments"],[data-testid="quoteTweet"],[data-testid="Tweet-User-Avatar"]').count()) throw new Error('x_text_only_required');
  const button = scope.locator('[data-testid="tweetButton"]');
  await scope.locator('[data-testid="tweetButton"]:not([disabled]):not([aria-disabled="true"])').waitFor({state:'visible',timeout:15000});
  if (await button.count() !== 1 || !await button.isEnabled()) throw new Error('x_post_disabled_check_length_or_account');
}
export async function executeXPublish(page: Page, p: XPostParams, ctx: WorkflowContext): Promise<NodeResult> {
  let submitting = false;
  try {
    if (!ctx.managedPublicationAuthorized) throw new Error('x_authenticated_managed_browser_required');
    if (!['prepare', 'publish'].includes(p.mode)) throw new Error('x_mode_required');
    const identity = xIdentity(p), publish = p.mode === 'publish';
    if (publish) {
      if (!booleanVariable(ctx.vars.directPublish)) throw new Error('x_direct_publication_confirmation_required');
      const old = await xRecord(directory(), identity.key, identity.fingerprint);
      if (old?.receipt) return { success: true, log: ['已复用保存的真实发推回执，未再次点击'], output: { ...old.receipt, reused: true } };
      if (old) throw new Error('x_submission_unknown_do_not_retry');
      const proof = ctx.outputs.xPrepared as {fingerprint?: string; requestId?: string} | undefined;
      if (proof?.fingerprint !== identity.fingerprint || proof.requestId !== p.requestId) throw new Error('x_preparation_proof_missing');
    } else await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await account(page, identity.username);
    const scope = await composer(page);
    if (!publish) {
      const field = scope.locator('[data-testid="tweetTextarea_0"]');
      await field.waitFor({ state: 'visible', timeout: 15000 });
      const existing = await field.innerText();
      if (existing.trim() && xText(existing) !== identity.text) throw new Error('x_existing_draft_requires_review');
      await field.fill(identity.text, { timeout: 15000 });
    }
    await verify(scope, identity.text);
    await account(page, identity.username);
    if (!publish) return { success: true, log: ['X 正文与目标账号已核对；仅准备，未点击发布；不保证云端草稿已保存'], output: {
      prepared: true, published: false, username: identity.username,
      xPrepared: { fingerprint: identity.fingerprint, requestId: p.requestId },
    } };
    await reserveX(directory(), identity.key, identity.fingerprint, p.requestId);
    submitting = true;
    const response = page.waitForResponse(r => {
      if (r.request().method() !== 'POST' || !xCreationEndpoint(r.url())) return false;
      try { return xText(r.request().postDataJSON().variables.tweet_text) === identity.text; } catch { return false; }
    }, { timeout: 60000 }).then(async r => xCreationReceipt(r.url(), r.request().method(), r.status(), await r.json(), identity)).catch(() => null);
    await scope.locator('[data-testid="tweetButton"]').click({ timeout: 10000 });
    const receipt = await response;
    if (!receipt) throw new Error('x_submission_unknown_do_not_retry');
    await finishX(directory(), identity.key, identity.fingerprint, p.requestId, receipt);
    return { success: true, log: ['已取得匹配账号及正文的 X 创建回执；公开可见性需另行回查'], output: receipt };
  } catch (e) {
    const error = submitting ? 'x_submission_unknown_do_not_retry' : e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : 'x_preparation_or_check_failed';
    return { success: false, error, log: ['X 流程停止：' + error] };
  }
}
