/**
 * GET /api/workflows/tasks/[taskId] - 查询工作流任务详细信息
 */

import { NextRequest, NextResponse } from 'next/server';
import { wfTaskLogLookupMiss } from '@/lib/workflow/task-store';
import { getWorkflowTaskDetail } from '@/lib/workflow/workflow-task-cli';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  const detail = getWorkflowTaskDetail(taskId);
  if (!detail) {
    wfTaskLogLookupMiss(taskId, 'GET /api/workflows/tasks/[taskId]', {
      userAgent: req.headers.get('user-agent') ?? '',
    });
    return NextResponse.json(
      { error: 'Task not found' },
      { status: 404 }
    );
  }

  return NextResponse.json(detail);
}
