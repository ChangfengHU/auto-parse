import type { Page } from 'playwright';

export type DouyinCover = { verticalUrl?: string; horizontalUrl?: string };

export function validateCoverUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['resource.vyibc.com', 'cdn.vyibc.com'].includes(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash ||
      !/\.(png|jpe?g)$/i.test(url.pathname)) throw new Error('publication_cover_url_invalid');
  return url.href;
}

export async function fillDouyinCovers(page: Page, cover: DouyinCover) {
  const results: Record<string, string> = {};
  for (const [orientation, value] of [['vertical', cover.verticalUrl], ['horizontal', cover.horizontalUrl]] as const) {
    if (!value) continue;
    const url = validateCoverUrl(value);
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok || Number(response.headers.get('content-length')) > 8 * 1024 * 1024) throw new Error('publication_cover_download_failed');
    const parts: Uint8Array[] = [];
    let size = 0;
    if (!response.body) throw new Error('publication_cover_download_failed');
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8 * 1024 * 1024) throw new Error('publication_cover_too_large');
        parts.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const buffer = Buffer.concat(parts);
    const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
    const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!jpeg && !png) throw new Error('publication_cover_format_invalid');
    const label = orientation === 'vertical' ? '竖封面3:4' : '横封面4:3';
    const control = page.getByText(label, { exact: true }).locator('..');
    if (await control.count() !== 1) throw new Error('publication_cover_control_unconfirmed');
    await page.getByText(/^(选择封面|修改封面)$/).nth(orientation === 'vertical' ? 0 : 1).click();
    const upload = page.getByText('上传封面', { exact: true });
    await upload.waitFor({ state: 'visible', timeout: 30000 });
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 10000 }).catch(() => null);
    await upload.click();
    const chooser = await chooserPromise;
    if (!chooser) throw new Error('publication_cover_chooser_unconfirmed');
    await chooser.setFiles({ name: jpeg ? 'cover.jpg' : 'cover.png', mimeType: jpeg ? 'image/jpeg' : 'image/png', buffer });
    const done = page.getByRole('button', { name: '完成', exact: true });
    await done.click({ timeout: 30000 });
    await done.waitFor({ state: 'hidden', timeout: 30000 });
    if (!await control.locator('..').locator('img').count()) throw new Error('publication_cover_not_applied');
    results[orientation] = url;
  }
  return results;
}
