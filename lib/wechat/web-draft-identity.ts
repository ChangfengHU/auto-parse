/** Exact cross-surface candidate matching; this does not authorize or perform publication. */
export type OfficialNewspic = { title: string; createdAt: number; thumbUrl: string };
export type WebDraftCard = { title: string; create_time: number | string; img_url: string; app_id: number | string; file_id: number | string };
function positiveInt(value: number | string, allowZero = false): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || (allowZero ? n < 0 : n <= 0)) throw Error('wechat_web_invalid_internal_id');
  return n;
}
function imageKey(value: string): string {
  let u: URL;
  try { u = new URL(value); } catch { throw Error('wechat_web_invalid_cover'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port || !['mmbiz.qpic.cn', 'mmbiz.qlogo.cn'].includes(u.hostname) || u.pathname === '/')
    throw Error('wechat_web_invalid_cover');
  // These strings are compared only, never fetched; the official API may use http while the UI uses https.
  return u.pathname;
}
function matchWebDraft(official: OfficialNewspic, cards: WebDraftCard[], complete: boolean, kind: 'newspic' | 'news') {
  if (complete !== true) throw Error('wechat_web_incomplete_draft_scan');
  if (!official.title || Array.from(official.title).length > (kind === 'news' ? 32 : 20)) throw Error(kind === 'news' ? 'wechat_web_invalid_news_title' : 'wechat_web_invalid_newspic_title');
  if (!Number.isSafeInteger(official.createdAt) || official.createdAt <= 0) throw Error('wechat_web_invalid_create_time');
  const cover = imageKey(official.thumbUrl);
  const matches = cards.filter(card => {
    if (card.title !== official.title || Number(card.create_time) !== official.createdAt) return false;
    try { return imageKey(card.img_url) === cover; } catch { return false; }
  });
  if (matches.length === 0) throw Error('wechat_web_draft_not_matched');
  if (matches.length !== 1) throw Error('wechat_web_draft_ambiguous');
  return { appId: positiveInt(matches[0].app_id), fileId: positiveInt(matches[0].file_id, true) };
}

export function matchWebNewspic(official: OfficialNewspic, cards: WebDraftCard[], complete: boolean) { return matchWebDraft(official, cards, complete, 'newspic'); }
export function matchWebArticle(official: OfficialNewspic, cards: WebDraftCard[], complete: boolean) { return matchWebDraft(official, cards, complete, 'news'); }
