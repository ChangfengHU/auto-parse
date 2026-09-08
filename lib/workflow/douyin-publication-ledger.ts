import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type PublicationReceipt = {
  awemeId: string; videoUrl: string; moderation: string;
  verificationSource?: 'creation_response' | 'creator_work_list';
  verifiedAt?: string;
};
export type PublicationRecord = {
  fingerprint: string; state: 'submitting' | 'published'; receipt?: PublicationReceipt;
};

export function publicationReceipt(url: string, method: string, status: number, body: Record<string, unknown>): PublicationReceipt | null {
  const u = new URL(url);
  if (u.origin !== 'https://creator.douyin.com' || method !== 'POST' || status < 200 || status >= 300 ||
      !/^\/web\/api\/media\/aweme\/create(?:_v2)?\/?$/.test(u.pathname) || body.status_code !== 0) return null;
  const rawId = body.aweme_id || body.item_id || (body.aweme as Record<string, unknown>)?.aweme_id ||
    (body.aweme_info as Record<string, unknown>)?.aweme_id || (body.data as Record<string, unknown>)?.aweme_id || '';
  if (typeof rawId !== 'string' && !(typeof rawId === 'number' && Number.isSafeInteger(rawId))) return null;
  const id = String(rawId);
  return /^\d{10,30}$/.test(id)
    ? { awemeId: id, videoUrl: 'https://www.douyin.com/video/' + id, moderation: 'pending_or_unknown' } : null;
}

/** Preserve long provider IDs before JSON's number conversion loses precision. */
export function parseCreationBody(text: string): Record<string, unknown> {
  return JSON.parse(text.replace(/("(?:aweme_id|item_id)"\s*:\s*)(\d{16,30})(?=\s*[,}])/g, '$1"$2"'));
}

/** Read-back proof is separate from a create response; never infer from a toast. */
export function creatorListReceipt(body: Record<string, unknown>, expected: {
  awemeId: string; accountId: string; title: string; startedAt: number; completedAt: number;
}): PublicationReceipt | null {
  if (body.status_code !== 0 || !Array.isArray(body.aweme_list) || !/^\d{10,30}$/.test(expected.awemeId)) return null;
  const matches = body.aweme_list.filter(item => item?.aweme_id === expected.awemeId);
  if (matches.length !== 1) return null;
  const item = matches[0];
  const created = Number(item.create_time) * 1000;
  if (String(item.author?.uid || '') !== expected.accountId ||
      typeof item.desc !== 'string' || !item.desc.includes(expected.title) ||
      !Number.isFinite(created) || created < expected.startedAt - 5000 || created > expected.completedAt + 60000 ||
      !(Number(item.duration) > 0) || item.status?.is_delete === true || item.status?.is_prohibited === true) return null;
  return { awemeId: expected.awemeId, videoUrl: 'https://www.douyin.com/video/' + expected.awemeId,
    moderation: item.status?.in_reviewing ? 'reviewing' : 'creator_list_visible',
    verificationSource: 'creator_work_list', verifiedAt: new Date().toISOString() };
}

export function publicationIdentity(requestId: string, accountId: string, videoUrl: string, title: string, aiGenerated = false,
  metadata?: { description?: string; topics?: string[]; cover?: { verticalUrl?: string; horizontalUrl?: string } }) {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId) || !/^\d{5,30}$/.test(accountId) ||
      !title.trim() || [...title].length > 30) throw new Error('publication_input_invalid');
  const u = new URL(videoUrl);
  if (u.protocol !== 'https:' || !['resource.vyibc.com', 'cdn.vyibc.com'].includes(u.hostname) ||
      u.username || u.password || u.port || u.search || u.hash || !u.pathname.endsWith('.mp4')) {
    throw new Error('publication_video_url_invalid');
  }
  const payload: unknown[] = [accountId, u.href, title, aiGenerated];
  if (metadata?.description !== undefined || metadata?.topics !== undefined || metadata?.cover !== undefined) {
    payload.push({ description: metadata.description ?? '', topics: metadata.topics ?? [], cover: metadata.cover ?? null });
  }
  return {
    key: createHash('sha256').update(accountId + ':' + requestId).digest('hex'),
    fingerprint: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
  };
}

export async function readPublication(directory: string, key: string, fingerprint: string): Promise<PublicationRecord | null> {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('publication_key_invalid');
  let record: PublicationRecord;
  try { record = JSON.parse(await readFile(path.join(directory, key + '.json'), 'utf8')); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('publication_record_unreadable');
  }
  if (record.fingerprint !== fingerprint) throw new Error('publication_request_conflict');
  if (record.state !== 'published' || !record.receipt || !/^\d{10,30}$/.test(record.receipt.awemeId)) {
    throw new Error('submission_unknown_do_not_retry');
  }
  return record;
}

export async function reservePublication(directory: string, key: string, fingerprint: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('publication_key_invalid');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = await open(path.join(directory, key + '.json'), 'wx', 0o600)
    .catch(() => { throw new Error('publication_already_reserved'); });
  try { await file.writeFile(JSON.stringify({ fingerprint, state: 'submitting' })); await file.sync(); }
  finally { await file.close(); }
  const parent = await open(directory, 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}

export async function finishPublication(directory: string, key: string, fingerprint: string, receipt: PublicationReceipt) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('publication_key_invalid');
  const temp = path.join(directory, key + '.' + randomUUID() + '.tmp');
  try {
    await writeFile(temp, JSON.stringify({ fingerprint, state: 'published', receipt }), { mode: 0o600, flag: 'wx' });
    await rename(temp, path.join(directory, key + '.json'));
  } finally { await unlink(temp).catch(() => {}); }
}
