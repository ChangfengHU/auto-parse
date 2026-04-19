/**
 * POST /api/workflows/tasks/[taskId]/stop - 停止工作流任务
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTask, wfTaskLogLookupMiss } from '@/lib/workflow/task-store';
import { stopWorkflowTask } from '@/lib/workflow/workflow-task-cli';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  const task = getTask(taskId);
  if (!task) {
    wfTaskLogLookupMiss(taskId, 'POST /api/workflows/tasks/[taskId]/stop', {
      userAgent: req.headers.get('user-agent') ?? '',
    });
    return NextResponse.json(
      { error: 'Task not found' },
      { status: 404 }
    );
  }

  // 如果任务已经完成，不能停止
  if (task.status === 'done' || task.status === 'error' || task.status === 'stopped') {
    return NextResponse.json(
      { error: `Cannot stop task in ${task.status} status` },
      { status: 400 }
    );
  }

  // 解析请求体获取停止原因
  let reason = 'user_cancelled';
  try {
    const body = await req.json();
    if (body.reason) reason = body.reason;
  } catch {
    // 无请求体，使用默认原因
  }

  // 执行停止操作
  const stoppedTask = stopWorkflowTask(taskId, reason);
  if (!stoppedTask) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  return NextResponse.json({
    taskId: stoppedTask.taskId,
    status: stoppedTask.status,
    stoppedAt: stoppedTask.stoppedAt,
    reason: reason,
    message: 'Task stopped successfully',
    totalDuration: stoppedTask.totalDuration,
  });
}
