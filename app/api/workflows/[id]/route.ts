/**
 * GET    /api/workflows/:id  — 获取单个工作流
 * PUT    /api/workflows/:id  — 更新工作流
 * DELETE /api/workflows/:id  — 删除工作流
 */
import { NextResponse } from 'next/server';
import { getWorkflow, updateWorkflow, deleteWorkflow, copyWorkflow } from '@/lib/workflow/workflow-db';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const def = await getWorkflow(id);
    if (!def) return NextResponse.json({ error: '未找到' }, { status: 404 });
    return NextResponse.json(def);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    const body = await req.json();
    const def = await updateWorkflow(id, {
      name: body.name,
      description: body.description,
      nodes: body.nodes,
      vars: body.vars,
    });
    return NextResponse.json(def);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  try {
    await deleteWorkflow(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const url = new URL(req.url);
  if (url.pathname.endsWith('/copy')) {
    try {
      const copy = await copyWorkflow(id);
      return NextResponse.json(copy, { status: 201 });
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
