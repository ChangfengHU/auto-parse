import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export type XhsReceipt = { published: true; noteId: string; noteUrl: string; moderation: string; verificationSource: 'creation_response' | 'creator_note_list'; verifiedAt: string };
type RecordData = { fingerprint: string; requestId: string; state: 'submitting' | 'published'; receipt?: XhsReceipt };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function xhsPublicationIdentity(p: { requestId: string; expectedAccountId: string; videoUrl: string; title: string; description: string; aiGenerated: boolean }) {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(p.requestId) || !/^\d{5,30}$/.test(p.expectedAccountId) ||
      !p.title.trim() || [...p.title].length > 20 || p.description.length > 1000 || typeof p.aiGenerated !== 'boolean') throw new Error('xhs_publication_input_invalid');
  const u = new URL(p.videoUrl);
  if (u.protocol !== 'https:' || !['resource.vyibc.com', 'cdn.vyibc.com'].includes(u.hostname) ||
      u.username || u.password || u.port || u.search || u.hash || !u.pathname.endsWith('.mp4')) throw new Error('xhs_publication_video_url_invalid');
  // Deliberately content-scoped: changing requestId cannot blindly publish the same source again.
  return { key: hash(p.expectedAccountId + ':' + u.href), fingerprint: hash(JSON.stringify([p.expectedAccountId,u.href,p.title,p.description,p.aiGenerated])) };
}
export function xhsCreationEndpoint(url: string) {
  const u = new URL(url);
  return ['https://creator.xiaohongshu.com', 'https://www.xiaohongshu.com', 'https://edith.xiaohongshu.com'].includes(u.origin) &&
    ['/web_api/sns/v2/note', '/fe_api/burdock/v2/note/post'].includes(u.pathname);
}
export function xhsCreationReceipt(url: string, method: string, status: number, body: Record<string, unknown>): XhsReceipt | null {
  // The real creator endpoint returns {success:true,data:{id,score}} without code.
  const accepted = body.code === 0 || (body.code === undefined && body.success === true);
  if (!xhsCreationEndpoint(url) || method !== 'POST' || status < 200 || status >= 300 || !accepted || body.success === false) return null;
  const data = body.data as Record<string, unknown> | undefined;
  const id = data?.noteId ?? data?.note_id ?? data?.id ?? body.note_id;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) return null;
  return { published: true, noteId: id, noteUrl: 'https://www.xiaohongshu.com/explore/' + id, moderation: 'pending_or_unknown', verificationSource: 'creation_response', verifiedAt: new Date().toISOString() };
}
function filename(dir: string, key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('xhs_publication_key_invalid');
  return path.join(dir, key + '.json');
}
/** Reconcile an uncertain submit from the creator's native list; never from a toast/title alone. */
export function xhsCreatorListReceipt(body: Record<string, unknown>, expected: {
  title: string; accountId: string; observedAccountId: string; startedAt: number; finishedAt: number; durationSeconds: number; publishedTab: boolean;
}): XhsReceipt | null {
  const data = body.data as {notes?: Array<Record<string, unknown>>} | undefined;
  if (body.code !== 0 || body.success !== true || !expected.accountId || expected.accountId !== expected.observedAccountId ||
      !Array.isArray(data?.notes) || !Number.isFinite(expected.startedAt) || !Number.isFinite(expected.finishedAt) ||
      expected.finishedAt < expected.startedAt || !(expected.durationSeconds > 0)) return null;
  const matches = data.notes.filter(note => {
    const time = Number(note.visible_time) * 1000, duration = Number((note.video_info as {duration?: number})?.duration);
    return note.display_title === expected.title && typeof note.id === 'string' && /^[a-f0-9]{24}$/.test(note.id) &&
      note.type === 'video' && note.permission_code === 0 && note.schedule_post_time === 0 &&
      Number.isFinite(time) && time >= expected.startedAt - 5000 && time <= expected.finishedAt + 60000 &&
      Number.isFinite(duration) && Math.abs(duration - expected.durationSeconds) <= 1;
  });
  if (matches.length !== 1) return null;
  const id = String(matches[0].id);
  return { published: true, noteId: id, noteUrl: 'https://www.xiaohongshu.com/explore/' + id,
    moderation: expected.publishedTab ? 'published_list_visible' : 'creator_list_visible', verificationSource: 'creator_note_list', verifiedAt: new Date().toISOString() };
}
export async function readXhsPublication(dir: string, key: string, fingerprint: string): Promise<RecordData | null> {
  let record: RecordData;
  try { record = JSON.parse(await readFile(filename(dir,key),'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('xhs_publication_record_unreadable'); }
  if (record.fingerprint !== fingerprint) throw new Error('xhs_source_already_used_with_different_metadata');
  if (record.state !== 'published' || !record.receipt?.published || !/^[a-f0-9]{24}$/.test(record.receipt.noteId)) throw new Error('xhs_submission_unknown_do_not_retry');
  return record;
}
async function syncDirectory(dir: string) { const f = await open(dir,'r'); try { await f.sync(); } finally { await f.close(); } }
export async function reserveXhsPublication(dir: string, key: string, fingerprint: string, requestId: string) {
  await mkdir(dir,{recursive:true,mode:0o700});
  const f = await open(filename(dir,key),'wx',0o600).catch(() => { throw new Error('xhs_publication_already_reserved'); });
  try { await f.writeFile(JSON.stringify({fingerprint,requestId,state:'submitting'})); await f.sync(); } finally { await f.close(); }
  await syncDirectory(dir);
}
export async function finishXhsPublication(dir: string, key: string, fingerprint: string, requestId: string, receipt: XhsReceipt) {
  const target = filename(dir,key), temp = target + '.' + randomUUID() + '.tmp';
  const previous: RecordData = JSON.parse(await readFile(target,'utf8'));
  if (previous.fingerprint !== fingerprint || previous.requestId !== requestId || previous.state !== 'submitting') throw new Error('xhs_publication_reservation_mismatch');
  try {
    const f = await open(temp,'wx',0o600);
    try { await f.writeFile(JSON.stringify({fingerprint,requestId,state:'published',receipt})); await f.sync(); } finally { await f.close(); }
    await rename(temp,target); await syncDirectory(dir);
  } finally { await unlink(temp).catch(() => {}); }
}
