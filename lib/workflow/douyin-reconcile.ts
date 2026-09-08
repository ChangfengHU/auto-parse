import { chromium } from 'playwright';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { getTask, setTaskPublicationReceipt } from './task-store';
import { acquireRemoteDouyinBrowser } from './douyin-runtime';
import { creatorListReceipt, finishPublication, publicationIdentity } from './douyin-publication-ledger';
import type { ClickParams } from './types';

// This operation never uploads, edits or clicks publish. An exact work ID is required.
export async function reconcileDouyinTask(taskId: string, awemeId: string) {
  const task = getTask(taskId);
  if (!task || !task.completedAt || task.status === 'running') throw new Error('publication_task_not_terminal');
  const index = task.workflow.nodes.findIndex(n => n.type === 'click' && Boolean(n.params.douyinPublication));
  const params = (task.workflow.nodes[index]?.params as ClickParams)?.douyinPublication;
  if (!params || !task.steps[index]?.error?.includes('submission_unknown')) throw new Error('publication_not_uncertain');
  const identity = publicationIdentity(params.requestId, params.expectedAccountId, params.videoUrl, params.title, params.aiGenerated, params);
  const directory = path.join(process.cwd(), '.data', 'douyin-publications');
  const record = JSON.parse(await readFile(path.join(directory, identity.key + '.json'), 'utf8'));
  if (record.fingerprint !== identity.fingerprint) throw new Error('publication_request_conflict');
  if (record.state === 'published') {
    if (record.receipt?.awemeId !== awemeId) throw new Error('publication_receipt_conflict');
    setTaskPublicationReceipt(taskId, record.receipt);
    return record.receipt;
  }
  const navigation = task.workflow.nodes.find(n => n.type === 'navigate' && n.params.adsManualCdpUrl);
  const endpoint = String(navigation?.params.adsManualCdpUrl || '');
  if (endpoint !== 'http://127.0.0.1:9223') throw new Error('publication_browser_not_configured');
  const release = acquireRemoteDouyinBrowser(endpoint);
  const browser = await chromium.connectOverCDP(endpoint).catch(error => { release(); throw error; });
  let page;
  try {
    page = await browser.contexts()[0].newPage();
    const responsePromise = page.waitForResponse(r => new URL(r.url()).origin === 'https://creator.douyin.com' &&
      new URL(r.url()).pathname === '/janus/douyin/creator/pc/work_list' && r.request().method() === 'GET',
      { timeout: 30000 });
    // Attach rejection handling immediately even if navigation fails.
    const bodyPromise = responsePromise.then(async r => r.ok() ? r.json() : null).catch(() => null);
    await page.goto('https://creator.douyin.com/creator-micro/content/manage', { waitUntil: 'domcontentloaded' });
    const accountId = await page.evaluate(async () => {
      const r = await fetch('/web/api/media/user/info/', { credentials: 'include', signal: AbortSignal.timeout(8000) });
      const j = await r.json(); return r.ok && j.status_code === 0 ? String(j.user?.uid || '') : '';
    });
    if (accountId !== params.expectedAccountId) throw new Error('creator_account_mismatch');
    const body = await bodyPromise;
    const receipt = body && creatorListReceipt(body, {
      awemeId, accountId, title: params.title, startedAt: task.startedAt, completedAt: task.completedAt,
    });
    if (!receipt) throw new Error('publication_readback_not_confirmed');
    await finishPublication(directory, identity.key, identity.fingerprint, receipt);
    setTaskPublicationReceipt(taskId, receipt);
    return receipt;
  } finally {
    await page?.close().catch(() => {});
    await browser.close().catch(() => {});
    release();
  }
}
