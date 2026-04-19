import { NextResponse } from 'next/server';
import { getGeminiWebImageTask } from '@/lib/workflow/gemini-web-image';
import { getWorkflowTaskDetail } from '@/lib/workflow/workflow-task-cli';

function toLegacyStatus(status: string) {
  if (status === 'done') return 'success';
  if (status === 'error') return 'failed';
  if (status === 'stopped') return 'cancelled';
  return status;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getGeminiWebImageTask(id);
  if (task) {
    return NextResponse.json(task);
  }

  const workflowTask = getWorkflowTaskDetail(id);
  if (!workflowTask) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }

  return NextResponse.json({
    id: workflowTask.taskId,
    status: toLegacyStatus(workflowTask.status),
    workflowId: workflowTask.workflowId,
    workflowName: workflowTask.workflow.name,
    error: workflowTask.errorMessage || undefined,
    startedAt: new Date(workflowTask.startedAt).toISOString(),
    endedAt: workflowTask.completedAt ? new Date(workflowTask.completedAt).toISOString() : undefined,
    cancelRequested: workflowTask.status === 'stopped',
    autoCloseTab: false,
    checkpoints: workflowTask.steps.map((step) => ({
      stepIndex: step.idx - 1,
      name: step.label ?? step.nodeType,
      status: step.status === 'success' || step.status === 'skipped'
        ? 'ok'
        : step.status === 'error'
          ? 'error'
          : step.status === 'running'
            ? 'running'
            : workflowTask.status === 'stopped'
              ? 'cancelled'
              : 'running',
      message:
        step.error
        || step.logs.at(-1)
        || (step.status === 'success' || step.status === 'skipped' ? '步骤完成' : step.status === 'running' ? '执行中' : '等待执行'),
      timestamp: new Date(step.executedAt ?? workflowTask.startedAt).toISOString(),
    })),
  });
}
