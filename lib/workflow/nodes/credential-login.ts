import type { Page } from 'playwright';
import type { CredentialLoginParams, NodeResult, WorkflowContext } from '../types';
import { captureScreenshot } from '../utils';
import { getPlatformSessionCookie } from '@/lib/analysis/platform-session';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://okkgchwzppghiyfgmrlj.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ra2djaHd6cHBnaGl5ZmdtcmxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0OTY1NDA1MCwiZXhwIjoyMDY1MjMwMDUwfQ.tyKEsDr9lq2WtowiN0lBwKU2sxkKdRk6phBswiK88rE';

function cookieDomain(platform: 'douyin' | 'xhs' | 'gemini'): string {
  if (platform === 'xhs') return '.xiaohongshu.com';
  if (platform === 'gemini') return '.google.com';
  return '.douyin.com';
}

function parseCookieStr(cookieStr: string, domain: string): import('playwright').Cookie[] {
  return cookieStr
    .split(';')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const idx = item.indexOf('=');
      if (idx <= 0) return null;
      return {
        name: item.slice(0, idx).trim(),
        value: item.slice(idx + 1).trim(),
        domain,
        path: '/',
        secure: true,
        sameSite: 'None' as const,
      };
    })
    .filter((item): item is import('playwright').Cookie => !!item?.name && !!item?.value);
}

async function fetchCookieStr(platform: 'douyin' | 'xhs' | 'gemini', credentialId: string): Promise<string | null> {
  if (platform === 'xhs' || platform === 'gemini') {
    return getPlatformSessionCookie(platform, credentialId);
  }
  const filters = `client_id=eq.${encodeURIComponent(credentialId)}`;
  const url = `${SUPABASE_URL}/rest/v1/douyin_sessions?${filters}&select=cookie_str&limit=1`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase 查询失败: ${res.status}`);
  const rows = await res.json() as Array<{ cookie_str?: string }>;
  return rows[0]?.cookie_str?.trim() || null;
}

export async function executeCredentialLogin(
  page: Page,
  params: CredentialLoginParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  const platform = params.platform ?? 'gemini';
  const credentialId = String(params.credentialId ?? '').trim();
  const strict = params.strict ?? false;
  const outputCookieVar = String(params.outputCookieVar ?? 'credentialCookieStr').trim() || 'credentialCookieStr';

  try {
    if (!credentialId) {
      const msg = `ℹ️ 未传凭证ID（platform=${platform}），跳过登录注入`;
      log.push(msg);
      ctx.emit?.('log', msg);
      return { success: true, log, output: { skipped: true } };
    }

    log.push(`🔐 凭证登录：platform=${platform} credentialId=${credentialId}`);
    ctx.emit?.('log', `🔐 凭证登录：platform=${platform} credentialId=${credentialId}`);

    const cookieStr = await fetchCookieStr(platform, credentialId);
    if (!cookieStr) {
      const msg = `⚠️ 未找到凭证 ${credentialId} 对应 Cookie（platform=${platform}）`;
      log.push(msg);
      ctx.emit?.('log', msg);
      if (strict) {
        return { success: false, log, error: msg };
      }
      return { success: true, log, output: { skipped: true, reason: 'credential_not_found' } };
    }

    const parsed = parseCookieStr(cookieStr, cookieDomain(platform));
    if (parsed.length === 0) {
      const msg = `⚠️ 凭证 ${credentialId} 的 Cookie 为空或不可解析`;
      log.push(msg);
      ctx.emit?.('log', msg);
      if (strict) {
        return { success: false, log, error: msg };
      }
      return { success: true, log, output: { skipped: true, reason: 'cookie_invalid' } };
    }

    await page.context().addCookies(parsed);
    ctx.vars[outputCookieVar] = cookieStr;
    const okMsg = `✅ 已注入 ${parsed.length} 条 Cookie 到浏览器上下文`;
    log.push(okMsg);
    ctx.emit?.('log', okMsg);

    const screenshot = await captureScreenshot(page).catch(() => undefined);
    return {
      success: true,
      log,
      screenshot,
      output: {
        platform,
        credentialId,
        cookieCount: parsed.length,
        [outputCookieVar]: cookieStr,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.push(`❌ 凭证登录失败: ${message}`);
    const screenshot = await captureScreenshot(page).catch(() => undefined);
    return { success: false, log, error: message, screenshot };
  }
}
