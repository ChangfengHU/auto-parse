import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { publishToDouyin } from '@/lib/publishers/douyin-publish';

const COOKIE_FILE = path.join(process.cwd(), '.douyin-cookie.json');

/** Cookie 文件在 2 小时内更新过，视为有效，可跳过登录检测 */
function isCookieFresh(): boolean {
  try {
    const stat = fs.statSync(COOKIE_FILE);
    return Date.now() - stat.mtimeMs < 2 * 3600 * 1000;
  } catch { return false; }
}

// POST /api/publish — SSE 流式推送进度
// Body: { videoUrl: string, title: string, tags?: string[] }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { videoUrl, title, description, tags, cookieStr, clientId } = body as { videoUrl?: string; title?: string; description?: string; tags?: string[]; cookieStr?: string; clientId?: string };

  if (!videoUrl || !title) {
    return new Response(
      JSON.stringify({ success: false, error: '缺少 videoUrl 或 title 参数' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: 'log' | 'qrcode' | 'done' | 'error' | 'taskId', payload: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, payload })}\n\n`));
        } catch { /* 客户端已断开，静默忽略，后台任务继续运行 */ }
      };

      try {
        // ── 打印传入参数摘要 ──────────────────────────────────
        send('log', `📋 发布参数：视频=${(videoUrl||'').slice(-40)} 标题="${(title||'').slice(0,15)}" ${clientId ? `凭证=${clientId}` : cookieStr ? '含Cookie字符串' : '无登录凭证'}`);

        // 如果提供了 clientId，从 Supabase 拉取 cookie（更安全，cookie 不经过前端）
        let resolvedCookieStr = cookieStr;
        let clientIdFailed = false; // clientId 提供了但 Supabase 没拿到数据
        if (clientId && !resolvedCookieStr) {
          try {
            const SUPABASE_URL = process.env.SUPABASE_URL || '';
            const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
            const r = await fetch(`${SUPABASE_URL}/rest/v1/douyin_sessions?client_id=eq.${encodeURIComponent(clientId)}&select=cookie_str&limit=1`, {
              headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
            });
            if (r.ok) {
              const rows = await r.json() as Array<{ cookie_str: string }>;
              if (rows[0]?.cookie_str) {
                resolvedCookieStr = rows[0].cookie_str;
                send('log', `🔑 已通过凭证 ${clientId} 获取登录信息`);
              } else {
                clientIdFailed = true;
                send('log', `⚠️ 凭证 ${clientId} 在云端未找到，请先用插件同步登录状态`);
              }
            } else {
              clientIdFailed = true;
            }
          } catch {
            clientIdFailed = true;
          }
        }

        // 如果前端带了插件 cookie，直接写入本地文件并跳过登录检测
        if (resolvedCookieStr) { const cookieStr = resolvedCookieStr;
          const fs = await import('fs');
          const path = await import('path');
          const COOKIE_FILE = path.join(process.cwd(), '.douyin-cookie.json');
          const cookies = cookieStr.split(';').map((c: string) => {
            const idx = c.indexOf('=');
            if (idx < 0) return null;
            return { name: c.slice(0, idx).trim(), value: c.slice(idx + 1).trim(), domain: '.douyin.com', path: '/', secure: true, sameSite: 'None' as const };
          }).filter((c: any) => c?.name && c?.value);
          fs.writeFileSync(COOKIE_FILE, JSON.stringify({ cookies, updatedAt: Date.now(), source: 'plugin' }, null, 2));
          send('log', '🔑 已使用插件登录信息，跳过登录检测');
        }
        // clientId 提供了但没拿到数据 → 强制走登录检测（不 fallback 到本地 cookie）
        const skipLoginCheck = clientIdFailed ? false : (resolvedCookieStr ? true : isCookieFresh());
        if (!cookieStr && skipLoginCheck) send('log', '⏭️ Cookie 有效期内，将跳过登录检测直接发布');
        const result = await publishToDouyin(
          { videoUrl, title, description, tags, skipLoginCheck, clientId: clientId || undefined, cookieStr: resolvedCookieStr || undefined },
          (type, payload) => send(type, payload),
        );
        // 1. 发送独立的 taskId 事件（结构化，便于脚本/CLI 直接解析）
        if (result.taskId) {
          send('taskId', result.taskId);
        }
        // 2. done/error 文本里也保留 [taskId: xxx]，兼容旧前端正则解析
        const payload = result.taskId
          ? `${result.message} [taskId: ${result.taskId}]`
          : result.message;
        send(result.success ? 'done' : 'error', payload);
      } catch (e: unknown) {
        send('error', e instanceof Error ? e.message : String(e));
      } finally {
        try { controller.close(); } catch { /* 已关闭则忽略 */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
