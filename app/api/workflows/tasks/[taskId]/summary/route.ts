/**
 * GET /api/workflows/tasks/[taskId]/summary - 查询工作流任务简略信息
 */

import { NextRequest, NextResponse } from 'next/server';
import { wfTaskLogLookupMiss } from '@/lib/workflow/task-store';
import { getWorkflowTaskSummary } from '@/lib/workflow/workflow-task-cli';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  const summary = getWorkflowTaskSummary(taskId);
  if (!summary) {
    wfTaskLogLookupMiss(taskId, 'GET /api/workflows/tasks/[taskId]/summary', {
      userAgent: req.headers.get('user-agent') ?? '',
    });
    return NextResponse.json(
      { error: 'Task not found' },
      { status: 404 }
    );
  }

  return NextResponse.json(summary);
}
