import type { Page, Locator } from 'playwright';
import { createHash } from 'node:crypto';

export type DouyinCover = { verticalUrl?: string; horizontalUrl?: string };
type Orientation = 'vertical' | 'horizontal';
export class DouyinCoverError extends Error {
  constructor(public code: string, public orientation: Orientation, public stage: string) { super(code); this.name = 'DouyinCoverError'; }
}
export function validateCoverUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('publication_cover_url_invalid'); }
  if (url.protocol !== 'https:' || !['resource.vyibc.com', 'cdn.vyibc.com'].includes(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash ||
      !/\.(png|jpe?g)$/i.test(url.pathname)) throw new Error('publication_cover_url_invalid');
  return url.href;
}
export async function downloadDouyinCover(value: string, maxBytes = 8 * 1024 * 1024) {
  const url = validateCoverUrl(value);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('publication_cover_download_failed');
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('publication_cover_too_large');
  const parts: Uint8Array[] = [];
  let size = 0;
  if (!response.body) throw new Error('publication_cover_download_failed');
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('publication_cover_too_large');
      parts.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const buffer = Buffer.concat(parts);
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!jpeg && !png) throw new Error('publication_cover_format_invalid');
  return { url, buffer, mimeType: jpeg ? 'image/jpeg' : 'image/png', name: jpeg ? 'cover.jpg' : 'cover.png',
    sha256: createHash('sha256').update(buffer).digest('hex') };
}
export function douyinCoverControl(page: Page, orientation: Orientation) {
  const label = orientation === 'vertical' ? '竖封面3:4' : '横封面4:3';
  return page.locator('[class*="coverControl-"]').filter({ has: page.getByText(label, { exact: true }) });
}
export async function douyinCoverPreview(control: Locator): Promise<string[]> {
  return control.evaluate(el => [...new Set([el, ...Array.from(el.querySelectorAll('*'))].flatMap(node => {
    const image = node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0 ? node.currentSrc || node.src : '';
    const background = getComputedStyle(node).backgroundImage;
    return [image, background !== 'none' ? background : ''].filter(Boolean);
  }))].sort());
}
export async function fillDouyinCovers(page: Page, cover: DouyinCover, emit?: (message: string) => void) {
  const urls: Record<string, string> = {};
  const evidence: Record<string, { sha256: string; bytes: number; previewChanged: boolean; dialogConfirmed: boolean }> = {};
  const completed: Array<{ orientation: Orientation; previews: string[] }> = [];
  for (const [orientation, value] of [['vertical', cover.verticalUrl], ['horizontal', cover.horizontalUrl]] as const) {
    if (!value) continue;
    let stage = 'download';
    try {
      const image = await downloadDouyinCover(value);
      stage = 'control';
      const control = douyinCoverControl(page, orientation);
      if (await control.count() !== 1) throw new Error('publication_cover_control_unconfirmed');
      const before = await douyinCoverPreview(control);
      const open = control.locator('[class^="cover-"]').first();
      await open.scrollIntoViewIfNeeded({ timeout: 15000 });
      await open.click({ timeout: 15000 });
      stage = 'upload_dialog';
      const dialog = page.getByRole('dialog').filter({ has: page.locator('.semi-upload input.semi-upload-hidden-input') }).and(page.locator(':visible'));
      await dialog.waitFor({state:'visible',timeout:30000});
      // The modern editor has an AI reference upload and a separate cover upload.
      // Use only the native file input under the explicitly labelled cover drop zone.
      const area = dialog.locator('.semi-upload').filter({ has: page.getByText('点击上传文件或拖拽文件到这里', { exact: true }) });
      const input = area.locator('input.semi-upload-hidden-input');
      if (await input.count() !== 1 || await input.isDisabled()) throw new Error('publication_cover_chooser_unconfirmed');
      stage = 'upload';
      await input.setInputFiles({ name: image.name, mimeType: image.mimeType, buffer: image.buffer });
      stage = 'confirm';
      const done = dialog.getByRole('button', { name: '完成', exact: true }).and(page.locator(':visible'));
      await done.click({ timeout: 120000 });
      // Douyin can recommend the other orientation after saving the current one.
      // Decline only this optional prompt; requested second covers are applied separately.
      const offer = page.getByRole('dialog').filter({ has: page.getByText(/^设置[横竖]封面获更多流量$/, { exact: true }) }).and(page.locator(':visible'));
      for (let attempt = 0; attempt < 60 && await dialog.isVisible(); attempt++) {
        if (await offer.count() === 1 && await offer.isVisible()) {
          await offer.getByRole('button', { name: '暂不设置', exact: true }).click({ timeout: 10000 });
        }
        if (await dialog.isVisible()) await page.waitForTimeout(500);
      }
      await dialog.waitFor({ state: 'hidden', timeout: 1000 });
      stage = 'verify_preview';
      let after: string[] = [];
      for (let attempt = 0; attempt < 60; attempt++) {
        after = await douyinCoverPreview(control);
        if (after.length && JSON.stringify(after) !== JSON.stringify(before)) break;
        await page.waitForTimeout(500);
      }
      if (!after.length || JSON.stringify(after) === JSON.stringify(before)) throw new Error('publication_cover_not_applied');
      completed.push({ orientation, previews: after });
      for (const previous of completed) {
        if (JSON.stringify(await douyinCoverPreview(douyinCoverControl(page, previous.orientation))) !== JSON.stringify(previous.previews))
          throw new Error('publication_cover_previous_orientation_changed');
      }
      urls[orientation] = image.url;
      evidence[orientation] = { sha256: image.sha256, bytes: image.buffer.length, previewChanged: true, dialogConfirmed: true };
      emit?.('已应用并核对' + (orientation === 'vertical' ? '竖版3:4' : '横版4:3') + '自定义封面');
    } catch (error) {
      const code = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'publication_cover_' + stage + '_failed';
      throw new DouyinCoverError(code, orientation, stage);
    }
  }
  return { urls, evidence };
}
