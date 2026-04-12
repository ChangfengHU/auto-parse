import { NextResponse } from 'next/server';
import { getGeminiAdsDispatcherQueueInfo, getGeminiAdsDispatcherTask } from '@/lib/workflow/gemini-ads-dispatcher';

export const runtime = 'nodejs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

function supabaseHeaders() {
  return {
    apikey: SUPABASE_KEY as string,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
}

type Row = {
  id: string;
  task_json?: any;
};

async function fetchTaskFromSupabase(id: string) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/gemini_ads_dispatcher_tasks`);
  url.searchParams.set('select', 'id,task_json');
  url.searchParams.set('id', `eq.${id}`);
  url.searchParams.set('limit', '1');

  const res = await fetch(url.toString(), { method: 'GET', headers: supabaseHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase query failed: HTTP ${res.status} ${text}`);
  }
  const rows = (await res.json()) as Row[];
  return rows[0]?.task_json || null;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let task: any = getGeminiAdsDispatcherTask(id);
  let source: 'memory' | 'supabase' = 'memory';

  if (!task && isSupabaseConfigured()) {
    try {
      task = await fetchTaskFromSupabase(id);
      if (task) source = 'supabase';
    } catch {
      // ignore
    }
  }

  if (!task) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }

  const done = task.status === 'success' || task.status === 'failed' || task.status === 'cancelled';
  const items = Array.isArray(task.items) ? task.items : [];

  const mediaUrls = Array.from(new Set(items.flatMap((item: any) => (item.mediaUrls ?? item.imageUrls) || []).filter(Boolean)));
  const imageUrls = Array.from(new Set(items.flatMap((item: any) => (item.imageUrls || []).filter(Boolean))));

  const retriedItems = items
    .filter((item: any) => Number(item.attempts || 0) > 1)
    .map((item: any) => ({
      id: item.id,
      index: item.index,
      prompt: item.prompt,
      originalPrompt: item.promptHistory?.[0] ?? item.prompt,
      promptHistory: item.promptHistory,
      attempts: item.attempts,
      retryCount: Math.max(0, Number(item.attempts || 0) - 1),
      status: item.status,
      error: item.error,
      browserInstanceId: item.browserInstanceId,
      batchTaskId: item.batchTaskId,
    }));

  return NextResponse.json({
    source,
    ...task,
    queue: getGeminiAdsDispatcherQueueInfo(task.id),
    traceUrl: `/api/task-traces?namespace=gemini-ads-dispatcher&taskId=${encodeURIComponent(task.id)}`,
    done,
    resultReady: mediaUrls.length > 0,
    result: {
      mediaUrls,
      imageUrls,
      successCount: task.summary?.success ?? 0,
      failedCount: task.summary?.failed ?? 0,
      cancelledCount: task.summary?.cancelled ?? 0,
      totalCount: task.summary?.total ?? items.length,
      retriedItemCount: retriedItems.length,
      retriedItems,
      items: items.map((item: any) => ({
        id: item.id,
        index: item.index,
        prompt: item.prompt,
        originalPrompt: item.promptHistory?.[0] ?? item.prompt,
        promptHistory: item.promptHistory,
        status: item.status,
        attempts: item.attempts,
        retried: Number(item.attempts || 0) > 1,
        retryCount: Math.max(0, Number(item.attempts || 0) - 1),
        browserInstanceId: item.browserInstanceId,
        mediaUrls: item.mediaUrls ?? item.imageUrls,
        primaryMediaUrl: (item.mediaUrls ?? item.imageUrls)?.[0] || null,
        primaryMediaType: item.primaryMediaType || null,
        imageUrls: item.imageUrls,
        primaryImageUrl: item.imageUrls?.[0] || null,
        error: item.error,
        batchTaskId: item.batchTaskId,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
      })),
      instances: task.instances,
    },
  });
}
