import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
export type XPostParams = { mode: 'prepare' | 'publish'; expectedUsername: string; text: string; requestId: string };
export type XReceipt = { published: true; postId: string; postUrl: string; username: string; moderation: 'creation_confirmed_visibility_unverified'; verificationSource: 'creation_response'; verifiedAt: string };
export type XRecord = { fingerprint: string; requestId: string; state: 'submitting' | 'published'; startedAt: string; receipt?: XReceipt };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const xText = (s: string) => s.replace(/\r\n?/g, '\n').normalize('NFC');
export function xIdentity(p: Omit<XPostParams, 'mode'>) {
  if (typeof p.expectedUsername !== 'string' || !/^@?[a-zA-Z0-9_]{1,15}$/.test(p.expectedUsername) ||
      typeof p.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(p.requestId) ||
      typeof p.text !== 'string' || !p.text.trim() || p.text !== p.text.trim() ||
      Buffer.byteLength(p.text) > 10000 || /\{\{|\}\}|\u0000/.test(p.text)) throw new Error('x_publication_input_invalid');
  const username = p.expectedUsername.replace(/^@/, '').toLowerCase(), text = xText(p.text);
  const fingerprint = hash(JSON.stringify([username, text]));
  return { username, text, fingerprint, key: fingerprint };
}
export function xCreationEndpoint(url: string) {
  try { const u = new URL(url); return u.origin === 'https://x.com' && /^\/i\/api\/graphql\/[A-Za-z0-9_-]+\/CreateTweet$/.test(u.pathname); }
  catch { return false; }
}
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
function responseText(legacy: Obj) {
  if (typeof legacy.full_text !== 'string') return '';
  let text = legacy.full_text;
  const urls = obj(legacy.entities).urls;
  if (Array.isArray(urls)) for (const value of urls) {
    const e = obj(value);
    if (typeof e.url === 'string' && /^https:\/\/t\.co\/[A-Za-z0-9]+$/.test(e.url) && typeof e.expanded_url === 'string') {
      text = text.split(e.url).join(e.expanded_url);
    }
  }
  return xText(text);
}
export function xCreationReceipt(url: string, method: string, status: number, body: unknown, expected: ReturnType<typeof xIdentity>): XReceipt | null {
  const root = obj(body);
  if (!xCreationEndpoint(url) || method !== 'POST' || status < 200 || status >= 300 || (root.errors !== undefined && (!Array.isArray(root.errors) || root.errors.length))) return null;
  const tweet = obj(obj(obj(obj(root.data).create_tweet).tweet_results).result), legacy = obj(tweet.legacy);
  const user = obj(obj(obj(tweet.core).user_results).result);
  const username = String(obj(user.core).screen_name || obj(user.legacy).screen_name || '').toLowerCase();
  const id = tweet.rest_id;
  if (typeof id !== 'string' || !/^\d{6,30}$/.test(id) || username !== expected.username ||
      typeof legacy.full_text !== 'string' || responseText(legacy) !== expected.text ||
      legacy.in_reply_to_status_id_str || legacy.is_quote_status === true ||
      obj(legacy.extended_entities).media || obj(legacy.entities).media || tweet.note_tweet) return null;
  return { published: true, postId: id, postUrl: 'https://x.com/'+username+'/status/'+id, username,
    moderation: 'creation_confirmed_visibility_unverified', verificationSource: 'creation_response', verifiedAt: new Date().toISOString() };
}
function filename(dir: string, key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('x_publication_key_invalid');
  return path.join(dir, key + '.json');
}
async function syncDirectory(dir: string) { const f = await open(dir, 'r'); try { await f.sync(); } finally { await f.close(); } }
export async function xRecord(dir: string, key: string, fingerprint: string): Promise<XRecord | null> {
  let r: XRecord;
  try { r = JSON.parse(await readFile(filename(dir, key), 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('x_publication_record_unreadable'); }
  if (r.fingerprint !== fingerprint || !['submitting', 'published'].includes(r.state)) throw new Error('x_publication_record_invalid');
  if (r.state === 'published' && (!r.receipt?.published || !/^\d{6,30}$/.test(r.receipt.postId))) throw new Error('x_publication_record_invalid');
  return r;
}
export async function reserveX(dir: string, key: string, fingerprint: string, requestId: string) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const f = await open(filename(dir, key), 'wx', 0o600).catch(() => { throw new Error('x_publication_already_reserved_check_status'); });
  try { await f.writeFile(JSON.stringify({ fingerprint, requestId, state: 'submitting', startedAt: new Date().toISOString() })); await f.sync(); }
  finally { await f.close(); }
  await syncDirectory(dir);
}
export async function finishX(dir: string, key: string, fingerprint: string, requestId: string, receipt: XReceipt) {
  const r = await xRecord(dir, key, fingerprint);
  if (!r || r.state !== 'submitting' || r.requestId !== requestId) throw new Error('x_publication_reservation_mismatch');
  const target = filename(dir, key), temp = target + '.' + randomUUID() + '.tmp';
  try {
    const f = await open(temp, 'wx', 0o600);
    try { await f.writeFile(JSON.stringify({ ...r, state: 'published', receipt })); await f.sync(); } finally { await f.close(); }
    await rename(temp, target); await syncDirectory(dir);
  } finally { await unlink(temp).catch(() => {}); }
}
