/** Supabase REST API 连接配置（服务端读取 .env / .env.local） */
export function getSupabaseRestConfig() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  return { url, key };
}

export function assertSupabaseRestConfig() {
  const { url, key } = getSupabaseRestConfig();
  if (!url || !key) {
    throw new Error('未配置 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY（或 SUPABASE_ANON_KEY）');
  }
  return { url, key };
}

export async function parseSupabaseError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const json = JSON.parse(text) as { message?: string; code?: string };
    if (json.code === 'PGRST205') {
      return `Supabase 中不存在 douyin_sessions 表（当前项目：${res.url.split('/rest/')[0]}）。请检查 SUPABASE_URL 是否与插件/扫码登录写入的是同一个项目。`;
    }
    if (json.message) return `Supabase 错误: ${json.message}`;
  } catch { /* ignore */ }
  return `Supabase 请求失败: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`;
}
