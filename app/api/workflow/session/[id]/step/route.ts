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
import { getPersistentContext } from '@/lib/persistent-browser';
import { nodeRequiresBrowser } from '@/lib/workflow/node-runtime';
import type { NavigateParams, NodeDef, WorkflowContext, StepHistory } from '@/lib/workflow/types';
import { chromium, type Browser, type Page } from 'playwright';

async function ensureSessionPage(session: ReturnType<typeof getSession>, node: NodeDef) {
  if (!session) return { page: null as Page | null, tempBrowser: undefined as Browser | undefined };
  if (!nodeRequiresBrowser(node)) {
    return { page: null as Page | null, tempBrowser: undefined as Browser | undefined };
  }
  if (session._page) return { page: session._page, tempBrowser: undefined as Browser | undefined };

  const isAdsPowerNavigate = node.type === 'navigate' && !!((node.params ?? {}) as Partial<NavigateParams>).useAdsPower;
  if (isAdsPowerNavigate) {
    const tempBrowser = await chromium.launch({ headless: true });
    const page = await tempBrowser.newPage();
    return { page, tempBrowser };
  }

  const ctx = await getPersistentContext();
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());
  session._page = page;
  updateSession(session.id, { _page: page });
  return { page, tempBrowser: undefined as Browser | undefined };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await params;
  const body = await req.json().catch(() => ({})) as {
    skip?: boolean;
    stepIndex?: number;
    reset?: boolean;
    vars?: Record<string, unknown>;
    params?: Record<string, unknown>;
    node?: Partial<NodeDef>;
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      const send = (type: string, payload: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, payload })}\n\n`));
        } catch { /* client disconnected */ }
      };

      try {
        const session = getSession(sessionId);
        if (!session) { send('error', 'session not found'); return; }

        if (body.reset) {
          const restoredVars = { ...(session.initialVars ?? {}) };
          updateSession(sessionId, {
            vars: restoredVars,
            currentStep: 0,
            lastExecutedStep: null,
            status: 'paused',
            history: [],
          });
          session.vars = restoredVars;
          session.currentStep = 0;
          session.lastExecutedStep = null;
          session.status = 'paused';
          session.history = [];
          send('log', '🔁 已重置执行状态：从第 1 步重新开始');
        }

        // ── 同步运行时变量（重要：session 创建后变量可能被用户修改） ─────────────
        const incomingVars = (() => {
          const v = body.vars;
          if (!v || typeof v !== 'object') return null;
          const cleaned: Record<string, string> = {};

          const toVarString = (raw: unknown): string => {
            if (raw === null || raw === undefined) return '';
            if (typeof raw === 'string') return raw.trim();
            if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
            if (Array.isArray(raw)) {
              if (raw.length === 0) return '';
              // UI TagInput 常见是 string[]，这里统一序列化以便模板/节点解析
              return JSON.stringify(raw);
            }
            if (typeof raw === 'object') {
              try {
                return JSON.stringify(raw);
              } catch {
                return '';
              }
            }
            return '';
          };

          for (const [k, raw] of Object.entries(v)) {
            if (!k || k.startsWith('__')) continue;
            const s = toVarString(raw);
            if (s) cleaned[k] = s;
          }
          return Object.keys(cleaned).length > 0 ? cleaned : null;
        })();
        if (incomingVars) {
          session.vars = { ...(session.vars ?? {}), ...incomingVars };
          updateSession(sessionId, { vars: session.vars });
          send('log', `🧩 已同步运行时变量（${Object.keys(incomingVars).length} 个）`);
        }

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
        // 保持 SSE 通道活性，避免在长耗时步骤（如 waitAfter）期间被中间代理断流。
        heartbeatTimer = setInterval(() => {
          send('heartbeat', String(Date.now()));
        }, 10_000);

        // ── 人工停顿 ─────────────────────────────────────────────────────────
        if (session.humanOptions?.randomDelay) {
          const delay = 1_000 + Math.random() * 3_000;
          send('log', `⏱️ 随机停顿 ${(delay / 1000).toFixed(1)}s...`);
          await new Promise(r => setTimeout(r, delay));
        }

        session._idleSim?.stop();
        const ctx: WorkflowContext = {
          vars: { ...session.vars, __pauseToken: sessionId },
          outputs: session.history.reduce((acc, h) => ({ ...acc, ...(h.result.output ?? {}) }), {}),
          emit: send,
          humanOptions: session.humanOptions,
        };

        send('log', `▶️ 步骤 ${requestedIndex + 1}/${session.workflow.nodes.length}：${node.label ?? node.type}`);
        
        // 优先使用请求体传来的完整节点配置（用于调试时的即时改动），没有则退回旧的 params 覆盖逻辑
        const activeNode: NodeDef = body.node
          ? {
              ...node,
              ...body.node,
              params: body.node.params ?? node.params,
              waitAfter: body.node.waitAfter ?? node.waitAfter,
            }
          : { ...node, params: body.params ?? node.params };

        if (body.node) {
          send('log', `💡 调试模式：已注入完整节点配置`);
          if ((body.node.params?.useAdsPower ?? activeNode.params.useAdsPower) !== undefined) {
            const params = (activeNode.params ?? {}) as Record<string, unknown>;
            send('log', `ℹ️ 实时开关状态: useAdsPower=${params.useAdsPower}, profileId=${params.adsProfileId}`);
          }
        } else if (body.params && Object.keys(body.params).length > 0) {
          send('log', `💡 调试模式：已注入 ${Object.keys(body.params).length} 个实时覆盖参数`);
          // 额外的调试日志，帮助确定到底传的是啥，特别是 useAdsPower
          if (body.params.useAdsPower !== undefined) {
            send('log', `ℹ️ 实时开关状态: useAdsPower=${body.params.useAdsPower}, profileId=${body.params.adsProfileId}`);
          }
        }

        const { page: runtimePage, tempBrowser } = await ensureSessionPage(session, activeNode);
        if (nodeRequiresBrowser(activeNode)) {
          if (!runtimePage) {
            send('error', '浏览器 Tab 未初始化');
            return;
          }
          if (tempBrowser) {
            send('log', `🫥 首步为 AdsPower 导航，已跳过本地可见浏览器预热`);
          }
          send('log', `🌐 当前页面：${runtimePage.url() || '(空白)'}`);
        } else {
          send('log', `🧠 当前节点无需浏览器，跳过页面预热`);
        }

        const result = await executeNode((runtimePage ?? ({} as Page)), activeNode, ctx);
        // 把节点内部产出的结构化日志逐条透传给前端，避免只在 done 里一次性返回。
        for (const line of result.log ?? []) {
          send('log', line);
        }
        const nextVars = Object.fromEntries(
          Object.entries(ctx.vars).filter(([key]) => key !== '__pauseToken')
        );
        
        // 检测接管逻辑：如果该节点开启了外部高匿容器（如 AdsPower），它会返回一个新的 page 对象
        // 此时我们直接把整个工作流系统的游标进行“掉包”，后续所有的点击/回车节点全都在安全的隔离沙盒内运行
        if (result.newPage) {
          const nextPage = result.newPage as Page;
          const nextBrowser = result.newBrowser as Browser | undefined;
          updateSession(sessionId, { _page: nextPage, _browser: nextBrowser });
          session._page = nextPage;
          if (result.newBrowser) {
            session._browser = nextBrowser;
          }
          send('log', `⚠️ [系统接管] 工作流游标引擎已成功转移至独立物理隔离防挂分身`);
          send('log', `🌐 接管后页面：${nextPage.url() || '(空白)'}`);
          if (tempBrowser) {
            await tempBrowser.close().catch(() => {});
          }
        } else if (tempBrowser && runtimePage) {
          session._page = runtimePage;
          updateSession(sessionId, { _page: runtimePage });
        }

        // ── 更新 session ──────────────────────────────────────────────────────
        const historyEntry: StepHistory = {
          stepIndex: requestedIndex,
          nodeType: node.type,
          label: node.label,
          result,
          executedAt: Date.now(),
          durationMs: result.durationMs,
        };

        const nextStep = requestedIndex + 1;
        const done = nextStep >= session.workflow.nodes.length;
        const failed = !result.success && !node.continueOnError;

        updateSession(sessionId, {
          vars: nextVars,
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

        const totalDurationMs = done && !failed
          ? session.history.reduce((sum, h) => sum + (h.durationMs || 0), 0) + (result.durationMs || 0)
          : undefined;

        send('done', JSON.stringify({
          result: { success: result.success, log: result.log, error: result.error, output: result.output, durationMs: result.durationMs },
          vars: nextVars,
          executedStep: requestedIndex,
          nextStep: failed ? requestedIndex : nextStep,
          done: done && !failed,
          failed,
          relay,
          totalDurationMs,
        }));

      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        send('error', msg);
      } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
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
