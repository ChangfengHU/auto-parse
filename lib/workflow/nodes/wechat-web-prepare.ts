import {webDraftFingerprint} from '../../wechat/web-draft-fingerprint';
import {publishVerifiedEditor} from '../../wechat/web-publish';
import type { Page } from 'playwright';
import type { NodeResult, WorkflowContext } from '../types';
import { callWechatDraftTool } from '../../wechat/draft-service';
import { matchWebNewspic, type WebDraftCard } from '../../wechat/web-draft-identity';

type Params = { mediaId: string; expectedAccount: string; mode?:string;requestId?:string;expectedFingerprint?:string;aiGenerated?:string };
export async function executeWechatWebPrepare(page: Page, params: Params, ctx: WorkflowContext): Promise<NodeResult> {
  let editor: Page | undefined;
  let verifier: Page | undefined;
  try {
    if (!ctx.managedPublicationAuthorized) throw Error('wechat_managed_browser_required');
    if (!params.mediaId || params.mediaId.length > 256) throw Error('wechat_invalid_media_id');
    if (!/^gh_[a-zA-Z0-9]{12}$/.test(params.expectedAccount)) throw Error('wechat_web_invalid_account');
    const raw = await callWechatDraftTool('wechat_get_draft', {mediaId: params.mediaId});
    const articles = raw.news_item;
    if (!Array.isArray(articles) || articles.length !== 1) throw Error('wechat_web_single_newspic_required');
    const article = articles[0] as Record<string, unknown>;
    if (article.article_type !== 'newspic' || typeof article.title !== 'string' || typeof article.thumb_url !== 'string')
      throw Error('wechat_web_single_newspic_required');
    const fingerprint=webDraftFingerprint(articles);
    const publishing=params.mode==='publish';
    if(params.mode && !['prepare','publish'].includes(params.mode))throw Error('wechat_web_invalid_mode');
    if(publishing && (ctx.vars.directPublish!=='true'||params.aiGenerated!=='true'||!params.requestId||params.expectedFingerprint!==fingerprint))
      throw Error('wechat_web_publication_confirmation_or_fingerprint_required');
    const official = {title: article.title, createdAt: Number(raw.create_time), thumbUrl: article.thumb_url};
    await page.setViewportSize({width: 1440, height: 1000});
    await page.goto('https://mp.weixin.qq.com/', {waitUntil:'domcontentloaded', timeout:30000});
    const account = (target: Page) => target.evaluate(() => (window as unknown as {wx?: {data?: {user_name?: string}}}).wx?.data?.user_name);
    if (new URL(page.url()).origin !== 'https://mp.weixin.qq.com' || await account(page) !== params.expectedAccount)
      throw Error('wechat_web_account_mismatch');
    await page.getByRole('link', {name:'草稿箱', exact:true}).click({timeout:20000});
    const button = page.getByRole('button', {name:/^贴图/});
    await button.click({timeout:20000});
    await page.locator('.publish_card_container').first().waitFor({state:'visible',timeout:15000});
    const text = await button.innerText(), count = text.match(/^贴图\s*(\d+)$/);
    if (!count) throw Error('wechat_web_total_unknown');
    const collect = () => page.evaluate(() => {
      const seen = new Set<string>();
      const rows = [...document.querySelectorAll('*')].map(e => (e as Element & {__vue__?: {$props?: {source?: WebDraftCard}}}).__vue__?.$props?.source);
      return rows.filter((s): s is WebDraftCard => {
        if (!s?.title) return false;
        const key = s.app_id + ':' + s.file_id;
        if (seen.has(key)) return false;
        seen.add(key); return true;
      }).map(s => ({title:s.title,create_time:s.create_time,img_url:s.img_url,app_id:s.app_id,file_id:s.file_id}));
    });
    let cards=await collect();
    for(let attempt=0;cards.length<Number(count[1])&&attempt<8;attempt++){
      await page.locator('.publish_card_container').last().scrollIntoViewIfNeeded();
      await page.mouse.wheel(0,1200);
      await page.waitForTimeout(1000);cards=await collect();
    }
    if (new URL(page.url()).origin !== 'https://mp.weixin.qq.com') throw Error('wechat_web_account_mismatch');
    verifier = await page.context().newPage();
    await verifier.goto('https://mp.weixin.qq.com/', {waitUntil:'domcontentloaded',timeout:30000});
    if (new URL(verifier.url()).origin !== 'https://mp.weixin.qq.com' || await account(verifier) !== params.expectedAccount)
      throw Error('wechat_web_account_mismatch');
    const matched = matchWebNewspic(official, cards, cards.length === Number(count[1]));
    const elements = page.locator('.publish_card_container');
    const targets: number[] = [];
    for (let n=0; n<await elements.count(); n++) {
      const s = await elements.nth(n).evaluate(e => (e as Element & {__vue__?: {$props?: {source?: WebDraftCard}}}).__vue__?.$props?.source);
      if (s && Number(s.app_id) === matched.appId && Number(s.file_id) === matched.fileId) targets.push(n);
    }
    if (targets.length !== 1) throw Error('wechat_web_draft_element_ambiguous');
    const card = elements.nth(targets[0]); await card.hover();
    const edit = card.locator('.weui-desktop-tooltip__wrp.weui-desktop-link > a.weui-desktop-icon20');
    if (await edit.count() !== 1) throw Error('wechat_web_edit_element_ambiguous');
    [editor] = await Promise.all([page.waitForEvent('popup',{timeout:15000}),edit.click({timeout:12000})]);
    await editor.waitForLoadState('domcontentloaded');
    const editorUrl = new URL(editor.url());
    if (editorUrl.origin !== 'https://mp.weixin.qq.com' || editorUrl.searchParams.get('appmsgid') !== String(matched.appId))
      throw Error('wechat_web_editor_id_mismatch');
    const titleField = editor.locator('.ProseMirror:visible').first();
    await titleField.waitFor({state:'visible',timeout:15000});
    if ((await titleField.innerText()) !== official.title) throw Error('wechat_web_editor_title_mismatch');
    const publishButton = editor.locator('button.mass_send:visible');
    if (await publishButton.count() !== 1) throw Error('wechat_web_publish_button_ambiguous');
    if(publishing){
      const fresh=await callWechatDraftTool('wechat_get_draft',{mediaId:params.mediaId});
      if(webDraftFingerprint(fresh.news_item)!==fingerprint)
        throw Error('wechat_web_draft_changed_prepare_again');
      const result=await publishVerifiedEditor(editor,{mediaId:params.mediaId,expectedAccount:params.expectedAccount,requestId:params.requestId!,expectedFingerprint:params.expectedFingerprint!,aiGenerated:true},matched.appId,fingerprint);
      const retainedEditor=editor;editor=undefined;
      return {success:true,newPage:retainedEditor,log:['公众号网页发表状态：'+result.status],output:{...result,draftFingerprint:fingerprint,title:official.title}};
    }
    return {success:true, log:['已唯一匹配草稿并核对编辑器；未发表。'], output:{prepared:true,published:false,accountVerified:true,uniqueMatch:true,editorVerified:true,draftFingerprint:fingerprint,scanned:cards.length,title:official.title}};
  } catch (e) {
    const error=e instanceof Error && /^wechat_[a-z_]+$/.test(e.message)?e.message:'wechat_web_preparation_failed';
    return {success:false,error,log:['公众号网页核对已停止：'+error]};
  } finally {
    if (editor && !editor.isClosed()) await editor.close().catch(()=>{});
    if (verifier && !verifier.isClosed()) await verifier.close().catch(()=>{});
  }
}
