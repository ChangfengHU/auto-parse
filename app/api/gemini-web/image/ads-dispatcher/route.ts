import { NextRequest, NextResponse } from 'next/server';
import {
  clearGeminiAdsDispatcherQueue,
  createGeminiAdsDispatcherTask,
  getGeminiAdsDispatcherQueueInfo,
} from '@/lib/workflow/gemini-ads-dispatcher';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const prompts = Array.isArray(body.prompts)
      ? body.prompts
      : Array.isArray(body.runs)
        ? body.runs.map((item: unknown) => (item && typeof item === 'object' ? (item as { prompt?: string }).prompt : ''))
        : [];

    const clearQueue = body.clearQueue === true || body.flushQueue === true || body.resetQueue === true;
    const clearQueueReason = typeof body.clearQueueReason === 'string'
      ? body.clearQueueReason
      : (typeof body.clearReason === 'string' ? body.clearReason : 'manual clearQueue');

    const cleared = clearQueue
      ? await clearGeminiAdsDispatcherQueue({ reason: clearQueueReason })
      : null;

    if (clearQueue && prompts.length === 0) {
      return NextResponse.json({
        ok: true,
        cleared,
      });
    }
    const instanceIds = Array.isArray(body.instanceIds)
      ? body.instanceIds
      : undefined;

    const force = body.force === true || body.forceExecute === true || body.forceStart === true;

    const task = await createGeminiAdsDispatcherTask({
      prompts,
      instanceIds,
      force,
      forceReason: typeof body.forceReason === 'string' ? body.forceReason : undefined,
      workflowId: typeof body.workflowId === 'string' ? body.workflowId : undefined,
      promptVarName: typeof body.promptVarName === 'string' ? body.promptVarName : undefined,
      maxAttemptsPerPrompt: Number(body.maxAttemptsPerPrompt ?? 0) || undefined,
      pollIntervalMs: Number(body.pollIntervalMs ?? 0) || undefined,
      childTaskTimeoutMs: Number(body.childTaskTimeoutMs ?? 0) || undefined,
      dispatcherTimeoutMs: Number(body.dispatcherTimeoutMs ?? 0) || undefined,
      maxIdleCyclesWithoutAssignment: Number(body.maxIdleCyclesWithoutAssignment ?? 0) || undefined,
      instanceCooldownMs: Number(body.instanceCooldownMs ?? 0) || undefined,
      failureCooldownThreshold: Number(body.failureCooldownThreshold ?? 0) || undefined,
      autoCloseTab: body.autoCloseTab !== undefined ? Boolean(body.autoCloseTab) : undefined,

      optimizePromptOnRetry: body.optimizePromptOnRetry !== undefined ? Boolean(body.optimizePromptOnRetry) : undefined,
      promptOptimizationModel: typeof body.promptOptimizationModel === 'string' ? body.promptOptimizationModel : undefined,
      promptOptimizationTimeoutMs: Number(body.promptOptimizationTimeoutMs ?? 0) || undefined,
      maxPromptOptimizationsPerItem: Number(body.maxPromptOptimizationsPerItem ?? 0) || undefined,
    });

    return NextResponse.json({
      taskId: task.id,
      status: task.status,
      cleared,
      queue: getGeminiAdsDispatcherQueueInfo(task.id),
      warnings: task.warnings,
      preflight: task.preflight,
      summary: task.summary,
      metrics: task.metrics,
      settings: task.settings,
      queryUrl: `/api/gemini-web/image/ads-dispatcher/tasks/${task.id}`,
      querySummaryUrl: `/api/gemini-web/image/ads-dispatcher/tasks/${task.id}/summary`,
      cancelUrl: `/api/gemini-web/image/ads-dispatcher/tasks/${task.id}/cancel`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
