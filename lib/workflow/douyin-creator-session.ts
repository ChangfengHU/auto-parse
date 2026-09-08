import type { Page } from 'playwright';

export class DouyinCredentialError extends Error {
  constructor(readonly code: string) { super(code); }
}

// This check runs in auto-parse's executing browser after credential injection.
export async function verifyDouyinCreator(page: Page, expectedAccountId: string) {
  const origin = 'https://creator.douyin.com';
  await page.goto(origin + '/creator-micro/content/upload', {
    waitUntil: 'domcontentloaded', timeout: 30_000,
  }).catch(() => { throw new DouyinCredentialError('creator_page_unreachable'); });
  const url = new URL(page.url());
  if (url.origin !== origin || /\/login|passport|qrcode/.test(url.pathname)) {
    throw new DouyinCredentialError('creator_login_required');
  }
  const account = await page.evaluate(async () => {
    try {
      const response = await fetch('/web/api/media/user/info/', {
        credentials: 'include', signal: AbortSignal.timeout(8_000),
      });
      if (response.status === 401) return { code: 'creator_login_required' };
      if (response.status === 403) return { code: 'creator_access_denied' };
      if (!response.ok) return { code: 'creator_api_unavailable' };
      const data = await response.json();
      if (data.status_code !== 0) return { code: 'creator_login_required' };
      const accountId = String(data.user?.uid || '');
      if (!/^\d{5,30}$/.test(accountId)) return { code: 'creator_response_invalid' };
      return { accountId, nickname: String(data.user?.nickname || '').slice(0, 100) };
    } catch { return { code: 'creator_api_unavailable' }; }
  }).catch(() => { throw new DouyinCredentialError('creator_api_unavailable'); });
  if (account.code) throw new DouyinCredentialError(account.code);
  if (account.accountId !== expectedAccountId) throw new DouyinCredentialError('creator_account_mismatch');
  await page.locator('input[type="file"][accept*="video"]').first()
    .waitFor({ state: 'attached', timeout: 15_000 })
    .catch(() => { throw new DouyinCredentialError('creator_upload_unavailable'); });
  return {
    accountId: account.accountId, nickname: account.nickname,
    creatorVerified: true, verifiedAt: new Date().toISOString(),
  };
}
