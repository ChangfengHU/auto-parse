/**
 * GET  /api/workflow/session/:id  — 查看 Session 状态 + 当前页面截图
 * DELETE /api/workflow/session/:id  — 关闭 Session（关闭 Tab）
 */
import { NextResponse } from 'next/server';
import { getSession, deleteSession } from '@/lib/workflow/session-store';
import { captureScreenshot } from '@/lib/workflow/utils';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });

  const page = session._page;
  const screenshot = page ? await captureScreenshot(page) : undefined;
  const currentNode = session.workflow.nodes[session.currentStep];

  return NextResponse.json({
    id: session.id,
    workflowId: session.workflowId,
    currentStep: session.currentStep,
    totalSteps: session.workflow.nodes.length,
    status: session.status,
    vars: session.vars,
    currentNode: currentNode
      ? { index: session.currentStep, type: currentNode.type, label: currentNode.label }
      : null,
    history: session.history.map(h => ({
      stepIndex: h.stepIndex,
      nodeType: h.nodeType,
      label: h.label,
      success: h.result.success,
      log: h.result.log,
      error: h.result.error,
      executedAt: h.executedAt,
    })),
    screenshot,
    createdAt: session.createdAt,
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });

  const reqUrl = new URL(_req.url);
  const keepPage = reqUrl.searchParams.get('keepPage') === '1' || process.env.KEEP_BROWSER_OPEN === 'true';

  if (session._page && !keepPage) {
    await session._page.close().catch(() => {});
  }
  deleteSession(id);

  return NextResponse.json({ ok: true, keepPage, message: `Session ${id} 已关闭` });
}
