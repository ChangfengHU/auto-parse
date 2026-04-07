import {
  getXhsCommentsByCli,
  getXhsFeedByCli,
  getXhsUnreadByCli,
  getXhsUserPostsByCli,
  getXhsUserProfileByCli,
  searchXhsNotesByCli,
} from '@/lib/analysis/xhs-cli-bridge';
import { getRuntimeBackendConfig, type RuntimeBackendConfig } from '@/lib/runtime/backend-config';

function parseJsonResponse<T>(payload: unknown): T {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('XHS HTTP API 返回格式异常');
  }

  const data = payload as { success?: boolean; ok?: boolean; data?: T; error?: string; detail?: string };
  if (data.success === false || data.ok === false) {
    throw new Error(data.error || data.detail || 'XHS HTTP API 执行失败');
  }

  if ('data' in data) {
    return data.data as T;
  }

  return payload as T;
}

async function callXhsHttpApi<T>(
  cookie: string,
  path: string,
  init?: Omit<RequestInit, 'headers'>
): Promise<T> {
  const runtimeConfig = await getRuntimeBackendConfig();
  const baseUrl = runtimeConfig.xhs.httpBaseUrl;
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'X-XHS-Cookie': cookie,
      'Accept': 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
    cache: 'no-store',
    signal: init?.signal ?? AbortSignal.timeout(runtimeConfig.xhs.timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`XHS HTTP API returned ${res.status}`);
  }

  const payload = (await res.json()) as unknown;
  return parseJsonResponse<T>(payload);
}

export async function getXhsBackendConfigForRuntime(): Promise<RuntimeBackendConfig['xhs']> {
  const config = await getRuntimeBackendConfig();
  return config.xhs;
}

export async function getXhsUserProfile(cookie: string, userId: string) {
  const config = await getRuntimeBackendConfig();
  if (config.xhs.source === 'http') {
    return callXhsHttpApi<Record<string, unknown>>(cookie, `/user/${encodeURIComponent(userId)}`);
  }
  return getXhsUserProfileByCli(cookie, userId);
}

export async function getXhsUserPosts(cookie: string, userId: string, cursor = '') {
  const config = await getRuntimeBackendConfig();
  if (config.xhs.source === 'http') {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    const query = params.toString();
    return callXhsHttpApi<Record<string, unknown>>(
      cookie,
      `/user/${encodeURIComponent(userId)}/notes${query ? `?${query}` : ''}`
    );
  }
  return getXhsUserPostsByCli(cookie, userId, cursor);
}

export async function getXhsFeed(cookie: string) {
  const config = await getRuntimeBackendConfig();
  if (config.xhs.source === 'http') {
    return callXhsHttpApi<Record<string, unknown>>(cookie, '/feed');
  }
  return getXhsFeedByCli(cookie);
}

export async function searchXhsNotes(cookie: string, keyword: string, page = 1) {
  const config = await getRuntimeBackendConfig();
  if (config.xhs.source === 'http') {
    const query = new URLSearchParams({
      keyword,
      page: String(page),
    });
    return callXhsHttpApi<Record<string, unknown>>(cookie, `/search?${query.toString()}`);
  }
  return searchXhsNotesByCli(cookie, keyword, page);
}

export async function getXhsComments(
  cookie: string,
  noteId: string,
  options?: { cursor?: string; xsecToken?: string }
) {
  const config = await getRuntimeBackendConfig();
  if (config.xhs.source === 'http') {
    const query = new URLSearchParams({ note_id: noteId });
    if (options?.cursor) query.set('cursor', options.cursor);
    if (options?.xsecToken) query.set('xsec_token', options.xsecToken);
    return callXhsHttpApi<Record<string, unknown>>(cookie, `/comments?${query.toString()}`);
  }
  return getXhsCommentsByCli(cookie, noteId, options);
}

export async function getXhsUnread(cookie: string) {
  const config = await getRuntimeBackendConfig();
  if (config.xhs.source === 'http') {
    return callXhsHttpApi<Record<string, unknown>>(cookie, '/unread');
  }
  return getXhsUnreadByCli(cookie);
}
