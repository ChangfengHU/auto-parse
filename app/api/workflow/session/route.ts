/**
 * POST /api/workflow/session — 创建 Debug 工作流 Session
 *
 * body: {
 *   workflowId?: string           — 从 DB 加载
 *   workflow?:   WorkflowDef      — 直接传入（优先，支持未保存的编辑）
 *   vars?:       Record<string,string>
 *   humanOptions?: HumanOptions
 * }
 *
 * GET /api/workflow/session — 列出所有 Session
 */
import { NextResponse } from 'next/server';
import { createSession, listSessions, updateSession } from '@/lib/workflow/session-store';
import { getPersistentContext } from '@/lib/persistent-browser';
import { getWorkflow } from '@/lib/workflow/workflow-db';
import { DEFAULT_HUMAN_OPTIONS } from '@/lib/workflow/human-options';
import { IdleSimulator } from '@/lib/workflow/idle-simulator';
import type { NavigateParams, WorkflowDef } from '@/lib/workflow/types';

function shouldDeferNativePage(workflow: WorkflowDef): boolean {
  const firstNode = workflow.nodes[0];
  if (!firstNode || firstNode.type !== 'navigate') return false;
  const params = (firstNode.params ?? {}) as Partial<NavigateParams>;
  return !!params.useAdsPower;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { workflowId, workflow: inlineWorkflow, vars = {}, humanOptions } = body as {
    workflowId?: string;
    workflow?: WorkflowDef;
    vars?: Record<string, string>;
    humanOptions?: Record<string, boolean>;
  };

  // 1. 解析工作流定义（inline 优先，否则从 DB 加载）
  let workflow: WorkflowDef | null = inlineWorkflow ?? null;
  if (!workflow && workflowId) {
    workflow = await getWorkflow(workflowId).catch(() => null);
  }
  if (!workflow) {
    return NextResponse.json(
      { error: `工作流未找到，请传入 workflow 或有效的 workflowId` },
      { status: 400 }
    );
  }

  // 2. 变量校验（仅警告，不阻断 — 允许空变量进行单节点调试）
  const mergedHumanOptions = { ...DEFAULT_HUMAN_OPTIONS, ...(humanOptions ?? {}) };

  const session = createSession({ 
    workflowId: workflow.id, 
    workflow, 
    vars, 
    humanOptions: mergedHumanOptions,
    lastExecutedStep: null 
  });

  // 3. 如果首步就是 AdsPower 导航，则延迟创建本地浏览器页，避免先弹出 Google Chrome 草稿页
  if (!shouldDeferNativePage(workflow)) {
    const ctx = await getPersistentContext();
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept());
    updateSession(session.id, { _page: page } as Partial<typeof session>);

    // 4. 空闲模拟
    if (mergedHumanOptions.idleSimulation) {
      const idleSim = new IdleSimulator();
      idleSim.start(page);
      updateSession(session.id, { _idleSim: idleSim } as Partial<typeof session>);
    }
  }

  return NextResponse.json({
    sessionId: session.id,
    workflow: {
      id: workflow.id,
      name: workflow.name,
      nodes: workflow.nodes.map((n, i) => ({ index: i, type: n.type, label: n.label })),
    },
    currentStep: 0,
    totalSteps: workflow.nodes.length,
    humanOptions: mergedHumanOptions,
  });
}

export async function GET() {
  return NextResponse.json({ sessions: listSessions() });
}
