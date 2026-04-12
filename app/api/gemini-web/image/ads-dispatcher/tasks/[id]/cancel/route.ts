import { NextResponse } from 'next/server';
import { cancelGeminiAdsDispatcherTask } from '@/lib/workflow/gemini-ads-dispatcher';

export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const reason = typeof body.reason === 'string' ? body.reason : undefined;
  const task = cancelGeminiAdsDispatcherTask(id, reason);
  if (!task) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }
  return NextResponse.json({
    taskId: task.id,
    status: task.status,
    cancelRequested: task.cancelRequested,
    cancelReason: task.cancelReason,
  });
}
