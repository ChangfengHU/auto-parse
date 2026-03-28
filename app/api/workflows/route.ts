/**
 * GET  /api/workflows  — 列出所有工作流
 * POST /api/workflows  — 创建新工作流
 */
import { NextResponse } from 'next/server';
import { listWorkflows, createWorkflow } from '@/lib/workflow/workflow-db';
import { douyinPublishWorkflow } from '@/lib/workflow/workflows/douyin-publish';

export async function GET() {
  try {
    const rows = await listWorkflows();
    // 若表为空，自动写入内置抖音工作流
    if (rows.length === 0) {
      const seeded = await createWorkflow(douyinPublishWorkflow).catch(() => null);
      return NextResponse.json(seeded ? [seeded] : []);
    }
    return NextResponse.json(rows);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.name) return NextResponse.json({ error: '缺少 name' }, { status: 400 });
    const def = await createWorkflow({
      name: body.name,
      description: body.description ?? '',
      nodes: body.nodes ?? [],
      vars: body.vars ?? [],
    });
    return NextResponse.json(def, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
