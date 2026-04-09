const SUPABASE_URL = process.env.SUPABASE_URL || 'https://okkgchwzppghiyfgmrlj.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ra2djaHd6cHBnaGl5ZmdtcmxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0OTY1NDA1MCwiZXhwIjoyMDY1MjMwMDUwfQ.tyKEsDr9lq2WtowiN0lBwKU2sxkKdRk6phBswiK88rE';

export type PlatformName = 'xhs' | 'gemini';
const TABLE = 'douyin_sessions';

function headers(extra?: Record<string, string>) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export async function upsertPlatformSession(platform: PlatformName, clientId: string, cookieStr: string) {
  const p = platform.trim() as PlatformName;
  const c = clientId.trim();
  const cookie = cookieStr.trim();
  if (!p || !c || !cookie) throw new Error('platform/clientId/cookie 不能为空');

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=client_id`, {
    method: 'POST',
    headers: headers({ Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify({
      client_id: c,
      cookie_str: cookie,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    throw new Error(`写入 platform_sessions 失败: ${res.status}`);
  }
}

export async function getPlatformSessionCookie(platform: PlatformName, clientId: string): Promise<string | null> {
  const p = platform.trim() as PlatformName;
  const c = clientId.trim();
  if (!p || !c) return null;
  const q = `client_id=eq.${encodeURIComponent(c)}&select=cookie_str&limit=1`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?${q}`, { headers: headers() });
  if (!res.ok) {
    throw new Error(`读取 ${TABLE} 失败: ${res.status}`);
  }
  const rows = await res.json() as Array<{ cookie_str?: string }>;
  return rows[0]?.cookie_str?.trim() || null;
}
