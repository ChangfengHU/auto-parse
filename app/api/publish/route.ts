import { NextRequest } from 'next/server';
import { publishToDouyin } from '@/lib/publishers/douyin-publish';

// POST /api/publish — SSE 流式推送进度
// Body: { videoUrl: string, title: string, tags?: string[] }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { videoUrl, title, description, tags } = body as { videoUrl?: string; title?: string; description?: string; tags?: string[] };

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
        const result = await publishToDouyin(
          { videoUrl, title, description, tags },
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
