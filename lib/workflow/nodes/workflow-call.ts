import type { Page } from 'playwright';
import { getWorkflow } from '../workflow-db';
import type { NodeResult, WorkflowCallParams, WorkflowContext } from '../types';

interface CallResult {
  index: number
  success: boolean
  vars: Record<string, string>
  outputs: Record<string, unknown>
  error?: string
  imageUrl?: string
}

function parsePositiveInt(input: unknown, fallback = 0): number {
  const n = Number(String(input ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function normalizeRuns(input: WorkflowCallParams['runs']): Array<Record<string, string>> {
  if (Array.isArray(input)) {
    return input.map(item => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(item ?? {})) out[k] = String(v ?? '');
      return out;
    });
  }
  if (typeof input === 'string' && input.trim()) {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => {
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(item ?? {})) out[k] = String(v ?? '');
          return out;
        });
      }
    } catch {
      // ignore parse error and fallback to empty
    }
  }
  return [];
}

function normalizeStringArray(input: WorkflowCallParams['instanceIds']): string[] {
  if (Array.isArray(input)) {
    return input.map(v => String(v ?? '').trim()).filter(Boolean);
  }
  if (typeof input === 'string' && input.trim()) {
    const raw = input.trim();
    if (raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.map(v => String(v ?? '').trim()).filter(Boolean);
        }
      } catch {
        // ignore parse error
      }
    }
    return raw
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);
  }
  return [];
}

function buildRunsFromCount(
  countInput: WorkflowCallParams['count'],
  instanceIdsInput: WorkflowCallParams['instanceIds'],
  promptVarNameInput: WorkflowCallParams['promptVarName'],
  ctxVars: Record<string, string>,
): Array<Record<string, string>> {
  const count = parsePositiveInt(countInput, 0);
  const instanceIds = normalizeStringArray(instanceIdsInput);
  if (count <= 0 || instanceIds.length === 0) return [];

  const promptVarName = String(promptVarNameInput || 'noteUrl').trim() || 'noteUrl';
  const promptValue = String(ctxVars[promptVarName] ?? '').trim();
  if (!promptValue) return [];

  const runs: Array<Record<string, string>> = [];
  for (let i = 0; i < count; i++) {
    runs.push({
      [promptVarName]: promptValue,
      browserInstanceId: instanceIds[i % instanceIds.length] || '',
      imageIndex: String(i + 1),
      imageCount: String(count),
    });
  }
  return runs;
}

function pickImageUrl(vars: Record<string, string>, outputs: Record<string, unknown>): string {
  if (typeof vars.imageUrl === 'string' && vars.imageUrl.trim()) return vars.imageUrl.trim();
  const maybe = outputs.imageUrl;
  if (typeof maybe === 'string' && maybe.trim()) return maybe.trim();
  return '';
}

async function hydrateBrowserWs(runVars: Record<string, string>): Promise<void> {
  const profileId = String(runVars.browserInstanceId || '').trim();
  if (runVars.browserWsUrl == null) runVars.browserWsUrl = '';
  if (!profileId || String(runVars.browserWsUrl || '').trim()) return;
  const apiBase = String(runVars.adsApiUrl || 'http://127.0.0.1:50325').trim() || 'http://127.0.0.1:50325';
  try {
    const url = new URL(`${apiBase}/api/v1/browser/active`);
    url.searchParams.set('user_id', profileId);
    const res = await fetch(url.toString());
    if (!res.ok) return;
    const data = await res.json() as { code?: number; data?: { status?: string; ws?: { puppeteer?: string } } };
    const ws = data?.data?.ws?.puppeteer?.trim();
    if (data?.code === 0 && data?.data?.status === 'Active' && ws) {
      runVars.browserWsUrl = ws;
    }
  } catch {
    // ignore ws hydration failure and fallback to downstream behavior
  }
}

