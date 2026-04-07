import { NextResponse } from 'next/server';
import { getGeminiWebImageTask } from '@/lib/workflow/gemini-web-image';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = getGeminiWebImageTask(id);
  if (!task) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }
  return NextResponse.json(task);
}

