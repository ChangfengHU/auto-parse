import type { Page } from 'playwright';
import type { NodeResult, WorkflowContext } from '../types';
import { callWechatDraftTool } from '../../wechat/draft-service';
import { matchWebNewspic, type WebDraftCard } from '../../wechat/web-draft-identity';

type Params = { mediaId: string; expectedAccount: string };
export async function executeWechatWebPrepare(page: Page, params: Params, ctx: WorkflowContext): Promise<NodeResult> {
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
    const official = {title: article.title, createdAt: Number(raw.create_time), thumbUrl: article.thumb_url};
    let source: Page | undefined;
    for (const candidate of page.context().pages()) {
      if (candidate === page || !candidate.url().startsWith('https://mp.weixin.qq.com/')) continue;
      try {
        const id = await candidate.evaluate(() => (window as unknown as {wx?: {data?: {user_name?: string}}}).wx?.data?.user_name);
        if (id === params.expectedAccount) { if (source) throw Error('wechat_web_account_tab_ambiguous'); source = candidate; }
      } catch (e) { if (e instanceof Error && e.message === 'wechat_web_account_tab_ambiguous') throw e; }
    }
    if (!source) throw Error('wechat_web_account_tab_not_found');
    const sourceUrl = new URL(source.url());
    if (sourceUrl.origin !== 'https://mp.weixin.qq.com') throw Error('wechat_web_account_tab_not_found');
    await page.setViewportSize({width: 1440, height: 1000});
    await page.goto(sourceUrl.href, {waitUntil:'domcontentloaded', timeout:30000});
    const account = () => page.evaluate(() => (window as unknown as {wx?: {data?: {user_name?: string}}}).wx?.data?.user_name);
    if (await account() !== params.expectedAccount) throw Error('wechat_web_account_mismatch');
    await page.getByRole('link', {name:'草稿箱', exact:true}).click({timeout:20000});
    const button = page.getByRole('button', {name:/^贴图/});
    await button.click({timeout:20000});
    await page.waitForTimeout(2000);
    const text = await button.innerText(), count = text.match(/^贴图\s*(\d+)$/);
    if (!count) throw Error('wechat_web_total_unknown');
    const cards = await page.evaluate(() => {
      const seen = new Set<string>();
      const rows = [...document.querySelectorAll('*')].map(e => (e as Element & {__vue__?: {$props?: {source?: WebDraftCard}}}).__vue__?.$props?.source);
      return rows.filter((s): s is WebDraftCard => {
        if (!s?.title) return false;
        const key = s.app_id + ':' + s.file_id;
        if (seen.has(key)) return false;
        seen.add(key); return true;
      }).map(s => ({title:s.title,create_time:s.create_time,img_url:s.img_url,app_id:s.app_id,file_id:s.file_id}));
    });
    if (new URL(page.url()).origin !== 'https://mp.weixin.qq.com') throw Error('wechat_web_account_mismatch');
    const sourceAccount = await source.evaluate(() => (window as unknown as {wx?: {data?: {user_name?: string}}}).wx?.data?.user_name);
    if (sourceAccount !== params.expectedAccount) throw Error('wechat_web_account_mismatch');
    matchWebNewspic(official, cards, cards.length === Number(count[1]));
    return {success:true, log:['已唯一匹配公众号贴图草稿；未发表。'], output:{prepared:true,published:false,accountVerified:true,uniqueMatch:true,scanned:cards.length,title:official.title}};
  } catch (e) {
    const error=e instanceof Error && /^wechat_[a-z_]+$/.test(e.message)?e.message:'wechat_web_preparation_failed';
    return {success:false,error,log:['公众号网页核对已停止：'+error]};
  }
}
