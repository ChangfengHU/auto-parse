import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { reconcileDouyinTask } from '@/lib/workflow/douyin-reconcile';
import { getWorkflowTaskSummary, getWorkflowTask } from '@/lib/workflow/workflow-task-cli';
import { startDouyinWorkflow } from '@/lib/workflow/douyin-workflow-service';

export async function POST(req: NextRequest) {
  const expected = process.env.AUTO_PARSE_ADMIN_TOKEN;
  const actual = req.headers.get('authorization') || '';
  if (!expected || Buffer.byteLength(actual) !== Buffer.byteLength('Bearer ' + expected) ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from('Bearer ' + expected))) {
    return NextResponse.json({ ok: false, code: 'unauthorized' }, { status: 401 });
  }
  try {
    const input = await req.json();
    if (input.action === 'capabilities') return NextResponse.json({
      ok: true, executionOwner: 'auto-parse', workflowId: '34f421be-f97c-498a-9c80-5214564abd1c',
      browser: { node: 'host-84', instance: 2, creatorLoginVerifiedPerTask: true },
      fields: { title: { maxLength: 30 }, description: { maxLength: 900 },
        topics: { maxItems: 5, mode: 'caption_text', nativeTopicSelection: false },
        cover: { modes: ['vertical_image', 'horizontal_image'], maxBytes: 8388608, verification: 'experimental' },
        aiGenerated: { required: true } },
      prepareWithoutPublishing: true, requiresExplicitPublishConfirmation: true,
      receiptSources: ['creation_response', 'creator_work_list'], uncertainResultsMustNotBeRetried: true,
    });
    if (input.action === 'prepare' || input.action === 'publish') {
      return NextResponse.json(await startDouyinWorkflow({
        requestId: input.requestId, expectedAccountId: input.accountId, videoUrl: input.videoUrl, title: input.title,
        description: input.description ?? '', topics: input.topics ?? [], aiGenerated: input.aiGenerated,
        cover: input.cover,
        prepareOnly: input.action === 'prepare', confirmPublish: input.action === 'publish' && input.confirmPublish === true,
      }));
    }
    if (input.action === 'reconcile') {
      const receipt = await reconcileDouyinTask(String(input.taskId || ''), String(input.awemeId || ''));
      return NextResponse.json({ ok: true, status: 'published', taskId: input.taskId, receipt, noPublicationPerformed: true });
    }
    if (input.action === 'get_task') {
      const task = getWorkflowTask(String(input.taskId || ''));
      if (!task) return NextResponse.json({ ok: false, code: 'task_not_found' }, { status: 404 });
      const output = task.steps.find(step => step.output?.awemeId || step.output?.prepared)?.output;
      const receipt = task.publication || (output?.awemeId ? output : null);
      return NextResponse.json({ ok: true, taskId: task.taskId, status: receipt ? 'published' : output?.prepared ? 'prepared' : task.status,
        receipt, prepared: output?.prepared ? output : null, workflowExecution: getWorkflowTaskSummary(task.taskId) });
    }
    return NextResponse.json({ ok: false, code: 'unknown_action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'douyin_workflow_failed';
    return NextResponse.json({ ok: false, code: message }, { status: 409 });
  }
}
