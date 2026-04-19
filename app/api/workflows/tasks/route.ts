/**
 * POST /api/workflows/tasks - 启动工作流任务（后台跑完整流程）
 *
 * body: { workflowId, vars?, debugMode?, enableIdleSimulation? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { wfTaskDiag } from '@/lib/workflow/task-store';
import { startWorkflowTask } from '@/lib/workflow/workflow-task-cli';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { workflowId, vars: rawVars } = body as {
      workflowId?: string;
      vars?: Record<string, unknown>;
      debugMode?: boolean;
      enableIdleSimulation?: boolean;
    };

    if (!workflowId || typeof workflowId !== 'string') {
      return NextResponse.json({ error: 'Missing workflowId' }, { status: 400 });
    }

    const task = await startWorkflowTask({
      workflowId: workflowId.trim(),
      vars: rawVars,
    });

    return NextResponse.json({
      taskId: task.taskId,
      workflowId: task.workflowId,
      status: task.status,
      startedAt: task.startedAt,
      createdAt: task.startedAt,
    });
  } catch (e) {
    const errMessage =
      e instanceof Error
        ? [e.message, e.cause instanceof Error ? e.cause.message : ''].filter(Boolean).join(' · ')
        : String(e);
    wfTaskDiag('post.error', {
      errName: e instanceof Error ? e.name : typeof e,
      errMessage,
    });
    const status = errMessage === 'Workflow not found' ? 404 : 500;
    return NextResponse.json({ error: errMessage }, { status });
  }
}
