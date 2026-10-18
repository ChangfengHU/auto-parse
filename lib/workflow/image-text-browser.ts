import type { Page } from 'playwright';
import { digest, type ImagePlatform, type ImageTextParams } from './image-text-contract';

export const imageSelectors = (platform: ImagePlatform) => platform === 'xhs' ? {
  thumbs: 'img.img.preview', title: 'input[placeholder="填写标题会有更多赞哦"]',
  body: 'div.tiptap.ProseMirror[role="textbox"]',
} : {
  thumbs: 'div[draggable="true"][class^="img-"] > img', title: 'input[placeholder="添加作品标题"]',
  body: '[contenteditable="true"].zone-container',
};
export const normalizeImageCaption = (value: string) => value.replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim();
export async function verifyImageAccount(page: Page, platform: ImagePlatform, expected: string) {
  const url = new URL(page.url());
  if (url.origin !== (platform === 'xhs' ? 'https://creator.xiaohongshu.com' : 'https://creator.douyin.com') ||
      !(platform === 'xhs' ? url.pathname === '/publish/publish' : /^\/creator-micro\/content\/(upload|post\/image)$/.test(url.pathname))) throw new Error('image_editor_page_invalid');
  const account = await page.evaluate(async platform => {
    const r = await fetch(platform === 'xhs' ? '/api/galaxy/user/info' : '/web/api/media/user/info/',{credentials:'include',signal:AbortSignal.timeout(10000)});
    if (!r.ok) return '';
    const data = await r.json();
    return platform === 'xhs' ? (data.success === true && data.code === 0 ? String(data.data?.userId || '') : '') :
      (data.status_code === 0 ? String(data.user?.uid || '') : '');
  },platform);
  if (account !== expected) throw new Error('image_creator_account_mismatch');
}
export async function imageOrder(page: Page, platform: ImagePlatform, count: number) {
  const selector = imageSelectors(platform).thumbs;
  await page.waitForFunction(({selector,count}) => {
    const images = [...document.querySelectorAll<HTMLImageElement>(selector)];
    return images.length === count && images.every(img => img.complete && img.naturalWidth > 0) &&
      !/取消上传|上传中|上传失败|上传出错|文件损坏/.test(document.body.innerText);
  },{selector,count},{timeout:120000});
  // Do not persist signed CDN query strings. The object path (or blob UUID) tracks order.
  const sources = await page.locator(selector).evaluateAll(elements => elements.map(element => {
    const url = new URL((element as HTMLImageElement).src);
    return url.origin + url.pathname;
  }));
  return sources.map(digest);
}
export async function imageAiDeclaration(page: Page, platform: ImagePlatform, wanted: boolean, apply: boolean) {
  if (platform === 'xhs') {
    const applied = page.getByText('笔记含AI合成内容',{exact:true}).and(page.locator(':visible'));
    if (wanted && apply && !await applied.count()) {
      await page.getByText('添加内容类型声明',{exact:true}).click({timeout:10000});
      await applied.click({timeout:10000});
    }
    const dropdown = await page.getByText('虚构演绎，仅供娱乐',{exact:true}).and(page.locator(':visible')).count();
    if (dropdown || Boolean(await applied.count()) !== wanted) throw new Error('image_ai_declaration_mismatch');
  } else {
    const applied = page.getByText('内容由AI生成',{exact:true}).and(page.locator(':visible'));
    if (wanted && apply && !await applied.count()) {
      const hint = page.getByRole('button',{name:'我知道了',exact:true});
      if (await hint.isVisible()) await hint.click();
      await page.getByText('请选择自主声明',{exact:true}).click({timeout:10000});
      const label = page.locator('label').filter({has:page.getByText('内容由AI生成',{exact:true})});
      if (await label.count() !== 1) throw new Error('image_ai_control_ambiguous');
      await label.click({timeout:10000});
      if (!await label.evaluate(el => el.classList.contains('semi-radio-checked') || el.getAttribute('aria-checked') === 'true' || Boolean(el.querySelector<HTMLInputElement>('input')?.checked))) throw new Error('image_ai_declaration_not_selected');
      await page.getByRole('button',{name:'确定',exact:true}).click({timeout:10000});
      await page.getByText('请选择自主声明',{exact:true}).waitFor({state:'hidden',timeout:10000});
    }
    if (await page.getByRole('dialog').filter({has:page.getByText('内容由AI生成',{exact:true})}).isVisible()) throw new Error('image_ai_dialog_still_open');
    if (Boolean(await applied.count()) !== wanted) throw new Error('image_ai_declaration_mismatch');
  }
}
export async function imageMetadata(page: Page, p: ImageTextParams, aiGenerated: boolean, apply: boolean) {
  const selectors = imageSelectors(p.platform), title = page.locator(selectors.title), body = page.locator(selectors.body);
  if (await title.count() !== 1 || await body.count() !== 1) throw new Error('image_metadata_controls_ambiguous');
  if (apply) {
    await title.fill(p.title);
    await body.click(); await body.press('ControlOrMeta+A'); await body.press('Backspace');
    await body.fill(p.description);
  }
  if (await title.inputValue() !== p.title || normalizeImageCaption(await body.innerText()) !== normalizeImageCaption(p.description)) throw new Error('image_metadata_mismatch');
  await imageAiDeclaration(page,p.platform,aiGenerated,apply);
}

/** Initial release intentionally supports immediate, public, single-platform posting only. */
export async function imagePublicationSettings(page: Page, platform: ImagePlatform) {
  if (platform === 'xhs') {
    if (await page.locator('.d-select-description').and(page.getByText('公开可见',{exact:true})).count() !== 1) throw new Error('image_public_visibility_unconfirmed');
    const timer = page.locator('.custom-switch-card').filter({has:page.getByText('定时发布',{exact:true})}).locator('input[type="checkbox"]');
    if (await timer.count() !== 1 || await timer.isChecked()) throw new Error('image_immediate_publication_unconfirmed');
  } else {
    for (const text of ['公开','立即发布','不同时发布']) {
      const label = page.locator('label[data-checked="true"]').filter({has:page.getByText(text,{exact:true})});
      if (await label.count() !== 1) throw new Error('image_publication_settings_unconfirmed');
    }
  }
}
