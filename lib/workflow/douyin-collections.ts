import { chromium, type Page } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireManagedBrowserActivity } from './browser-activity';

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

async function withCreatorPage<T>(accountId: string, run: (page: Page) => Promise<T>): Promise<T> {
  if (!/^\d{5,30}$/.test(accountId)) throw Error('douyin_collection_account_invalid');
  const release = await acquireManagedBrowserActivity(CDP, '/run/linux-browser-vnc', 10);
  let browser;
  let page;
  try {
    browser = await chromium.connectOverCDP(CDP, { timeout: 10000 });
    page = await browser.contexts()[0].newPage();
    await page.setViewportSize({ width: 1440, height: 1000 });
    return await run(page);
  } finally {
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await release();
  }
}

async function verifyAccount(page: Page, accountId: string) {
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
}

async function readCollections(page: Page, accountId: string) {
    await page.goto(CREATOR + '/creator-micro/content/manage', {
      waitUntil: 'domcontentloaded',
      timeout: 25000,
    });
    await verifyAccount(page, accountId);

    const tab = page.getByRole('button', { name: /^作品合集(?:\s*\(\d+\))?$/ });
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
    const body = result?.ok() ? JSON.parse((await result.text()).replace(/("mix_id"\s*:\s*)(\d+)(?=\s*[,}])/g, '$1"$2"')) as Record<string, unknown> : null;
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
}

export function listDouyinCollections(accountId: string) {
  return withCreatorPage(accountId, page => readCollections(page, accountId));
}

async function defaultCollectionCover(page: Page, name: string) {
  const base64 = await page.evaluate(title => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw Error('douyin_collection_cover_unavailable');
    ctx.fillStyle = '#14242d';
    ctx.fillRect(0, 0, 1080, 1080);
    ctx.fillStyle = '#b5e39f';
    ctx.fillRect(110, 160, 82, 12);
    ctx.font = '700 92px "Noto Sans CJK SC", sans-serif';
    ctx.fillStyle = '#fff';
    const characters = Array.from(title);
    for (let offset = 0; offset < characters.length; offset += 9) {
      ctx.fillText(characters.slice(offset, offset + 9).join(''), 110, 445 + offset / 9 * 115, 860);
    }
    ctx.font = '44px "Noto Sans CJK SC", sans-serif';
    ctx.fillStyle = '#b5e39f';
    ctx.fillText('作品合集', 110, 870);
    return canvas.toDataURL('image/png').split(',')[1];
  }, name);
  return Buffer.from(base64, 'base64');
}

export function createDouyinCollection(accountId: string, name: unknown, description: unknown, confirmed: unknown) {
  if (confirmed !== true) throw Error('douyin_collection_confirmation_required');
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 20 || /[\r\n]/.test(name)) {
    throw Error('douyin_collection_title_invalid');
  }
  if (description !== undefined && (typeof description !== 'string' || description.length > 200)) {
    throw Error('douyin_collection_description_invalid');
  }
  return withCreatorPage(accountId, async page => {
    const titleText = name.trim();
    const find = (list: Awaited<ReturnType<typeof readCollections>>) => {
      const matches = list.items.filter(item => item.name === titleText);
      if (matches.length > 1) throw Error('douyin_collection_title_ambiguous');
      return matches[0];
    };
    const before = await readCollections(page, accountId);
    const existing = find(before);
    if (existing) return { accountId, status: 'existing', collection: existing };
    if (!before.complete) throw Error('douyin_collection_list_incomplete');

    const directory = join(process.cwd(), '.data', 'douyin-collection-intents');
    const key = createHash('sha256').update(JSON.stringify([accountId, titleText])).digest('hex');
    const intent = join(directory, key + '.json');

    const create = page.getByRole('button', { name: '创建合集', exact: true });
    if (before.items.length === 0) {
      const custom = page.getByText('自定义创建合集', { exact: true });
      await custom.click({ timeout: 12000 });
    } else {
      await create.click({ timeout: 12000 });
    }
    await page.waitForURL(CREATOR + '/creator-micro/content/collection/create', { timeout: 8000 });
    await verifyAccount(page, accountId);
    const title = page.getByPlaceholder('请输入合集的标题', { exact: true });
    await title.fill(titleText, { timeout: 12000 });
    if (typeof description === 'string') {
      await page.getByPlaceholder('请输入合集的简介', { exact: true }).fill(description, { timeout: 8000 });
    }
    const cover = await defaultCollectionCover(page, titleText);
    await page.locator('input[type=file][name=upload-btn]').setInputFiles({
      name: 'collection-cover.png', mimeType: 'image/png', buffer: cover,
    }, { timeout: 8000 });
    const save = page.getByRole('button', { name: '保存', exact: true });
    await save.click({ timeout: 10000 });
    await save.waitFor({ state: 'hidden', timeout: 10000 });
    if (await title.inputValue() !== titleText) throw Error('douyin_collection_title_not_applied');

    const submit = page.getByRole('button', { name: '创建', exact: true });
    await submit.click({ trial: true, timeout: 8000 });
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(intent, JSON.stringify({ accountId, name: titleText, at: new Date().toISOString() }), {
        flag: 'wx', mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw Error('douyin_collection_create_unknown_check_list');
      }
      throw error;
    }
    try {
      await submit.click({ timeout: 8000 });
      await page.waitForURL(u => u.pathname === '/creator-micro/content/collection/manage', {
        timeout: 12000,
      }).catch(() => {});
      const created = find(await readCollections(page, accountId));
      if (!created) throw Error('douyin_collection_create_unknown_check_list');
      await unlink(intent).catch(() => {});
      return { accountId, status: 'created', collection: created, empty: true, verified: true };
    } catch {
      throw Error('douyin_collection_create_unknown_check_list');
    }
  });
}
