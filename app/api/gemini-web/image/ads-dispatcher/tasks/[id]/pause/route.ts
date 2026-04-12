import { NextRequest, NextResponse } from 'next/server';
import { pauseGeminiAdsDispatcherTask } from '@/lib/workflow/gemini-ads-dispatcher';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof (body as any).reason === 'string' ? (body as any).reason : undefined;

  const task = await pauseGeminiAdsDispatcherTask(id, reason);
  if (!task) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, taskId: id, status: task.status });
}
