/**
 * POST /api/workflow/session/:id/step
 *
 * 执行指定（或当前）步骤，SSE 流式返回日志和截图。
 *
 * body（可选）:
 *   { skip: true }           — 跳过，直接推进
 *   { stepIndex: N }         — 跳到第 N 步执行（任意节点调试）
 *
 * SSE 事件:
 *   log        — 日志行
 *   screenshot — 截图 base64
 *   qrcode     — 二维码 base64
 *   done       — { result, nextStep, done, failed, skipped, relay }
 *   error      — 错误信息
 *
 * 接力（relay）规则：
 *   lastExecutedStep + 1 === stepIndex → relay = true（相邻，浏览器状态接力）
 *   否则                              → relay = false（非相邻，独立执行）
 */
import { getSession, updateSession } from '@/lib/workflow/session-store';
import { executeNode } from '@/lib/workflow/engine';
import type { WorkflowContext, StepHistory } from '@/lib/workflow/types';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const body = await req.json().catch(() => ({})) as {
    skip?: boolean;
    stepIndex?: number;
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, payload: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, payload })}\n\n`));
        } catch { /* client disconnected */ }
      };

      try {
        const session = getSession(sessionId);
        if (!session) { send('error', 'session not found'); return; }
        if (!session._page) { send('error', '浏览器 Tab 未初始化'); return; }

        // ── 确定要执行的步骤 ──────────────────────────────────────────────────
        const requestedIndex = body.stepIndex ?? session.currentStep;
        const node = session.workflow.nodes[requestedIndex];
        if (!node) {
          send('done', JSON.stringify({ done: true, message: '所有步骤已完成' }));
          updateSession(sessionId, { status: 'done' });
          return;
        }

        // ── 跳过 ─────────────────────────────────────────────────────────────
        if (body.skip) {
          send('log', `⏭️ 跳过步骤 ${requestedIndex + 1}：${node.label ?? node.type}`);
          const nextStep = requestedIndex + 1;
          const done = nextStep >= session.workflow.nodes.length;
          updateSession(sessionId, {
            currentStep: nextStep,
            lastExecutedStep: requestedIndex,
            status: done ? 'done' : 'paused',
          });
          send('done', JSON.stringify({ skipped: true, nextStep, done, relay: false }));
          return;
        }

        // ── 接力判断 ─────────────────────────────────────────────────────────
        const relay = session.lastExecutedStep !== null && session.lastExecutedStep + 1 === requestedIndex;
        if (relay) {
          send('log', `🔗 接力步骤 ${(session.lastExecutedStep ?? 0) + 1} → 步骤 ${requestedIndex + 1}`);
        } else if (session.lastExecutedStep !== null && requestedIndex !== session.lastExecutedStep + 1) {
          send('log', `🔀 跳跃执行步骤 ${requestedIndex + 1}（接力已重置）`);
        }

        updateSession(sessionId, { status: 'running', currentStep: requestedIndex });

        // ── 人工停顿 ─────────────────────────────────────────────────────────
        if (session.humanOptions?.randomDelay) {
          const delay = 1_000 + Math.random() * 3_000;
          send('log', `⏱️ 随机停顿 ${(delay / 1000).toFixed(1)}s...`);
          await new Promise(r => setTimeout(r, delay));
        }

        session._idleSim?.stop();
        send('log', `▶️ 步骤 ${requestedIndex + 1}/${session.workflow.nodes.length}：${node.label ?? node.type}`);

        const ctx: WorkflowContext = {
          vars: { ...session.vars, __pauseToken: sessionId },
          outputs: session.history.reduce((acc, h) => ({ ...acc, ...(h.result.output ?? {}) }), {}),
          emit: send,
          humanOptions: session.humanOptions,
        };

        const result = await executeNode(session._page, node, ctx);

        // ── 更新 session ──────────────────────────────────────────────────────
        const historyEntry: StepHistory = {
          stepIndex: requestedIndex,
          nodeType: node.type,
          label: node.label,
          result,
          executedAt: Date.now(),
        };

        const nextStep = requestedIndex + 1;
        const done = nextStep >= session.workflow.nodes.length;
        const failed = !result.success && !node.continueOnError;

        updateSession(sessionId, {
          currentStep: failed ? requestedIndex : nextStep,
          lastExecutedStep: requestedIndex,
          status: failed ? 'error' : done ? 'done' : 'paused',
          history: [...session.history, historyEntry],
        });

        // 重启空闲模拟
        if (session._page && session.humanOptions?.idleSimulation) {
          const freshSession = getSession(sessionId);
          if (freshSession?._idleSim) freshSession._idleSim.start(session._page);
        }

        send('done', JSON.stringify({
          result: { success: result.success, log: result.log, error: result.error, output: result.output },
          executedStep: requestedIndex,
          nextStep: failed ? requestedIndex : nextStep,
          done: done && !failed,
          failed,
          relay,
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
