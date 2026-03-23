/**
 * POST /api/workflow/session/:id/step
 *
 * 执行当前步骤（SSE 流），完成后自动推进到下一步。
 *
 * body（可选）:
 *   { skip: true }  — 跳过当前步骤，直接推进
 *   { retry: true } — 重试当前步骤
 *
 * SSE 事件:
 *   log        — 日志行
 *   screenshot — 截图 base64
 *   qrcode     — 二维码 base64（qrcode 节点）
 *   progress   — 进度数字（wait_condition 节点）
 *   done       — { result: NodeResult, nextStep, done: boolean }
 *   error      — 错误信息
 */
import { getSession, updateSession } from '@/lib/workflow/session-store';
import { executeNode } from '@/lib/workflow/engine';
import type { WorkflowContext, StepHistory } from '@/lib/workflow/types';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const body = await req.json().catch(() => ({}));
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, payload: string) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type, payload })}\n\n`)
          );
        } catch { /* client disconnected */ }
      };

      try {
        const session = getSession(sessionId);
        if (!session) { send('error', 'session not found'); return; }
        if (!session._page) { send('error', '浏览器 Tab 未初始化'); return; }

        if (session.status === 'done') {
          send('done', JSON.stringify({ done: true, message: '工作流已完成' }));
          return;
        }

        const stepIndex = session.currentStep;
        const node = session.workflow.nodes[stepIndex];
        if (!node) {
          send('done', JSON.stringify({ done: true, message: '所有步骤已完成' }));
          updateSession(sessionId, { status: 'done' });
          return;
        }

        // 跳过当前步骤
        if (body.skip) {
          send('log', `⏭️ 跳过步骤 ${stepIndex + 1}：${node.label ?? node.type}`);
          const nextStep = stepIndex + 1;
          const done = nextStep >= session.workflow.nodes.length;
          updateSession(sessionId, {
            currentStep: nextStep,
            status: done ? 'done' : 'paused',
          });
          send('done', JSON.stringify({ skipped: true, nextStep, done }));
          return;
        }

        updateSession(sessionId, { status: 'running' });
        send('log', `▶️ 步骤 ${stepIndex + 1}/${session.workflow.nodes.length}：${node.label ?? node.type}`);

        const ctx: WorkflowContext = {
          vars: session.vars,
          outputs: session.history.reduce((acc, h) => ({ ...acc, ...(h.result.output ?? {}) }), {}),
          emit: send,
        };

        const result = await executeNode(session._page, node, ctx);

        // 记录历史
        const historyEntry: StepHistory = {
          stepIndex,
          nodeType: node.type,
          label: node.label,
          result,
          executedAt: Date.now(),
        };

        const nextStep = stepIndex + 1;
        const done = nextStep >= session.workflow.nodes.length;
        const failed = !result.success && !node.continueOnError;

        updateSession(sessionId, {
          currentStep: failed ? stepIndex : nextStep,
          status: failed ? 'error' : done ? 'done' : 'paused',
          history: [...session.history, historyEntry],
        });

        send('done', JSON.stringify({
          result: {
            success: result.success,
            log: result.log,
            error: result.error,
            output: result.output,
          },
          nextStep: failed ? stepIndex : nextStep,
          done: done && !failed,
          failed,
        }));

      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        send('error', msg);
      } finally {
        try { controller.close(); } catch { /* ignore */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
