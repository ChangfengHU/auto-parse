/**
 * POST /api/workflow/node-debug
 *
 * 在真实浏览器的持久化「草稿页」中执行单个节点，SSE 流式返回日志和截图。
 *
 * 草稿页在多次调用间保持存活，不会执行后关闭，因此连续调试不同节点时
 * 浏览器状态可以自然接力（例如：先导航到某页面，再对该页面做点击/输入）。
 *
 * 如需重置草稿页状态，调用 DELETE /api/workflow/node-debug。
 */

import { NextRequest } from 'next/server';
import { chromium, type Browser, type Page } from 'playwright';
import { getDebugScratchPage, resetDebugScratchPage, setDebugScratchPage } from '@/lib/persistent-browser';
import { executeNode } from '@/lib/workflow/engine';
import type { NavigateParams, NodeDef, WorkflowContext } from '@/lib/workflow/types';
import { DEFAULT_HUMAN_OPTIONS } from '@/lib/workflow/human-options';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function isAdsNavigateNode(node: NodeDef): boolean {
  if (node.type !== 'navigate') return false;
  const params = (node.params ?? {}) as Partial<NavigateParams>;
  return Boolean(params.useAdsPower);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    node: NodeDef;
    vars?: Record<string, string>;
    humanOptions?: Record<string, boolean>;
  };

  const { node, vars = {}, humanOptions } = body;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let tempBrowser: Browser | undefined;

      function send(type: string, payload: string) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, payload })}\n\n`));
        } catch { /* client disconnected */ }
      }

      try {
        send('log', `🔧 调试节点：${node.label ?? node.type}`);

        let page: Page;

        if (isAdsNavigateNode(node)) {
          // Ads 导航节点直接从临时 page 起步，避免先卡在本地持久化草稿页启动。
          tempBrowser = await chromium.launch({ headless: true });
          page = await tempBrowser.newPage();
          send('log', '🫥 Ads 单节点调试：跳过本地草稿页，直接准备接管 Ads 浏览器');
        } else {
          // 普通节点继续使用持久草稿页（跨调用保持状态，实现接力）
          page = await getDebugScratchPage();
        }

        const currentUrl = page.url();
        send('log', `🌐 当前页面：${currentUrl || '(空白)'}`);

        const wfCtx: WorkflowContext = {
          vars: { ...vars, __pauseToken: 'scratch' },
          outputs: {},
          emit: send,
          humanOptions: { ...DEFAULT_HUMAN_OPTIONS, ...(humanOptions ?? {}) },
        };

        const result = await executeNode(page, node, wfCtx);

        if (result.newPage) {
          setDebugScratchPage(
            result.newPage as import('playwright').Page,
            (result.newBrowser as Browser | undefined)
          );
          send('log', `⚠️ [系统接管] (单节点调试) 游标已转移至新环境实例`);
          if (tempBrowser) {
            await tempBrowser.close().catch(() => {});
            tempBrowser = undefined;
          }
        }

        if (result.screenshot) {
          send('screenshot', result.screenshot);
        }

        send('log', result.success ? '✅ 节点执行成功' : `❌ 执行失败：${result.error ?? '未知'}`);
        send('done', JSON.stringify({
          success: result.success,
          error: result.error,
          result: { success: result.success, output: result.output },
          vars: Object.fromEntries(Object.entries(wfCtx.vars).filter(([key]) => key !== '__pauseToken')),
        }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        send('log', `❌ 执行异常：${msg}`);
        send('done', JSON.stringify({ success: false, error: msg }));
      } finally {
        if (tempBrowser) {
          await tempBrowser.close().catch(() => {});
        }
        controller.close();
        // 注意：不关闭草稿页，保留浏览器状态供下一个节点接力
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

/** GET：截取草稿页当前快照（不重新执行任何节点） */
export async function GET() {
  try {
    const page = await getDebugScratchPage();
    const buf = await page.screenshot({ type: 'jpeg', quality: 80 });
    const b64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
    return new Response(JSON.stringify({ screenshot: b64, url: page.url() }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/** DELETE：重置草稿页（清空浏览器状态，从头开始） */
export async function DELETE() {
  await resetDebugScratchPage();
  return new Response(JSON.stringify({ ok: true, message: '调试草稿页已重置' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
