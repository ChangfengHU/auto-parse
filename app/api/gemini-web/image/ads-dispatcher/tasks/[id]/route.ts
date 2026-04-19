import fs from 'fs';
import os from 'os';
import path from 'path';
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

function parseTs(value?: string | null) {
  if (!value) return NaN;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : NaN;
}

function durationMs(start?: string | null, end?: string | null) {
  const s = parseTs(start);
  const e = parseTs(end ?? new Date().toISOString());
  if (!Number.isFinite(s) || !Number.isFinite(e)) return undefined;
  return Math.max(0, e - s);
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

function fetchTaskFromDisk(id: string) {
  const { getGeminiAdsDispatcherTaskCacheDir } = require('@/lib/workflow/gemini-ads-dispatcher-cache') as typeof import('@/lib/workflow/gemini-ads-dispatcher-cache');
  const dir = getGeminiAdsDispatcherTaskCacheDir();
  const directFile = path.join(dir, `${id}.json`);

  const tryRead = (file: string) => {
    try {
      const task = JSON.parse(fs.readFileSync(file, 'utf8')) as any;
      return task && task.id === id ? task : null;
    } catch {
      return null;
    }
  };

  if (fs.existsSync(directFile)) {
    const direct = tryRead(directFile);
    if (direct) return direct;
  }

  if (!fs.existsSync(dir)) return null;

  // Fallback: scan directory to find matching task id (file name may not equal taskId)
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }

  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    if (name === 'queue.json') continue;
    const hit = tryRead(path.join(dir, name));
    if (hit) return hit;
  }

  return null;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const task = await getGeminiAdsDispatcherTask(id);
  const source = 'memory'; // 内部已处理三级缓存，此处为兼容语义保留 key

  if (!task) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }

  const done = task.status === 'success' || task.status === 'failed' || task.status === 'cancelled';
  const items = Array.isArray(task.items) ? task.items : [];
  const sanitizedItems = items.map((item: any) => {
    const media = sanitizeUrls(item.mediaUrls ?? item.imageUrls, item.sourceImageUrls);
    const images = sanitizeUrls(item.imageUrls, item.sourceImageUrls);
    const attempts = Number(item.attempts || 0);
    const attemptHistory = Array.isArray(item.attemptHistory)
      ? item.attemptHistory.map((attempt: any) => ({
          attempt: Number(attempt?.attempt || 0),
          prompt: attempt?.prompt,
          browserInstanceId: attempt?.browserInstanceId,
          batchTaskId: attempt?.batchTaskId,
          startedAt: attempt?.startedAt,
          endedAt: attempt?.endedAt,
          durationMs: attempt?.durationMs ?? durationMs(attempt?.startedAt, attempt?.endedAt),
          outcome: attempt?.outcome,
          error: attempt?.error,
          failureCategory: attempt?.failureCategory,
          rewriteApplied: attempt?.rewriteApplied,
          rewriteReason: attempt?.rewriteReason,
        }))
      : [];
    return {
      id: item.id,
      index: item.index,
      prompt: item.prompt,
      sourceImageUrls: item.sourceImageUrls ?? [],
      sourceImageUrl: item.sourceImageUrls?.[0] ?? null,
      originalPrompt: item.promptHistory?.[0] ?? item.prompt,
      promptHistory: item.promptHistory,
      status: item.status,
      attempts,
      retried: attempts > 1,
      retryCount: Math.max(0, attempts - 1),
      browserInstanceId: item.browserInstanceId,
      mediaUrls: media,
      primaryMediaUrl: media[0] || null,
      primaryMediaType: item.primaryMediaType || null,
      imageUrls: images,
      primaryImageUrl: images[0] || null,
      error: item.error,
      failureCategory: item.failureCategory,
      batchTaskId: item.batchTaskId,
      batchTaskHistory: item.batchTaskHistory ?? [],
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      durationMs: durationMs(item.startedAt, item.endedAt),
      attemptHistory,
    };
  });

  const mediaUrls = Array.from(new Set(items.flatMap((item: any) => sanitizeUrls(item.mediaUrls ?? item.imageUrls, item.sourceImageUrls))));
  const imageUrls = Array.from(new Set(items.flatMap((item: any) => sanitizeUrls(item.imageUrls, item.sourceImageUrls))));

  const retriedItems = items
    .filter((item: any) => Number(item.attempts || 0) > 1)
    .map((item: any) => ({
      id: item.id,
      index: item.index,
      prompt: item.prompt,
      sourceImageUrls: item.sourceImageUrls ?? [],
      sourceImageUrl: item.sourceImageUrls?.[0] ?? null,
      originalPrompt: item.promptHistory?.[0] ?? item.prompt,
      promptHistory: item.promptHistory,
      attempts: item.attempts,
      retryCount: Math.max(0, Number(item.attempts || 0) - 1),
      status: item.status,
      error: item.error,
      failureCategory: item.failureCategory,
      browserInstanceId: item.browserInstanceId,
      batchTaskId: item.batchTaskId,
      durationMs: durationMs(item.startedAt, item.endedAt),
    }));

  const failureCategoryStats = sanitizedItems.reduce((acc: Record<string, number>, item: any) => {
    const category = typeof item.failureCategory === 'string' ? item.failureCategory : '';
    if (!category) return acc;
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});

  const taskDurationMs = durationMs(task.startedAt || task.createdAt, task.endedAt);

  return NextResponse.json({
    source,
    ...task,
    durationMs: taskDurationMs,
    items: sanitizedItems,
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
      durationMs: taskDurationMs,
      failureCategoryStats,
      retriedItems,
      items: sanitizedItems,
      instances: task.instances,
    },
  });
}
