import { NextRequest, NextResponse } from 'next/server';
import { listWorkflows, getWorkflow } from '@/lib/workflow/workflow-db';
import { createGeminiWebImageTask } from '@/lib/workflow/gemini-web-image';
import type { WorkflowDef } from '@/lib/workflow/types';

const DEFAULT_WORKFLOW_NAME = process.env.GEMINI_WEB_IMAGE_WORKFLOW_NAME || 'gemini流程管理';
const DEFAULT_WORKFLOW_ID =
  process.env.GEMINI_WEB_IMAGE_WORKFLOW_ID || process.env.GEMINI_WEB_WORKFLOW_ID || '';

function pickPromptVarName(workflow: WorkflowDef, requested?: string): string {
  if (requested) return requested;
  if (workflow.vars.includes('prompt')) return 'prompt';
  if (workflow.vars.includes('imagePrompt')) return 'imagePrompt';
  if (workflow.vars.includes('text')) return 'text';
  return process.env.GEMINI_WEB_PROMPT_VAR || 'prompt';
}

async function resolveWorkflow(workflowId?: string): Promise<WorkflowDef | null> {
  if (workflowId) return getWorkflow(workflowId);
  if (DEFAULT_WORKFLOW_ID) {
    const fromEnv = await getWorkflow(DEFAULT_WORKFLOW_ID);
    if (fromEnv) return fromEnv;
  }
  const all = await listWorkflows();
  const byName = all.find(item => item.name === DEFAULT_WORKFLOW_NAME);
  if (!byName) return null;
  return getWorkflow(byName.id);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { prompt, workflowId, vars = {}, promptVarName } = body as {
      prompt?: string;
      workflowId?: string;
      vars?: Record<string, string>;
      promptVarName?: string;
    };

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'prompt 不能为空' }, { status: 400 });
    }

    const workflow = await resolveWorkflow(workflowId);
    if (!workflow) {
      return NextResponse.json(
        {
          error:
            '未找到 Gemini 页面生图工作流。请传 workflowId，或配置 GEMINI_WEB_IMAGE_WORKFLOW_ID/GEMINI_WEB_IMAGE_WORKFLOW_NAME。',
        },
        { status: 400 }
      );
    }

    const varName = pickPromptVarName(workflow, promptVarName);
    const mergedVars: Record<string, string> = { ...vars, [varName]: prompt.trim() };
    if (workflow.vars.length === 1 && !mergedVars[workflow.vars[0]]) {
      mergedVars[workflow.vars[0]] = prompt.trim();
    }

    const task = await createGeminiWebImageTask({
      workflow,
      vars: mergedVars,
      prompt: prompt.trim(),
    });

    return NextResponse.json({
      taskId: task.id,
      status: task.status,
      workflow: { id: task.workflowId, name: task.workflowName },
      sessionId: task.sessionId,
      message: '任务已创建，使用 /api/gemini-web/image/tasks/:id 查询进度',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

