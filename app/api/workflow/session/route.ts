/**
 * POST /api/workflow/session
 * 创建 Debug 工作流 Session
 *
 * body: { workflowId: string, vars: Record<string,string> }
 * → { sessionId, workflow, currentStep: 0, totalSteps }
 */
import { NextResponse } from 'next/server';
import { createSession, listSessions } from '@/lib/workflow/session-store';
import { getPersistentContext } from '@/lib/persistent-browser';
import { douyinPublishWorkflow } from '@/lib/workflow/workflows/douyin-publish';

const WORKFLOW_REGISTRY: Record<string, import('@/lib/workflow/types').WorkflowDef> = {
  'douyin-publish': douyinPublishWorkflow,
};

export async function POST(req: Request) {
  const { workflowId, vars = {} } = await req.json().catch(() => ({}));

  const workflow = WORKFLOW_REGISTRY[workflowId];
  if (!workflow) {
    return NextResponse.json(
      { error: `未知工作流: ${workflowId}`, available: Object.keys(WORKFLOW_REGISTRY) },
      { status: 400 }
    );
  }

  // 验证必填变量
  const missing = workflow.vars.filter(v => !vars[v]);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `缺少变量: ${missing.join(', ')}` },
      { status: 400 }
    );
  }

  // 在持久化浏览器中开一个新 Tab
  const ctx = await getPersistentContext();
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());

  const session = createSession({ workflowId, workflow, vars });
  // 把 page 存入 session（运行时引用）
  (session as typeof session & { _page: typeof page })._page = page;

  return NextResponse.json({
    sessionId: session.id,
    workflow: { id: workflow.id, name: workflow.name, nodes: workflow.nodes.map((n, i) => ({ index: i, type: n.type, label: n.label })) },
    currentStep: 0,
    totalSteps: workflow.nodes.length,
  });
}

export async function GET() {
  return NextResponse.json({ sessions: listSessions() });
}
