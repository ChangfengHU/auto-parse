import { NextRequest, NextResponse } from 'next/server';
import { createGeminiAdsHaBatchTask } from '@/lib/workflow/gemini-ads-ha-batch';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const prompts = Array.isArray(body.prompts)
      ? body.prompts
      : Array.isArray(body.runs)
        ? body.runs.map((item: unknown) => (item && typeof item === 'object' ? (item as { prompt?: string }).prompt : ''))
        : [];
    const instanceIds = Array.isArray(body.instanceIds)
      ? body.instanceIds
      : Array.isArray(body.runs)
        ? body.runs.map((item: unknown) =>
            item && typeof item === 'object' ? (item as { browserInstanceId?: string }).browserInstanceId : ''
          )
        : undefined;

    const task = await createGeminiAdsHaBatchTask({
      prompts,
      instanceIds,
      workflowId: typeof body.workflowId === 'string' ? body.workflowId : undefined,
      promptVarName: typeof body.promptVarName === 'string' ? body.promptVarName : undefined,
      maxConcurrency: Number(body.maxConcurrency ?? 0) || undefined,
      maxAttemptsPerPrompt: Number(body.maxAttemptsPerPrompt ?? 0) || undefined,
      runTimeoutMs: Number(body.runTimeoutMs ?? 0) || undefined,
      pollIntervalMs: Number(body.pollIntervalMs ?? 0) || undefined,
      autoCloseTab: body.autoCloseTab !== undefined ? Boolean(body.autoCloseTab) : undefined,
    });

    return NextResponse.json({
      taskId: task.id,
      status: task.status,
      summary: task.summary,
      queryUrl: `/api/gemini-web/image/ads-ha/tasks/${task.id}`,
      settings: task.settings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

