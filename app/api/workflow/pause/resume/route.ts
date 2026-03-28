/**
 * POST /api/workflow/pause/resume
 *
 * 触发人工暂停的继续信号。
 * body: { token: string }
 *   token = sessionId（来自工作流 Debug）或 "scratch"（来自节点库调试）
 */
import { NextResponse } from 'next/server';
import { signalResume, isPaused } from '@/lib/workflow/pause-signal';

export async function POST(req: Request) {
  const { token } = await req.json() as { token?: string };
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  if (!isPaused(token)) {
    return NextResponse.json({ error: '没有等待中的暂停，或已超时' }, { status: 404 });
  }

  signalResume(token);
  return NextResponse.json({ ok: true });
}