export async function executeWorkflowCall(
  page: Page,
  params: WorkflowCallParams,
  ctx: WorkflowContext
): Promise<NodeResult> {
  const log: string[] = [];
  const workflowId = String(params.workflowId || '').trim();
  if (!workflowId) {
    return { success: false, log: ['❌ workflowId 不能为空'], error: 'workflowId is required' };
  }

  const target = await getWorkflow(workflowId).catch(() => null);
  if (!target) {
    return { success: false, log: [`❌ 子工作流不存在: ${workflowId}`], error: `workflow not found: ${workflowId}` };
  }

  const runs = normalizeRuns(params.runs);
  const autoRuns = buildRunsFromCount(params.count, params.instanceIds, params.promptVarName, ctx.vars);
  const runList = runs.length > 0 ? runs : [{}];
  const finalRunList = runs.length > 0 ? runs : (autoRuns.length > 0 ? autoRuns : runList);
  const inferredMaxConcurrency = autoRuns.length > 0
    ? Math.min(6, Math.max(1, normalizeStringArray(params.instanceIds).length))
    : finalRunList.length;
  const maxConcurrency = Math.max(1, Math.min(6, params.maxConcurrency ?? inferredMaxConcurrency));
  const minSuccess = Math.max(1, Math.min(finalRunList.length, params.minSuccess ?? finalRunList.length));
  const inheritVars = params.inheritVars ?? true;
  const outputVar = String(params.outputVar || 'workflowCallUrls').trim() || 'workflowCallUrls';
  const outputDetailVar = String(params.outputDetailVar || 'workflowCallResults').trim() || 'workflowCallResults';

  if (autoRuns.length > 0 && runs.length === 0) {
    const promptVarName = String(params.promptVarName || 'noteUrl').trim() || 'noteUrl';
    log.push(`🧠 自动分发模式：count=${autoRuns.length}，promptVar=${promptVarName}`);
  }
  ctx.emit?.('log', `🚀 工作流调用开始：${target.name}，并发=${maxConcurrency}，调用次数=${finalRunList.length}`);
  log.push(`🚀 工作流调用开始：${target.name}，并发=${maxConcurrency}，调用次数=${finalRunList.length}`);

  const { executeNode } = await import('../engine');
  for (const runVars of finalRunList) {
    await hydrateBrowserWs(runVars);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const results: CallResult[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(maxConcurrency, finalRunList.length) }, async () => {
    while (cursor < finalRunList.length) {
      const index = cursor++;
      const runVars = finalRunList[index];
      const prefix = `🧵 [子流程 ${index + 1}]`;
      const localPage = await page.context().newPage();
      let runtimePage: Page = localPage;
      const childCtx: WorkflowContext = {
        vars: inheritVars ? { ...ctx.vars, ...runVars } : { ...runVars },
        outputs: {},
        emit: (type, payload) => ctx.emit?.(type, `${prefix} ${payload}`),
        humanOptions: ctx.humanOptions,
      };

      try {
        ctx.emit?.('log', `${prefix} 启动`);
        for (const node of target.nodes) {
          const result = await executeNode(runtimePage, node, childCtx);
          if (result.output) Object.assign(childCtx.outputs, result.output);
          if (result.newPage) runtimePage = result.newPage as Page;
          if (!result.success && !node.continueOnError) {
            throw new Error(result.error || '子流程节点执行失败');
          }
        }
        const imageUrl = pickImageUrl(childCtx.vars, childCtx.outputs);
        results.push({
          index,
          success: true,
          vars: childCtx.vars,
          outputs: childCtx.outputs,
          imageUrl,
        });
        ctx.emit?.('log', `${prefix} 完成${imageUrl ? `，URL=${imageUrl}` : ''}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          index,
          success: false,
          vars: childCtx.vars,
          outputs: childCtx.outputs,
          error: message,
        });
        ctx.emit?.('log', `${prefix} 失败：${message}`);
      } finally {
        await localPage.close().catch(() => {});
      }
    }
  });

  await Promise.all(workers);
  results.sort((a, b) => a.index - b.index);
  const successItems = results.filter(item => item.success);
  const urls = successItems.map(item => item.imageUrl || '').filter(Boolean);
  const success = successItems.length >= minSuccess;

  ctx.vars[outputVar] = JSON.stringify(urls);
  ctx.vars[outputDetailVar] = JSON.stringify(results);
  log.push(`🧩 输出变量 ${outputVar} = ${JSON.stringify(urls)}`);
  log.push(`✅ 工作流调用完成：成功 ${successItems.length}/${finalRunList.length}，阈值=${minSuccess}`);

  return {
    success,
    log,
    error: success ? undefined : `子流程成功数不足：${successItems.length}/${finalRunList.length}（需要 ${minSuccess}）`,
    output: {
      successCount: successItems.length,
      totalCount: finalRunList.length,
      urls,
      results,
      [outputVar]: urls,
      [outputDetailVar]: results,
    },
  };
}
