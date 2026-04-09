'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { WorkflowDef } from '@/lib/workflow/types';

type LogEntry = {
  time: string;
  level: 'info' | 'success' | 'error';
  text: string;
};

type GenerateCase = 'single' | 'ads-multi' | 'ads-ai-pool';

type AdsRunInput = {
  browserInstanceId: string;
  prompt: string;
};

type InstanceState = 'idle' | 'busy' | 'inactive';

type InstancePoolStatus = {
  instanceId: string;
  state: InstanceState;
  tabOpen: boolean;
  active: boolean;
  locked: boolean;
  detail?: string;
};

type AdsPoolTask = {
  id: string;
  prompt: string;
  browserInstanceId?: string;
  sessionId?: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  imageUrl?: string;
  error?: string;
};

const AI_THEME_OPTIONS = [
  '品牌营销海报',
  '科技产品视觉',
  '时尚人像大片',
  '旅行城市风光',
  '美食商业摄影',
];

const AI_STYLE_OPTIONS = [
  '电影感写实',
  '极简高级感',
  '未来赛博朋克',
  '国潮插画',
  '杂志 editorial',
];

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN');
}

function addLog(setter: React.Dispatch<React.SetStateAction<LogEntry[]>>, text: string, level: LogEntry['level'] = 'info') {
  setter((prev) => [...prev, { time: nowTime(), text, level }]);
}

function isTransientStepError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes('load failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('fetch failed') ||
    lower.includes('networkerror') ||
    lower.includes('network error')
  );
}

function isUrlLike(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function maybeImageUrl(value: string) {
  const v = value.toLowerCase();
  return (
    isUrlLike(value) &&
    (/\.(png|jpg|jpeg|webp|gif|bmp|svg)(\?|$)/i.test(v) ||
      v.includes('oss-') ||
      v.includes('aliyuncs.com') ||
      v.includes('xhscdn.com'))
  );
}

function extractImageUrlsFromText(text: string): string[] {
  const raw = String(text || '');
  const matches = raw.match(/https?:\/\/[^\s)>"']+/g) || [];
  return matches
    .map((item) => item.replace(/[),.;]+$/g, '').trim())
    .filter((item) => maybeImageUrl(item));
}

function isAdsWorkflow(workflow: WorkflowDef): boolean {
  return workflow.nodes.some((node) => {
    if (node.type !== 'navigate') return false;
    const params = (node.params ?? {}) as Record<string, unknown>;
    return Boolean(params.useAdsPower);
  });
}

function pickPreferredWorkflow(workflows: WorkflowDef[], mode: GenerateCase): WorkflowDef | null {
  if (workflows.length === 0) return null;
  const adsNamed = workflows.find((w) => w.name === 'gemini流程管理-ads')
    || workflows.find((w) => w.name.includes('gemini流程管理-ads'));
  const plainNamed = workflows.find((w) => w.name === 'gemini流程管理')
    || workflows.find((w) => w.name.includes('gemini流程管理') && !w.name.includes('-ads'));

  if (mode === 'single') {
    return plainNamed
      || workflows.find((w) => !isAdsWorkflow(w))
      || workflows[0]
      || null;
  }

  return adsNamed
    || workflows.find((w) => isAdsWorkflow(w))
    || workflows[0]
    || null;
}

function collectImageUrls(input: unknown, target: Set<string>) {
  if (input == null) return;
  if (typeof input === 'string') {
    const value = input.trim();
    if (!value) return;
    if (maybeImageUrl(value)) {
      target.add(value);
      return;
    }
    if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('{') && value.endsWith('}'))) {
      try {
        collectImageUrls(JSON.parse(value), target);
      } catch {
        // ignore non-json strings
      }
    }
    return;
  }
  if (Array.isArray(input)) {
    input.forEach((item) => collectImageUrls(item, target));
    return;
  }
  if (typeof input === 'object') {
    Object.values(input as Record<string, unknown>).forEach((v) => collectImageUrls(v, target));
  }
}

