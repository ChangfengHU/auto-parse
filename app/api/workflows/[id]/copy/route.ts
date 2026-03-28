/**
 * POST /api/workflows/:id/copy — 复制工作流
 */
import { NextResponse } from 'next/server';
import { copyWorkflow } from '@/lib/workflow/workflow-db';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const copy = await copyWorkflow(id);
    return NextResponse.json(copy, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
