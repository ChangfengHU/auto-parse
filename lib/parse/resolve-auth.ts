import fs from 'fs';
import path from 'path';
import type { ParseAuthConfig } from './types';
import { DEFAULT_PARSE_AUTH_CONFIG } from './types';

const COOKIE_FILE = path.join(process.cwd(), '.douyin-cookie.json');

function cookieFromFile(): string {
  try {
    if (!fs.existsSync(COOKIE_FILE)) return '';
    const data = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
    if (typeof data.cookie === 'string' && data.cookie.includes('sessionid')) return data.cookie;
    if (Array.isArray(data.cookies) && data.cookies.length > 0) {
      return data.cookies.map((c: { name: string; value: string }) => `${c.name}=${c.value}`).join('; ');
    }
  } catch { /* ignore */ }
  return process.env.DOUYIN_COOKIE || '';
}

export function getPlatformDouyinCookie(): string {
  return cookieFromFile();
}

export function hasValidDouyinCookie(cookieStr: string): boolean {
  return /(?:^|;\s*)sessionid(?:_ss)?=/.test(cookieStr);
}

async function fetchCookieByClientId(clientId: string): Promise<string> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('服务端未配置 Supabase，无法通过插件凭证获取登录信息');
  }

  const res = await fetch(
    `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/douyin_sessions?client_id=eq.${encodeURIComponent(clientId)}&select=cookie_str,updated_at&limit=1`,
    {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    }
  );
  if (!res.ok) throw new Error(`查询插件凭证失败 HTTP ${res.status}`);

  const rows = (await res.json()) as Array<{ cookie_str?: string }>;
  const cookieStr = rows[0]?.cookie_str?.trim();
  if (!cookieStr || !hasValidDouyinCookie(cookieStr)) {
    throw new Error('未找到有效登录信息，请确认插件已同步或凭证是否正确');
  }
  return cookieStr;
}

export function mergeParseAuthConfig(partial?: Partial<ParseAuthConfig>): ParseAuthConfig {
  return {
    ...DEFAULT_PARSE_AUTH_CONFIG,
    ...partial,
    mode: partial?.mode === 'custom' ? 'custom' : 'platform',
    type: partial?.type === 'credential' ? 'credential' : 'cookie',
  };
}

/** 解析本次请求应使用的抖音 Cookie；platform 模式返回 null 表示走服务端默认 */
export async function resolveDouyinCookieForParse(
  auth?: Partial<ParseAuthConfig>
): Promise<{ cookieStr: string | null; source: 'platform' | 'custom_cookie' | 'custom_credential' }> {
  const merged = mergeParseAuthConfig(auth);

  if (merged.mode === 'platform') {
    const platform = getPlatformDouyinCookie();
    return {
      cookieStr: platform || null,
      source: 'platform',
    };
  }

  if (merged.type === 'credential') {
    const clientId = merged.clientId.trim();
    if (!clientId) throw new Error('请填写插件凭证 dy_xxxxxxxx');
    const cookieStr = await fetchCookieByClientId(clientId);
    return { cookieStr, source: 'custom_credential' };
  }

  const cookieStr = merged.cookieStr.trim();
  if (!cookieStr) throw new Error('请粘贴抖音 Cookie（需包含 sessionid）');
  if (!hasValidDouyinCookie(cookieStr)) {
    throw new Error('Cookie 中未找到 sessionid，请确认复制完整');
  }
  return { cookieStr, source: 'custom_cookie' };
}
