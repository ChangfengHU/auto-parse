import { NextRequest, NextResponse } from 'next/server';
import { createGeminiAdsBatchTask } from '@/lib/workflow/gemini-ads-batch';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const task = await createGeminiAdsBatchTask({
      runs: Array.isArray(body.runs) ? body.runs : [],
      workflowId: typeof body.workflowId === 'string' ? body.workflowId : undefined,
      promptVarName: typeof body.promptVarName === 'string' ? body.promptVarName : undefined,
      maxConcurrency: Number(body.maxConcurrency ?? 0) || undefined,
      autoCloseTab: body.autoCloseTab !== undefined ? Boolean(body.autoCloseTab) : undefined,
    });

    return NextResponse.json({
      taskId: task.id,
      status: task.status,
      summary: task.summary,
      workflow: {
        id: task.workflowId,
        name: task.workflowName,
      },
      queryUrl: `/api/gemini-web/image/ads-batch/tasks/${task.id}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

