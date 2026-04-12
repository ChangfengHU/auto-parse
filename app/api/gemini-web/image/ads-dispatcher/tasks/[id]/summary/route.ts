import { NextResponse } from 'next/server';
import { getGeminiAdsDispatcherQueueInfo, getGeminiAdsDispatcherTask } from '@/lib/workflow/gemini-ads-dispatcher';

export const runtime = 'nodejs';

type TaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

function isDone(status: TaskStatus): boolean {
  return status === 'success' || status === 'failed' || status === 'cancelled';
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getGeminiAdsDispatcherTask(id);
  if (!task) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }

  const done = isDone(task.status as TaskStatus);
  const mediaUrls = Array.from(new Set(task.items.flatMap((item) => item.mediaUrls ?? item.imageUrls).filter(Boolean)));
  const imageUrls = Array.from(new Set(task.items.flatMap((item) => item.imageUrls ?? []).filter(Boolean)));
  const completed = (task.summary?.success ?? 0) + (task.summary?.failed ?? 0) + (task.summary?.cancelled ?? 0);
  const total = task.summary?.total ?? task.items.length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  return NextResponse.json({
    id: task.id,
    status: task.status,
    queue: getGeminiAdsDispatcherQueueInfo(task.id),
    done,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    cancelRequested: task.cancelRequested,
    cancelReason: task.cancelReason,
    error: task.error,
    summary: task.summary,
    progress: {
      total,
      completed,
      percent: progress,
      pending: task.summary?.pending ?? 0,
      running: task.summary?.running ?? 0,
      success: task.summary?.success ?? 0,
      failed: task.summary?.failed ?? 0,
      cancelled: task.summary?.cancelled ?? 0,
    },
    resultReady: mediaUrls.length > 0,
    result: {
      mediaUrls,
      imageUrls,
      primaryMediaUrl: mediaUrls[0] ?? null,
      primaryImageUrl: imageUrls[0] ?? null,
    },
    items: task.items.map((item) => {
      const media = (item.mediaUrls ?? item.imageUrls).filter(Boolean);
      const images = (item.imageUrls ?? []).filter(Boolean);
      return {
        index: item.index,
        status: item.status,
        attempts: item.attempts,
        primaryMediaUrl: media[0] ?? null,
        primaryMediaType: item.primaryMediaType ?? null,
        primaryImageUrl: images[0] ?? null,
        error: item.error,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
      };
    }),
  });
}
