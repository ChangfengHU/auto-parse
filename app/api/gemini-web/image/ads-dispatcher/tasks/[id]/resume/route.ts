import { NextRequest, NextResponse } from 'next/server';
import { resumeGeminiAdsDispatcherTask } from '@/lib/workflow/gemini-ads-dispatcher';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const mode = (body as any).mode === 'front' ? 'front' : 'back';

  const task = await resumeGeminiAdsDispatcherTask(id, { mode });
  if (!task) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, taskId: id, status: task.status, mode });
}
