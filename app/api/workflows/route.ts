/**
 * GET  /api/workflows  — 列出所有工作流
 * POST /api/workflows  — 创建新工作流
 */
import { NextResponse } from 'next/server';
import { listWorkflows, listWorkflowsPage, createWorkflow } from '@/lib/workflow/workflow-db';
import type { WorkflowRow } from '@/lib/workflow/workflow-db';

function toWorkflowListItem(row: WorkflowRow) {
  const nodes = Array.isArray(row?.nodes) ? row.nodes : [];
  return {
    id: String(row?.id || ''),
    name: String(row?.name || ''),
    description: String(row?.description || ''),
    nodeCount: nodes.length,
    nodePreview: nodes.slice(0, 10).map((n) => ({
      type: String(n?.type || ''),
      label: typeof n?.label === 'string' ? n.label : undefined,
    })),
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limitRaw = url.searchParams.get('limit');
    const cursor = url.searchParams.get('cursor') || undefined;
    const pageRaw = url.searchParams.get('page');
    const q = url.searchParams.get('q') || undefined;
    const shouldPage = Boolean(limitRaw || cursor || q || pageRaw);

    if (shouldPage) {
      const limit = Number(limitRaw || 50);
      const page = Number(pageRaw || 1);
      const result = await listWorkflowsPage({ limit, cursor, page, q });
      return NextResponse.json({
        ...result,
        items: Array.isArray(result.items) ? result.items.map(toWorkflowListItem) : [],
      });
    }

    return NextResponse.json(await listWorkflows());
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: '缺少有效的 name' }, { status: 400 });
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    const def = await createWorkflow({
      id: id || undefined,
      name,
      description: body.description ?? '',
      nodes: body.nodes ?? [],
      vars: body.vars ?? [],
    });
    return NextResponse.json(def, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