async function runOneStep(
  sessionId: string,
  onLog: (line: string, level?: LogEntry['level']) => void,
  requestBody?: Record<string, unknown>,
): Promise<{ done: boolean; failed: boolean; vars?: Record<string, unknown>; output?: Record<string, unknown>; logUrls?: string[] }> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(`/api/workflow/session/${sessionId}/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody ?? {}),
      });
      if (!res.ok || !res.body) {
        throw new Error(`执行步骤失败（HTTP ${res.status}）`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let donePayload: { done?: boolean; failed?: boolean; vars?: Record<string, unknown>; result?: { output?: Record<string, unknown> } } | null = null;
      const logFoundUrls = new Set<string>();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let payload: { type?: string; payload?: string } | null = null;
          try {
            payload = JSON.parse(line.slice(6)) as { type?: string; payload?: string };
          } catch {
            continue;
          }
          if (!payload?.type) continue;

          if (payload.type === 'log' && payload.payload) {
            const text = payload.payload;
            const level: LogEntry['level'] = text.includes('❌') ? 'error' : text.includes('✅') ? 'success' : 'info';
            onLog(text, level);
            extractImageUrlsFromText(text).forEach((url) => logFoundUrls.add(url));
          } else if (payload.type === 'error' && payload.payload) {
            onLog(payload.payload, 'error');
            extractImageUrlsFromText(payload.payload).forEach((url) => logFoundUrls.add(url));
          } else if (payload.type === 'done' && payload.payload) {
            try {
              donePayload = JSON.parse(payload.payload);
            } catch {
              donePayload = null;
            }
          }
        }
      }

      return {
        done: Boolean(donePayload?.done),
        failed: Boolean(donePayload?.failed),
        vars: donePayload?.vars,
        output: donePayload?.result?.output,
        logUrls: Array.from(logFoundUrls),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const transient = isTransientStepError(message);
      if (transient && attempt < maxAttempts) {
        onLog(`⚠️ 步骤请求网络抖动（${message}），正在自动重试 ${attempt}/${maxAttempts - 1}`);
        await sleep(600 * attempt);
        continue;
      }
      throw new Error(`步骤执行请求失败：${message}`);
    }
  }
  throw new Error('步骤执行请求失败：未知错误');
}

async function cleanupSessionTab(sessionId: string, onLog: (line: string, level?: LogEntry['level']) => void) {
  try {
    const res = await fetch(`/api/workflow/session/${sessionId}`, { method: 'DELETE' });
    if (!res.ok) {
      onLog(`⚠️ 会话清理失败（HTTP ${res.status}）`, 'error');
      return;
    }
    const data = await res.json().catch(() => ({} as { keepPage?: boolean; keptLastTab?: boolean }));
    if (data?.keptLastTab) {
      onLog(`🧹 会话已清理（为防止分身退回 Inactive，保留最后一个 Tab）：${sessionId}`);
    } else if (data?.keepPage) {
      onLog(`🧹 会话已清理（当前环境配置保留页面，不关闭 Tab）：${sessionId}`);
    } else {
      onLog(`🧹 已清理会话并关闭新增 Tab：${sessionId}`, 'success');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onLog(`⚠️ 会话清理异常：${message}`, 'error');
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPoolStatuses(instanceIds: string[]): Promise<InstancePoolStatus[]> {
  const qs = encodeURIComponent(instanceIds.join(','));
  const res = await fetch(`/api/image-generate/ads-pool/status?instanceIds=${qs}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `加载实例池状态失败（HTTP ${res.status}）`);
  }
  return Array.isArray(data.instances) ? (data.instances as InstancePoolStatus[]) : [];
}

async function acquirePoolInstance(instanceId: string, jobId: string) {
  const res = await fetch('/api/image-generate/ads-pool/acquire', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId, jobId }),
  });
  const data = await res.json();
  if (!res.ok) return { ok: false, error: data?.reason || data?.error || `抢占失败（HTTP ${res.status}）`, leaseId: '' };
  return { ok: true, leaseId: String(data.leaseId || '') };
}

async function releasePoolInstance(instanceId: string, leaseId: string) {
  await fetch('/api/image-generate/ads-pool/release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId, leaseId }),
  }).catch(() => {});
}

