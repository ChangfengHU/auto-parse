import { NextResponse } from 'next/server';
import { getGeminiAdsDispatcherQueueInfo, getGeminiAdsDispatcherTask } from '@/lib/workflow/gemini-ads-dispatcher';

export const runtime = 'nodejs';

type TaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

function isDone(status: TaskStatus): boolean {
  return status === 'success' || status === 'failed' || status === 'cancelled';
}

function sanitizeUrls(urls: unknown, sourceImageUrls: unknown): string[] {
  const blocked = new Set(
    (Array.isArray(sourceImageUrls) ? sourceImageUrls : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(urls) ? urls : []) {
    const url = String(raw || '').trim();
    if (!url || blocked.has(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await getGeminiAdsDispatcherTask(id);
  if (!task) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }

  const done = isDone(task.status as TaskStatus);
  const mediaUrls = Array.from(new Set(task.items.flatMap((item) => sanitizeUrls(item.mediaUrls ?? item.imageUrls, item.sourceImageUrls))));
  const imageUrls = Array.from(new Set(task.items.flatMap((item) => sanitizeUrls(item.imageUrls ?? [], item.sourceImageUrls))));
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
      const media = sanitizeUrls(item.mediaUrls ?? item.imageUrls, item.sourceImageUrls);
      const images = sanitizeUrls(item.imageUrls ?? [], item.sourceImageUrls);
      return {
        index: item.index,
        prompt: item.prompt,
        sourceImageUrls: item.sourceImageUrls ?? [],
        sourceImageUrl: item.sourceImageUrls?.[0] ?? null,
        status: item.status,
        attempts: item.attempts,
        workflowTaskId: (item as any).workflowTaskId ?? (item as any).batchTaskId ?? null,
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
