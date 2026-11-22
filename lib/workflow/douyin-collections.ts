import { chromium } from 'playwright';
import { acquireManagedBrowserActivity } from './browser-activity';
import { parseCreationBody } from './douyin-publication-ledger';

const CREATOR = 'https://creator.douyin.com';
const CDP = 'http://127.0.0.1:9223';

function normalizeCollection(row: Record<string, unknown>) {
  const info = row.mix_info && typeof row.mix_info === 'object'
    ? row.mix_info as Record<string, unknown>
    : row;
  const id = typeof info.mix_id === 'string' || Number.isSafeInteger(info.mix_id)
    ? String(info.mix_id)
    : null;
  const name = typeof info.mix_name === 'string' ? info.mix_name : null;
  if (!id || !/^\d+$/.test(id) || !name?.trim()) {
    throw Error('douyin_collection_row_unrecognized');
  }
  const count = info.aweme_count;
  return {
    collectionId: id,
    name,
    description: typeof info.desc === 'string' ? info.desc : null,
    workCount: typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null,
  };
}

export async function listDouyinCollections(accountId: string) {
  if (!/^\d{5,30}$/.test(accountId)) throw Error('douyin_collection_account_invalid');
  const release = await acquireManagedBrowserActivity(CDP, '/run/linux-browser-vnc', 10);
  let browser;
  let page;
  try {
    browser = await chromium.connectOverCDP(CDP, { timeout: 10000 });
    page = await browser.contexts()[0].newPage();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(CREATOR + '/creator-micro/content/manage', {
      waitUntil: 'domcontentloaded',
      timeout: 25000,
    });
    if (new URL(page.url()).origin !== CREATOR) throw Error('douyin_creator_login_required');
    const uid = await page.evaluate(async () => {
      const response = await fetch('/web/api/media/user/info/', {
        credentials: 'include',
        signal: AbortSignal.timeout(10000),
      });
      const body = await response.json();
      return response.ok && body.status_code === 0 ? String(body.user?.uid || '') : '';
    }).catch(() => '');
    if (!uid) throw Error('douyin_creator_login_unverified');
    if (uid !== accountId) throw Error('creator_account_mismatch');

    const tab = page.getByText('作品合集', { exact: true });
    await tab.waitFor({ timeout: 15000 }).catch(() => { throw Error('douyin_collection_tab_unavailable'); });
    // Observe the creator page's own list response triggered by the read-only tab.
    const response = page.waitForResponse(r => {
      const url = new URL(r.url());
      return url.origin === CREATOR && url.pathname === '/web/api/mix/list/' &&
        r.request().method() === 'GET' && url.searchParams.get('cursor') === '0' &&
        url.searchParams.get('count') === '10' && url.searchParams.get('status') === '0,1,2,3,6';
    }, { timeout: 20000 }).catch(() => null);
    await tab.click({ timeout: 8000 });
    const result = await response;
    const body = result?.ok() ? parseCreationBody(await result.text()) : null;
    if (!body || body.status_code !== 0 || !Array.isArray(body.mix_list) || typeof body.has_more !== 'boolean') {
      throw Error('douyin_collection_list_unavailable');
    }
    const items = body.mix_list.map(row => {
      if (!row || typeof row !== 'object') throw Error('douyin_collection_row_unrecognized');
      return normalizeCollection(row as Record<string, unknown>);
    });
    const total = typeof body.total === 'number' && Number.isSafeInteger(body.total) && body.total >= 0
      ? body.total
      : null;
    return {
      accountId, items, total,
      complete: !body.has_more && (total === null || items.length === total),
      hasMore: body.has_more,
      source: 'creator_collection_list',
      observedAt: new Date().toISOString(),
    };
  } finally {
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await release();
  }
}
