import { NextResponse } from 'next/server';
import { cancelGeminiAdsBatchTask } from '@/lib/workflow/gemini-ads-batch';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = cancelGeminiAdsBatchTask(id);
  if (!task) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }
  return NextResponse.json({
    taskId: task.id,
    status: task.status,
    cancelRequested: task.cancelRequested,
  });
}