export default function ImageGeneratePage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [workflowId, setWorkflowId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [generateCase, setGenerateCase] = useState<GenerateCase>('single');
  const [adsRuns, setAdsRuns] = useState<AdsRunInput[]>([
    { browserInstanceId: 'k1b908rw', prompt: '' },
    { browserInstanceId: 'k1ba8vac', prompt: '' },
  ]);
  const [instancePoolIds, setInstancePoolIds] = useState<string[]>(['k1b908rw', 'k1ba8vac']);
  const [instancePoolStatus, setInstancePoolStatus] = useState<InstancePoolStatus[]>([]);
  const [aiTheme, setAiTheme] = useState(AI_THEME_OPTIONS[0]);
  const [aiStyle, setAiStyle] = useState(AI_STYLE_OPTIONS[0]);
  const [aiPromptCount, setAiPromptCount] = useState(4);
  const [aiExtra, setAiExtra] = useState('');
  const [aiGeneratedPrompts, setAiGeneratedPrompts] = useState<string[]>([]);
  const [adsPoolTasks, setAdsPoolTasks] = useState<AdsPoolTask[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch('/api/workflows')
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d)) return;
        setWorkflows(d);
        const preferred = pickPreferredWorkflow(d as WorkflowDef[], 'single');
        if (preferred?.id) setWorkflowId(preferred.id);
      })
      .catch(() => setError('加载工作流失败'));
  }, []);

  useEffect(() => {
    if (workflows.length === 0) return;
    const current = workflows.find((w) => w.id === workflowId) || null;
    const expectedAds = generateCase !== 'single';
    const currentIsAds = current ? isAdsWorkflow(current) : null;
    const mismatch = !current || currentIsAds !== expectedAds;
    if (mismatch) {
      const preferred = pickPreferredWorkflow(workflows, generateCase);
      if (preferred?.id) {
        setWorkflowId((prev) => (prev === preferred.id ? prev : preferred.id));
      }
    }
  }, [generateCase, workflows, workflowId]);

  useEffect(() => {
    if (generateCase !== 'ads-ai-pool') return;
    let alive = true;

    const load = async () => {
      try {
        const statuses = await fetchPoolStatuses(instancePoolIds);
        if (!alive) return;
        setInstancePoolStatus(statuses);
      } catch {
        if (!alive) return;
        setInstancePoolStatus([]);
      }
    };

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [generateCase, instancePoolIds]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const selectedWorkflow = useMemo(
    () => workflows.find((w) => w.id === workflowId) || null,
    [workflows, workflowId]
  );

  async function executeOneSession(
    sid: string,
    onLog: (line: string, level?: LogEntry['level']) => void,
    options?: { autoRetryOnFailure?: boolean; maxRetries?: number },
  ): Promise<{ failed: boolean; urls: string[] }> {
    const retries = options?.autoRetryOnFailure ? Math.max(0, options?.maxRetries ?? 0) : 0;
    let attempt = 0;

    while (attempt <= retries) {
      if (attempt > 0) {
        onLog(`⚠️ 检测到流程不稳定：触发自动重试（第 ${attempt}/${retries} 次）`);
      }
      const foundUrls = new Set<string>();
      let done = false;
      let failed = false;
      let stepRequestError: string | null = null;
      let round = 0;
      let firstRequestBody: Record<string, unknown> | undefined =
        attempt > 0 ? { reset: true, stepIndex: 0 } : undefined;

      while (!done && !failed) {
        round += 1;
        onLog(`▶️ 开始执行第 ${round} 步...`);
        let step;
        try {
          step = await runOneStep(sid, onLog, firstRequestBody);
        } catch (error) {
          stepRequestError = error instanceof Error ? error.message : String(error);
          break;
        }
        firstRequestBody = undefined;
        collectImageUrls(step.output, foundUrls);
        collectImageUrls(step.vars, foundUrls);
        collectImageUrls(step.logUrls, foundUrls);
        setImageUrls((prev) => Array.from(new Set([...prev, ...Array.from(foundUrls)])));
        done = step.done;
        failed = step.failed;
      }

      if (stepRequestError) {
        if (attempt >= retries) {
          throw new Error(stepRequestError);
        }
        onLog(`♻️ 步骤请求中断，准备从第 1 步重新执行：${stepRequestError}`);
        attempt += 1;
        continue;
      }

      if (!failed) {
        return { failed: false, urls: Array.from(foundUrls) };
      }
      if (attempt >= retries) {
        return { failed: true, urls: Array.from(foundUrls) };
      }
      onLog('⏳ 检测到节点执行失败，3 秒后从第 1 步重试...');
      await sleep(3000);
      attempt += 1;
    }

    return { failed: true, urls: [] };
  }

  async function createSessionAndRun(
    vars: Record<string, string>,
    onLog: (line: string, level?: LogEntry['level']) => void
  ): Promise<{ sessionId: string; failed: boolean; urls: string[] }> {
    const sessionRes = await fetch('/api/workflow/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId, vars }),
    });
    const sessionData = await sessionRes.json();
    if (!sessionRes.ok || !sessionData?.sessionId) {
      throw new Error(sessionData?.error || `创建会话失败（HTTP ${sessionRes.status}）`);
    }
    const sid = sessionData.sessionId as string;
    onLog(`✅ 会话已创建：${sid}`, 'success');
    const result = await executeOneSession(sid, onLog, { autoRetryOnFailure: true, maxRetries: 2 });
    await cleanupSessionTab(sid, onLog);
    return { sessionId: sid, failed: result.failed, urls: result.urls };
  }

  async function generateAiPrompts() {
    setError('');
    setAiGeneratedPrompts([]);
    setAdsPoolTasks([]);
    addLog(setLogs, `🤖 正在生成提示词：主题=${aiTheme}，风格=${aiStyle}`);
    const res = await fetch('/api/image-generate/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: aiTheme, style: aiStyle, count: aiPromptCount, extra: aiExtra }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || `生成提示词失败（HTTP ${res.status}）`);
    }
    const prompts: string[] = Array.isArray(data.prompts)
      ? data.prompts.map((item: unknown) => String(item || '').trim()).filter(Boolean)
      : [];
    if (prompts.length === 0) {
      throw new Error('未生成有效提示词');
    }
    setAiGeneratedPrompts(prompts);
    setAdsPoolTasks(prompts.map((item, idx) => ({ id: `ai-${idx + 1}`, prompt: item, status: 'pending' })));
    addLog(setLogs, `✅ 已生成 ${prompts.length} 条提示词`, 'success');
  }

  async function runAdsPoolTasks(prompts: string[]) {
    const tasks: AdsPoolTask[] = prompts.map((item, idx) => ({ id: `ai-${idx + 1}`, prompt: item, status: 'pending' }));
    setAdsPoolTasks(tasks);
    const taskMap = new Map(tasks.map((item) => [item.id, item]));
    const sessionIds: string[] = [];
    const assignedLeases = new Map<string, { instanceId: string; leaseId: string }>();
    let queue = [...tasks];

    const updateTask = (taskId: string, patch: Partial<AdsPoolTask>) => {
      const current = taskMap.get(taskId);
      if (!current) return;
      const next = { ...current, ...patch };
      taskMap.set(taskId, next);
      setAdsPoolTasks(Array.from(taskMap.values()));
    };

    const worker = async (task: AdsPoolTask, instanceId: string, leaseId: string) => {
      updateTask(task.id, { status: 'running', browserInstanceId: instanceId });
      const tag = `🧵 [${task.id} ${instanceId}]`;
      const logger = (line: string, level: LogEntry['level'] = 'info') => addLog(setLogs, `${tag} ${line}`, level);
      try {
        const vars: Record<string, string> = {
          prompt: task.prompt,
          userPrompt: task.prompt,
          noteUrl: task.prompt,
          note_url: task.prompt,
          text: task.prompt,
          input: task.prompt,
          prompts: JSON.stringify([task.prompt]),
          browserInstanceId: instanceId,
          browserWsUrl: '',
        };
        const result = await createSessionAndRun(vars, logger);
        sessionIds.push(result.sessionId);
        if (result.failed || result.urls.length === 0) {
          updateTask(task.id, { status: 'failed', sessionId: result.sessionId, error: '执行失败或未产出图片' });
          return;
        }
        updateTask(task.id, { status: 'success', sessionId: result.sessionId, imageUrl: result.urls[0] });
        setImageUrls((prev) => Array.from(new Set([...prev, ...result.urls])));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateTask(task.id, { status: 'failed', error: message });
      } finally {
        await releasePoolInstance(instanceId, leaseId);
        assignedLeases.delete(task.id);
      }
    };

    while (queue.length > 0) {
      const statuses = await fetchPoolStatuses(instancePoolIds);
      setInstancePoolStatus(statuses);
      const idleInstances = statuses.filter((item) => item.state === 'idle').map((item) => item.instanceId);
      if (idleInstances.length === 0) {
        addLog(setLogs, '⏳ 实例池无空闲实例，等待 2 秒后重试调度');
        await sleep(2000);
        continue;
      }

      const current = queue.shift();
      if (!current) break;
      let allocated = false;
      for (const instanceId of idleInstances) {
        const leaseRes = await acquirePoolInstance(instanceId, current.id);
        if (!leaseRes.ok || !leaseRes.leaseId) continue;
        assignedLeases.set(current.id, { instanceId, leaseId: leaseRes.leaseId });
        addLog(setLogs, `📌 ${current.id} 已分配实例 ${instanceId}`, 'success');
        void worker(current, instanceId, leaseRes.leaseId);
        allocated = true;
        break;
      }
      if (!allocated) {
        queue = [current, ...queue];
        await sleep(1200);
      }
    }

    while (Array.from(taskMap.values()).some((item) => item.status === 'running')) {
      await sleep(1000);
    }
    const finalTasks = Array.from(taskMap.values());
    setAdsPoolTasks(finalTasks);
    setSessionId(sessionIds.join(', '));
    const failed = finalTasks.filter((item) => item.status === 'failed').length;
    if (failed > 0) {
      addLog(setLogs, `⚠️ 实例池执行完成：失败 ${failed}/${finalTasks.length}`, 'error');
    } else {
      addLog(setLogs, `✅ 实例池执行完成：全部成功 (${finalTasks.length})`, 'success');
    }
  }

  async function handleCreateImage() {
    if (!workflowId) return;
    setRunning(true);
    setError('');
    setLogs([]);
    setImageUrls([]);
    setSessionId(null);

    try {
      if (!selectedWorkflow) {
        throw new Error('未找到可执行工作流，请刷新页面后重试');
      }
      const selectedIsAds = isAdsWorkflow(selectedWorkflow);
      if (generateCase === 'single' && selectedIsAds) {
        throw new Error('通用单流程当前绑定的是 Ads 工作流，请切到非 Ads 工作流后再执行');
      }
      if (generateCase !== 'single' && !selectedIsAds) {
        throw new Error('Ads 模式当前绑定的是非 Ads 工作流，请切到 gemini流程管理-ads 后再执行');
      }

      if (generateCase === 'single') {
        if (!prompt.trim()) return;
        addLog(setLogs, '🚀 创建工作流会话...');
        const normalizedPrompt = prompt.trim();
        const vars: Record<string, string> = {
          prompt: normalizedPrompt,
          userPrompt: normalizedPrompt,
          noteUrl: normalizedPrompt,
          note_url: normalizedPrompt,
          text: normalizedPrompt,
          input: normalizedPrompt,
          prompts: JSON.stringify([normalizedPrompt]),
        };
        addLog(setLogs, '🧩 本次工作流入参:');
        Object.entries(vars).forEach(([key, value]) => addLog(setLogs, `  - ${key} = ${value}`));
        const result = await createSessionAndRun(vars, (line, level = 'info') => addLog(setLogs, line, level));
        setSessionId(result.sessionId);
        if (result.failed) {
          addLog(setLogs, '❌ 工作流执行失败，请查看日志', 'error');
        } else {
          addLog(setLogs, '✅ 工作流执行完成', 'success');
        }
      } else if (generateCase === 'ads-multi') {
        const runs = adsRuns
          .map((item) => ({ browserInstanceId: item.browserInstanceId.trim(), prompt: item.prompt.trim() }))
          .filter((item) => item.browserInstanceId && item.prompt);
        if (runs.length === 0) {
          throw new Error('请至少填写一组“浏览器实例ID + 提示词”');
        }
        addLog(setLogs, `🚀 Ads 并行模式启动，共 ${runs.length} 组`, 'success');
        const settled = await Promise.allSettled(
          runs.map(async (item, idx) => {
            const tag = `🧵 [第${idx + 1}组 ${item.browserInstanceId}]`;
            const logger = (line: string, level: LogEntry['level'] = 'info') => addLog(setLogs, `${tag} ${line}`, level);
            const vars: Record<string, string> = {
              prompt: item.prompt,
              userPrompt: item.prompt,
              noteUrl: item.prompt,
              note_url: item.prompt,
              text: item.prompt,
              input: item.prompt,
              prompts: JSON.stringify([item.prompt]),
              browserInstanceId: item.browserInstanceId,
              browserWsUrl: '',
            };
            logger('创建工作流会话...');
            const result = await createSessionAndRun(vars, logger);
            return { ...result, browserInstanceId: item.browserInstanceId, error: '' };
          })
        );
        const results = settled.map((entry, idx) => {
          if (entry.status === 'fulfilled') return entry.value;
          const item = runs[idx];
          const message = entry.reason instanceof Error ? entry.reason.message : String(entry.reason);
          addLog(setLogs, `🧵 [第${idx + 1}组 ${item.browserInstanceId}] ❌ ${message}`, 'error');
          return {
            sessionId: '',
            failed: true,
            urls: [],
            browserInstanceId: item.browserInstanceId,
            error: message,
          };
        });
        const finalizedResults = results.map((item, idx) => {
          if (!item.failed && item.urls.length === 0) {
            const run = runs[idx];
            addLog(
              setLogs,
              `🧵 [第${idx + 1}组 ${run.browserInstanceId}] ⚠️ 未采集到图片 URL，本组按失败处理（可能是步骤回包中断）`,
              'error'
            );
            return { ...item, failed: true, error: item.error || '未采集到图片 URL' };
          }
          return item;
        });
        const mergedUrls = Array.from(
          new Set(
            finalizedResults.flatMap((item) => item.urls).filter(Boolean)
          )
        );
        setImageUrls(mergedUrls);
        const successSessionIds = finalizedResults.map((item) => item.sessionId).filter(Boolean);
        setSessionId(successSessionIds.length > 0 ? successSessionIds.join(', ') : null);
        const failedCount = finalizedResults.filter((item) => item.failed).length;
        if (failedCount > 0) {
          addLog(setLogs, `❌ Ads 并行执行完成：失败 ${failedCount} 组`, 'error');
        } else {
          addLog(setLogs, `✅ Ads 并行执行完成：全部成功 (${finalizedResults.length} 组)`, 'success');
        }
      } else {
        const prompts = aiGeneratedPrompts.map((item) => item.trim()).filter(Boolean);
        if (prompts.length === 0) {
          throw new Error('请先生成提示词');
        }
        const poolIds = instancePoolIds.map((item) => item.trim()).filter(Boolean);
        if (poolIds.length === 0) {
          throw new Error('实例池不能为空');
        }
        addLog(setLogs, `🚀 启动实例池调度，共 ${prompts.length} 条提示词，实例池 ${poolIds.length} 个`);
        await runAdsPoolTasks(prompts);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      addLog(setLogs, `❌ ${msg}`, 'error');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">图片生成</h1>
        <p className="text-sm text-muted-foreground mt-1">输入提示词，调用 Gemini 工作流生成图片并回显 URL。</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">生成 Case</label>
            <select
              value={generateCase}
              onChange={(e) => setGenerateCase(e.target.value as GenerateCase)}
              className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
            >
              <option value="single">通用单流程</option>
              <option value="ads-multi">Ads 工作流（多组并行）</option>
              <option value="ads-ai-pool">Ads 实例池（AI 提示词）</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">关联工作流</label>
            <select
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
            >
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="text-xs text-muted-foreground flex items-end">
            {selectedWorkflow
              ? `${generateCase === 'ads-multi' ? 'Ads 并行模式' : generateCase === 'ads-ai-pool' ? 'Ads 实例池模式' : '普通模式'} · 节点数：${selectedWorkflow.nodes.length}`
              : '暂无可用工作流'}
          </div>
        </div>

        {generateCase === 'single' ? (
          <div>
            <label className="block text-xs text-muted-foreground mb-1">提示词</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="例如：赛博朋克风格，夜晚街道，电影光影，8k"
              className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm resize-y"
            />
          </div>
        ) : generateCase === 'ads-multi' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs text-muted-foreground">Ads 任务组（浏览器实例ID + 提示词）</label>
              <button
                type="button"
                onClick={() => setAdsRuns((prev) => [...prev, { browserInstanceId: '', prompt: '' }])}
                className="px-2.5 py-1 text-xs rounded-md border border-border hover:bg-muted"
              >
                新增一组
              </button>
            </div>
            <div className="space-y-2">
              {adsRuns.map((item, idx) => (
                <div key={`${idx}-${item.browserInstanceId}`} className="grid md:grid-cols-[220px_1fr_auto] gap-2">
                  <input
                    value={item.browserInstanceId}
                    onChange={(e) =>
                      setAdsRuns((prev) =>
                        prev.map((row, rowIdx) =>
                          rowIdx === idx ? { ...row, browserInstanceId: e.target.value } : row
                        )
                      )
                    }
                    placeholder="例如：k1b908rw"
                    className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
                  />
                  <input
                    value={item.prompt}
                    onChange={(e) =>
                      setAdsRuns((prev) =>
                        prev.map((row, rowIdx) => (rowIdx === idx ? { ...row, prompt: e.target.value } : row))
                      )
                    }
                    placeholder="输入该实例对应的提示词"
                    className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setAdsRuns((prev) => prev.filter((_, rowIdx) => rowIdx !== idx))}
                    disabled={adsRuns.length <= 1}
                    className="px-2.5 py-1 text-xs rounded-md border border-border hover:bg-muted disabled:opacity-50"
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid md:grid-cols-4 gap-2">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">主题</label>
                <select
                  value={aiTheme}
                  onChange={(e) => setAiTheme(e.target.value)}
                  className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
                >
                  {AI_THEME_OPTIONS.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">风格</label>
                <select
                  value={aiStyle}
                  onChange={(e) => setAiStyle(e.target.value)}
                  className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
                >
                  {AI_STYLE_OPTIONS.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">提示词数量</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={aiPromptCount}
                  onChange={(e) => setAiPromptCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                  className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => void generateAiPrompts()}
                  disabled={running}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted disabled:opacity-50"
                >
                  生成提示词
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">补充要求（可选）</label>
              <input
                value={aiExtra}
                onChange={(e) => setAiExtra(e.target.value)}
                placeholder="例如：适合社媒投放，主体突出，文字留白"
                className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs text-muted-foreground">浏览器实例池（逗号分隔）</label>
                <span className="text-xs text-muted-foreground">Tab 打开=工作中，关闭=空闲</span>
              </div>
              <input
                value={instancePoolIds.join(', ')}
                onChange={(e) =>
                  setInstancePoolIds(
                    e.target.value
                      .split(',')
                      .map((item) => item.trim())
                      .filter(Boolean)
                  )
                }
                className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
              />
              <div className="mt-2 grid md:grid-cols-2 gap-2">
                {instancePoolStatus.map((item) => (
                  <div key={item.instanceId} className="rounded-lg border border-border px-3 py-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-mono">{item.instanceId}</span>
                      <span className={item.state === 'idle' ? 'text-green-500' : item.state === 'busy' ? 'text-amber-500' : 'text-zinc-500'}>
                        {item.state === 'idle' ? '空闲' : item.state === 'busy' ? '工作中' : '未激活'}
                      </span>
                    </div>
                    <div className="text-muted-foreground mt-1">
                      tab: {item.tabOpen ? '打开' : '关闭'} · lock: {item.locked ? '是' : '否'}
                    </div>
                  </div>
                ))}
                {instancePoolStatus.length === 0 && (
                  <div className="text-xs text-muted-foreground">暂无实例状态，请确认实例池配置。</div>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">已生成提示词</label>
              <div className="space-y-2 max-h-40 overflow-auto border border-border rounded-lg p-2">
                {aiGeneratedPrompts.length === 0 ? (
                  <div className="text-xs text-muted-foreground">先点击“生成提示词”。</div>
                ) : (
                  aiGeneratedPrompts.map((item, idx) => (
                    <div key={`${idx}-${item}`} className="text-xs border border-border rounded px-2 py-1">
                      <span className="text-muted-foreground mr-2">#{idx + 1}</span>
                      {item}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleCreateImage()}
            disabled={
              running ||
              !workflowId ||
              (generateCase === 'single'
                ? !prompt.trim()
                : generateCase === 'ads-multi'
                  ? adsRuns.every((item) => !item.browserInstanceId.trim() || !item.prompt.trim())
                  : aiGeneratedPrompts.length === 0 || instancePoolIds.length === 0)
            }
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-white disabled:opacity-50"
          >
            {running
              ? '生成中...'
              : generateCase === 'single'
                ? '创建图片'
                : generateCase === 'ads-multi'
                  ? '并行生成图片'
                  : '实例池批量生成'}
          </button>
          {sessionId && <span className="text-xs text-muted-foreground">session: {sessionId}</span>}
          {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">执行日志</h2>
          <div className="h-[420px] overflow-auto rounded-lg bg-black/90 p-3 font-mono text-xs space-y-1">
            {logs.length === 0 ? (
              <div className="text-zinc-500">等待执行...</div>
            ) : (
              logs.map((log, idx) => (
                <div
                  key={idx}
                  className={
                    log.level === 'error' ? 'text-red-400' : log.level === 'success' ? 'text-green-400' : 'text-zinc-300'
                  }
                >
                  <span className="text-zinc-500 mr-2">[{log.time}]</span>
                  {log.text}
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold mb-3">生成图片 URL</h2>
          {generateCase === 'ads-ai-pool' && (
            <div className="mb-3 space-y-2 max-h-56 overflow-auto">
              {adsPoolTasks.length === 0 ? (
                <div className="text-xs text-muted-foreground">提示词任务结果会显示在这里。</div>
              ) : (
                adsPoolTasks.map((task) => (
                  <div key={task.id} className="rounded-lg border border-border p-2 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{task.id}</span>
                      <span className={
                        task.status === 'success'
                          ? 'text-green-500'
                          : task.status === 'failed'
                            ? 'text-red-500'
                            : task.status === 'running'
                              ? 'text-blue-500'
                              : 'text-muted-foreground'
                      }>
                        {task.status}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      实例：{task.browserInstanceId || '-'}
                    </div>
                    <div className="text-xs">{task.prompt}</div>
                    {task.imageUrl && (
                      <a href={task.imageUrl} target="_blank" rel="noreferrer" className="text-xs text-primary break-all hover:underline">
                        {task.imageUrl}
                      </a>
                    )}
                    {task.error && <div className="text-xs text-red-500">{task.error}</div>}
                  </div>
                ))
              )}
            </div>
          )}
          <div className="space-y-3 max-h-[420px] overflow-auto">
            {imageUrls.length === 0 ? (
              <div className="text-sm text-muted-foreground">暂无图片 URL</div>
            ) : (
              imageUrls.map((url, idx) => (
                <div key={url} className="border border-border rounded-lg p-3 space-y-2">
                  <div className="text-xs text-muted-foreground">图片 {idx + 1}</div>
                  <button
                    onClick={() => setPreviewUrl(url)}
                    className="w-full block overflow-hidden rounded-lg border border-border bg-muted/20"
                  >
                    <img src={url} alt={`生成图片 ${idx + 1}`} className="w-full h-40 object-cover" loading="lazy" />
                  </button>
                  <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary break-all hover:underline">
                    {url}
                  </a>
                  <div className="flex gap-2">
                    <button
                      onClick={() => navigator.clipboard.writeText(url)}
                      className="px-2.5 py-1 text-xs rounded-md border border-border hover:bg-muted"
                    >
                      复制 URL
                    </button>
                    <button
                      onClick={() => setPreviewUrl(url)}
                      className="px-2.5 py-1 text-xs rounded-md border border-border hover:bg-muted"
                    >
                      预览
                    </button>
                    <button
                      onClick={() => router.push(`/publish?ossUrl=${encodeURIComponent(url)}&title=${encodeURIComponent(prompt.slice(0, 30) || `图片${idx + 1}`)}`)}
                      className="px-2.5 py-1 text-xs rounded-md border border-border hover:bg-muted"
                    >
                      去发布页
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <img
            src={previewUrl}
            alt="预览图片"
            onClick={(e) => e.stopPropagation()}
            className="max-w-[95vw] max-h-[90vh] object-contain rounded-xl border border-border bg-black"
          />
        </div>
      )}
    </div>
  );
}
