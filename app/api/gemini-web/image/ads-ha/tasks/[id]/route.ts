import { NextResponse } from 'next/server';
import { getGeminiAdsHaBatchTask } from '@/lib/workflow/gemini-ads-ha-batch';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getGeminiAdsHaBatchTask(id);
  if (!task) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }
  const done = task.status === 'success' || task.status === 'failed' || task.status === 'cancelled';
  const mediaUrls = Array.from(new Set(task.items.flatMap((item) => item.mediaUrls ?? item.imageUrls).filter(Boolean)));
  const imageUrls = Array.from(new Set(task.items.flatMap((item) => item.imageUrls).filter(Boolean)));
  return NextResponse.json({
    ...task,
    done,
    resultReady: mediaUrls.length > 0,
    result: {
      mediaUrls,
      imageUrls,
      successCount: task.summary.success,
      failedCount: task.summary.failed,
      cancelledCount: task.summary.cancelled,
      totalCount: task.summary.total,
      items: task.items.map((item) => ({
        id: item.id,
        index: item.index,
        prompt: item.prompt,
        status: item.status,
        attempts: item.attempts,
        browserInstanceId: item.browserInstanceId,
        mediaUrls: item.mediaUrls ?? item.imageUrls,
        primaryMediaUrl: (item.mediaUrls ?? item.imageUrls)[0] || null,
        primaryMediaType: item.primaryMediaType || null,
        imageUrls: item.imageUrls,
        primaryImageUrl: item.imageUrls[0] || null,
        error: item.error,
        batchTaskId: item.batchTaskId,
        taskId: item.childTaskId,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
      })),
    },
  });
}
