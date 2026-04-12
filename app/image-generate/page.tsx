'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { WorkflowDef } from '@/lib/workflow/types';

type LogEntry = {
  time: string;
  level: 'info' | 'success' | 'error';
  text: string;
};

type GenerateCase = 'single' | 'ads-multi' | 'ads-ai-pool' | 'ads-ha-10';

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
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  mediaUrl?: string;
  mediaType?: string;
  imageUrl?: string;
  error?: string;
  attempts?: number;
  batchTaskId?: string;
  startedAt?: string;
  endedAt?: string;
};

type DispatcherSummary = {
  total: number;
  pending: number;
  running: number;
  success: number;
  failed: number;
  cancelled: number;
};

type DispatcherInstanceCard = {
  instanceId: string;
  state: 'idle' | 'running' | 'inactive' | 'busy';
  currentItemId?: string;
  currentPrompt?: string;
  batchTaskId?: string;
  startedAt?: string;
  lastReleasedAt?: string;
  lastCompletedItemId?: string;
  lastResultStatus?: 'success' | 'failed' | 'cancelled';
  lastMediaUrl?: string | null;
  lastMediaType?: string | null;
  lastImageUrl?: string | null;
  lastError?: string;
  detail?: string;
};

type StoryBible = {
  title: string;
  overview: string;
  world: string;
  protagonist: string;
  supportingCast: string;
  visualStyle: string;
  continuityRules: string[];
};

type StoryScene = {
  id: string;
  index: number;
  title: string;
  paragraph: string;
  storyBeat: string;
  prompt: string;
  negativePrompt: string;
  styleNotes: string;
  continuityNotes: string;
};

const AI_THEME_OPTIONS = [
  '童话森林冒险',
  '月光海岸奇旅',
  '蒸汽城堡传说',
  '治愈系绘本村庄',
  '东方奇幻神话',
  '少女魔法花园',
];

const AI_STYLE_OPTIONS = [
  '宫崎骏式温柔童话插画',
  '高端绘本叙事插画',
  '电影感奇幻概念艺术',
  '国潮神话插图',
  '梦幻水彩儿童绘本',
  '复古油画质感插画',
];

const HA_DEFAULT_INSTANCE_IDS = ['k1b908rw', 'k1bdaoa7', 'k1ba8vac'];

const HA_DEFAULT_PROMPTS = [
  '赛博朋克城市夜景，霓虹灯，电影感，8k',
  '北欧极简客厅，清晨自然光，写实摄影，高级质感',
  '情侣校园散步，电影感，8k',
  '秋日森林木屋，阳光透过树叶，写实摄影',
  '未来感电商产品主视觉，悬浮平台，体积光',
  '海边日落人像，胶片颗粒，暖色调',
  '现代办公室团队协作场景，明亮自然光，商业摄影',
  '国潮风神兽插画，细节丰富，海报构图',
  '极简白色厨房空间，杂志风室内摄影',
  '雨夜街头反光路面，电影级光影，广角镜头',
];

function normalizePromptLines(lines: string[]) {
  return lines.map((item) => item.trim()).filter(Boolean);
}

function timeAgoLabel(value?: string) {
  if (!value) return '-';
  const diff = Date.now() - Date.parse(value);
  if (!Number.isFinite(diff) || diff < 0) return '-';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s 前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m 前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h 前`;
  return `${Math.floor(hours / 24)}d 前`;
}

function taskStatusLabel(status: AdsPoolTask['status']) {
  switch (status) {
    case 'success':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    case 'running':
      return '执行中';
    default:
      return '排队中';
  }
}

function taskStatusClass(status: AdsPoolTask['status']) {
  switch (status) {
    case 'success':
      return 'bg-emerald-50 text-emerald-600 border-emerald-200';
    case 'failed':
      return 'bg-rose-50 text-rose-600 border-rose-200';
    case 'cancelled':
      return 'bg-zinc-100 text-zinc-600 border-zinc-200';
    case 'running':
      return 'bg-sky-50 text-sky-600 border-sky-200';
    default:
      return 'bg-amber-50 text-amber-700 border-amber-200';
  }
}

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
    (/\.(png|jpg|jpeg|webp|gif|bmp|svg|mp4|webm|mov|m4v)(\?|$)/i.test(v) ||
      v.includes('oss-') ||
      v.includes('aliyuncs.com') ||
      v.includes('xhscdn.com'))
  );
}

function inferMediaKind(url: string, mimeType?: string | null): 'image' | 'video' | 'unknown' {
  const value = String(url || '').toLowerCase();
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(value)) return 'video';
  if (/\.(png|jpg|jpeg|webp|gif|bmp|svg|avif)(\?|$)/i.test(value)) return 'image';
  return 'unknown';
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

function ImageGeneratePageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [workflowId, setWorkflowId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [generateCase, setGenerateCase] = useState<GenerateCase>('single');
  const [adsRuns, setAdsRuns] = useState<AdsRunInput[]>([
    { browserInstanceId: 'k1b908rw', prompt: '' },
    { browserInstanceId: 'k1bdaoa7', prompt: '' },
  ]);
  const [instancePoolIds, setInstancePoolIds] = useState<string[]>(['k1b908rw', 'k1bdaoa7', 'k1ba8vac']);
  const [instancePoolStatus, setInstancePoolStatus] = useState<InstancePoolStatus[]>([]);
  const [aiTheme, setAiTheme] = useState(AI_THEME_OPTIONS[0]);
  const [aiStyle, setAiStyle] = useState(AI_STYLE_OPTIONS[0]);
  const [aiPromptCount, setAiPromptCount] = useState(4);
  const [aiExtra, setAiExtra] = useState('');
  const [aiStoryBible, setAiStoryBible] = useState<StoryBible | null>(null);
  const [aiStoryScenes, setAiStoryScenes] = useState<StoryScene[]>([]);
  const [aiGeneratingPrompts, setAiGeneratingPrompts] = useState(false);
  const [aiRefreshingSceneId, setAiRefreshingSceneId] = useState<string | null>(null);
  const [adsPoolTasks, setAdsPoolTasks] = useState<AdsPoolTask[]>([]);
  const [dispatcherPrompts, setDispatcherPrompts] = useState<string[]>(HA_DEFAULT_PROMPTS);
  const [dispatcherInstanceIds, setDispatcherInstanceIds] = useState<string[]>(HA_DEFAULT_INSTANCE_IDS);
  const [dispatcherTaskId, setDispatcherTaskId] = useState<string | null>(null);
  const [dispatcherSummary, setDispatcherSummary] = useState<DispatcherSummary | null>(null);
  const [dispatcherInstances, setDispatcherInstances] = useState<DispatcherInstanceCard[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMediaType, setPreviewMediaType] = useState<'image' | 'video' | 'unknown'>('image');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const dispatcherLastStatusRef = useRef<string | null>(null);
  const isVisualStoryModule = pathname === '/visual-story' || searchParams.get('mode') === 'ads-ai-pool';

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
    if (!isVisualStoryModule) return;
    setGenerateCase('ads-ai-pool');
    setInstancePoolIds((prev) => (prev.length > 0 ? prev : HA_DEFAULT_INSTANCE_IDS));
  }, [isVisualStoryModule]);

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

  useEffect(() => {
    if (!dispatcherTaskId) return;
    let alive = true;

    const poll = async () => {
      try {
        const res = await fetch(`/api/gemini-web/image/ads-dispatcher/tasks/${dispatcherTaskId}`);
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) {
          throw new Error(data?.error || `调度任务查询失败（HTTP ${res.status}）`);
        }

        const urls: string[] = Array.isArray(data?.result?.mediaUrls)
          ? data.result.mediaUrls.filter((item: unknown) => typeof item === 'string')
          : Array.isArray(data?.result?.imageUrls)
            ? data.result.imageUrls.filter((item: unknown) => typeof item === 'string')
          : [];
        const items: AdsPoolTask[] = Array.isArray(data?.result?.items)
          ? data.result.items.map((item: Record<string, unknown>) => ({
              id: String(item.id || ''),
              prompt: String(item.prompt || ''),
              browserInstanceId: String(item.browserInstanceId || ''),
              status: String(item.status || 'pending') as AdsPoolTask['status'],
              mediaUrl: String(item.primaryMediaUrl || item.primaryImageUrl || ''),
              mediaType: String(item.primaryMediaType || ''),
              imageUrl: String(item.primaryImageUrl || ''),
              error: String(item.error || ''),
              attempts: Number(item.attempts || 0),
              batchTaskId: String(item.batchTaskId || ''),
              startedAt: String(item.startedAt || ''),
              endedAt: String(item.endedAt || ''),
            }))
          : [];

        setImageUrls(urls);
        setAdsPoolTasks(items);
        setDispatcherSummary(data?.summary ?? null);
        setDispatcherInstances(Array.isArray(data?.instances) ? (data.instances as DispatcherInstanceCard[]) : []);

        const status = String(data?.status || '');
        if (dispatcherLastStatusRef.current !== status) {
          dispatcherLastStatusRef.current = status;
          if (status === 'running') {
            addLog(setLogs, `🧭 调度器运行中：${dispatcherTaskId}`);
          } else if (status === 'success') {
            addLog(setLogs, `✅ 调度器完成：成功 ${data?.summary?.success || 0}/${data?.summary?.total || 0}`, 'success');
          } else if (status === 'failed') {
            addLog(setLogs, `⚠️ 调度器结束：成功 ${data?.summary?.success || 0}/${data?.summary?.total || 0}`, 'error');
          } else if (status === 'cancelled') {
            addLog(setLogs, '⛔ 调度器已取消', 'error');
          }
        }

        if (data?.done) {
          setRunning(false);
        } else {
          window.setTimeout(() => {
            void poll();
          }, 1800);
        }
      } catch (error) {
        if (!alive) return;
        const message = error instanceof Error ? error.message : String(error);
        setError(message);
        setRunning(false);
        addLog(setLogs, `❌ ${message}`, 'error');
      }
    };

    void poll();
    return () => {
      alive = false;
    };
  }, [dispatcherTaskId]);

  const selectedWorkflow = useMemo(
    () => workflows.find((w) => w.id === workflowId) || null,
    [workflows, workflowId]
  );

  const liveDispatcherInstances = useMemo<DispatcherInstanceCard[]>(
    () =>
      dispatcherInstances.length > 0
        ? dispatcherInstances
        : dispatcherInstanceIds.map((instanceId) => ({
            instanceId,
            state: 'idle',
            lastImageUrl: null,
          })),
    [dispatcherInstances, dispatcherInstanceIds]
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
    setAiStoryBible(null);
    setAiStoryScenes([]);
    setAdsPoolTasks([]);
    setAiGeneratingPrompts(true);
    addLog(setLogs, `📚 正在生成故事化提示词队列：主题=${aiTheme}，风格=${aiStyle}`);
    try {
      const res = await fetch('/api/image-generate/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: aiTheme, style: aiStyle, count: aiPromptCount, extra: aiExtra }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `生成提示词失败（HTTP ${res.status}）`);
      }
      const scenes: StoryScene[] = Array.isArray(data.scenes)
        ? data.scenes.map((item: Record<string, unknown>, idx: number) => ({
            id: String(item.id || `scene-${idx + 1}`),
            index: Number(item.index ?? idx),
            title: String(item.title || `分镜 ${idx + 1}`),
            paragraph: String(item.paragraph || ''),
            storyBeat: String(item.storyBeat || item.paragraph || ''),
            prompt: String(item.prompt || ''),
            negativePrompt: String(item.negativePrompt || ''),
            styleNotes: String(item.styleNotes || ''),
            continuityNotes: String(item.continuityNotes || ''),
          }))
        : [];
      const prompts = scenes.map((item) => item.prompt.trim()).filter(Boolean);
      if (prompts.length === 0) {
        throw new Error('未生成有效提示词');
      }
      if (data.bible && typeof data.bible === 'object') {
        setAiStoryBible({
          title: String((data.bible as Record<string, unknown>).title || ''),
          overview: String((data.bible as Record<string, unknown>).overview || ''),
          world: String((data.bible as Record<string, unknown>).world || ''),
          protagonist: String((data.bible as Record<string, unknown>).protagonist || ''),
          supportingCast: String((data.bible as Record<string, unknown>).supportingCast || ''),
          visualStyle: String((data.bible as Record<string, unknown>).visualStyle || ''),
          continuityRules: Array.isArray((data.bible as Record<string, unknown>).continuityRules)
            ? ((data.bible as Record<string, unknown>).continuityRules as unknown[]).map((item) => String(item || '')).filter(Boolean)
            : [],
        });
      }
      setAiStoryScenes(scenes);
      setAdsPoolTasks(prompts.map((item, idx) => ({ id: `ai-${idx + 1}`, prompt: item, status: 'pending' })));
      addLog(setLogs, `✅ 已生成 ${prompts.length} 条连续分镜提示词`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      addLog(setLogs, `❌ ${message}`, 'error');
    } finally {
      setAiGeneratingPrompts(false);
    }
  }

  async function refreshAiScene(scene: StoryScene) {
    if (!aiStoryBible) return;
    setAiRefreshingSceneId(scene.id);
    setError('');
    addLog(setLogs, `🪄 正在重写分镜 ${scene.index + 1}：${scene.title}`);
    try {
      const res = await fetch('/api/image-generate/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: aiTheme,
          style: aiStyle,
          count: aiPromptCount,
          extra: aiExtra,
          currentBible: aiStoryBible,
          currentScenes: aiStoryScenes,
          targetSceneIndex: scene.index,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.scene) {
        throw new Error(data?.error || `刷新分镜失败（HTTP ${res.status}）`);
      }
      const nextScene: StoryScene = {
        id: String(data.scene.id || scene.id),
        index: Number(data.scene.index ?? scene.index),
        title: String(data.scene.title || scene.title),
        paragraph: String(data.scene.paragraph || scene.paragraph),
        storyBeat: String(data.scene.storyBeat || scene.storyBeat),
        prompt: String(data.scene.prompt || scene.prompt),
        negativePrompt: String(data.scene.negativePrompt || scene.negativePrompt),
        styleNotes: String(data.scene.styleNotes || scene.styleNotes),
        continuityNotes: String(data.scene.continuityNotes || scene.continuityNotes),
      };
      setAiStoryScenes((prev) => prev.map((item) => (item.id === scene.id ? nextScene : item)));
      addLog(setLogs, `✅ 已刷新分镜 ${scene.index + 1}`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      addLog(setLogs, `❌ ${message}`, 'error');
    } finally {
      setAiRefreshingSceneId(null);
    }
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

  async function cancelDispatcherTask() {
    if (!dispatcherTaskId) return;
    try {
      const res = await fetch(`/api/gemini-web/image/ads-dispatcher/tasks/${dispatcherTaskId}/cancel`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `取消调度器失败（HTTP ${res.status}）`);
      }
      addLog(setLogs, `⛔ 已请求取消调度任务：${dispatcherTaskId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      addLog(setLogs, `❌ ${message}`, 'error');
    }
  }

  async function createDispatcherTask(prompts: string[], poolIds: string[], sourceLabel: string) {
    addLog(setLogs, `🚀 ${sourceLabel}：${prompts.length} 条提示词，${poolIds.length} 个默认实例`);
    const createRes = await fetch('/api/gemini-web/image/ads-dispatcher', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompts,
        instanceIds: poolIds,
        maxAttemptsPerPrompt: 6,
        childTaskTimeoutMs: 8 * 60 * 1000,
        pollIntervalMs: 2000,
        workflowId,
        autoCloseTab: false,
      }),
    });
    const createData = await createRes.json();
    if (!createRes.ok || !createData?.taskId) {
      throw new Error(createData?.error || `创建调度任务失败（HTTP ${createRes.status}）`);
    }
    const taskId = String(createData.taskId);
    setDispatcherTaskId(taskId);
    setSessionId(taskId);
    addLog(setLogs, `✅ 调度任务已创建：${taskId}`, 'success');
    return taskId;
  }

  async function handleCreateImage() {
    if (!workflowId) return;
    let deferRunningReset = false;
    setRunning(true);
    setError('');
    setLogs([]);
    setImageUrls([]);
    setAdsPoolTasks([]);
    setDispatcherSummary(null);
    setDispatcherInstances([]);
    setDispatcherTaskId(null);
    dispatcherLastStatusRef.current = null;
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
              `🧵 [第${idx + 1}组 ${run.browserInstanceId}] ⚠️ 未采集到媒体 URL，本组按失败处理（可能是步骤回包中断）`,
              'error'
            );
            return { ...item, failed: true, error: item.error || '未采集到媒体 URL' };
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
      } else if (generateCase === 'ads-ai-pool') {
        const prompts = aiStoryScenes.map((item) => item.prompt.trim()).filter(Boolean);
        if (prompts.length === 0) {
          throw new Error('请先生成故事化提示词队列');
        }
        const poolIds = instancePoolIds.map((item) => item.trim()).filter(Boolean);
        if (poolIds.length === 0) {
          throw new Error('实例池不能为空');
        }
        if (isVisualStoryModule) {
          await createDispatcherTask(prompts, poolIds, '启动视觉故事调度器');
          deferRunningReset = true;
          return;
        }
        addLog(setLogs, `🚀 启动实例池调度，共 ${prompts.length} 条提示词，实例池 ${poolIds.length} 个`);
        await runAdsPoolTasks(prompts);
      } else {
        const prompts = normalizePromptLines(dispatcherPrompts);
        const poolIds = dispatcherInstanceIds.map((item) => item.trim()).filter(Boolean);
        if (prompts.length === 0) {
          throw new Error('请至少保留一条提示词');
        }
        if (poolIds.length === 0) {
          throw new Error('默认实例池不能为空');
        }
        await createDispatcherTask(prompts, poolIds, '启动调度器');
        deferRunningReset = true;
        return;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      addLog(setLogs, `❌ ${msg}`, 'error');
    } finally {
      if (!deferRunningReset) {
        setRunning(false);
      }
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{isVisualStoryModule ? '视觉故事' : '图片生成'}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isVisualStoryModule
            ? '先生成故事母本与分镜提示词，再交给 Ads 调度器批量产出高质量插图，适合连续图文内容生产。'
            : '输入提示词，调用 Gemini 工作流生成图片并回显 URL。'}
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          {isVisualStoryModule ? (
            <div className="rounded-xl border border-border bg-[linear-gradient(135deg,rgba(244,114,182,0.08),rgba(251,191,36,0.08),rgba(59,130,246,0.04))] p-3">
              <label className="block text-xs text-muted-foreground mb-1">模块定位</label>
              <div className="text-sm font-semibold">视觉故事生产线</div>
              <div className="mt-1 text-xs text-muted-foreground">
                故事母本 -&gt; 分镜提示词 -&gt; Ads 调度器 -&gt; 实时结果网格
              </div>
            </div>
          ) : (
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
                <option value="ads-ha-10">Ads 调度器（默认实例池）</option>
              </select>
            </div>
          )}
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
              ? `${isVisualStoryModule ? '视觉故事调度模式' : generateCase === 'ads-multi' ? 'Ads 并行模式' : generateCase === 'ads-ai-pool' ? 'Ads 实例池模式' : generateCase === 'ads-ha-10' ? 'Ads 调度器模式' : '普通模式'} · 节点数：${selectedWorkflow.nodes.length}`
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
        ) : generateCase === 'ads-ai-pool' ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-border p-4 bg-[linear-gradient(135deg,rgba(251,191,36,0.10),rgba(236,72,153,0.06),rgba(59,130,246,0.04))]">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Story Prompt Lab</div>
              <div className="mt-2 text-lg font-semibold">{isVisualStoryModule ? '企业级视觉故事编排台' : '先生成故事，再按段落打磨高级提示词'}</div>
              <p className="mt-2 text-sm text-muted-foreground">
                不是随机凑几句 prompt，而是先产出一篇可连续成组的童话/奇幻故事，再把每个情节段落优化成高质量插图提示词。
                这样批量生图时角色、服装、世界观、镜头和光影都更统一。
              </p>
              {isVisualStoryModule && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {['故事母本', '角色设定', '段落分镜', '提示词优化', 'Ads 调度', '结果回看'].map((step) => (
                    <span key={step} className="rounded-full border border-white/60 bg-white/70 px-3 py-1 text-[11px] text-foreground/80">
                      {step}
                    </span>
                  ))}
                </div>
              )}
            </div>

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
                  disabled={running || aiGeneratingPrompts}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted disabled:opacity-50"
                >
                  {aiGeneratingPrompts ? '生成故事中...' : '生成故事队列'}
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

            <div className="grid xl:grid-cols-[0.78fr_1.22fr] gap-4">
              <div className="rounded-xl border border-border p-4 bg-card">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">故事设定</div>
                    <div className="text-xs text-muted-foreground mt-1">统一世界观、角色外观、风格锚点和连续性约束。</div>
                  </div>
                  {aiStoryScenes.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void generateAiPrompts()}
                      disabled={aiGeneratingPrompts}
                      className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted disabled:opacity-50"
                    >
                      整组刷新
                    </button>
                  )}
                </div>

                {aiStoryBible ? (
                  <div className="mt-4 space-y-3">
                    <div>
                      <div className="text-lg font-semibold">{aiStoryBible.title}</div>
                      <p className="mt-2 text-sm text-muted-foreground leading-7">{aiStoryBible.overview}</p>
                    </div>
                    <div className="rounded-xl bg-muted/20 p-3">
                      <div className="text-xs text-muted-foreground">世界观</div>
                      <div className="mt-1 text-sm leading-7">{aiStoryBible.world}</div>
                    </div>
                    <div className="rounded-xl bg-muted/20 p-3">
                      <div className="text-xs text-muted-foreground">主角设定</div>
                      <div className="mt-1 text-sm leading-7">{aiStoryBible.protagonist}</div>
                    </div>
                    <div className="rounded-xl bg-muted/20 p-3">
                      <div className="text-xs text-muted-foreground">配角与氛围</div>
                      <div className="mt-1 text-sm leading-7">{aiStoryBible.supportingCast}</div>
                    </div>
                    <div className="rounded-xl bg-muted/20 p-3">
                      <div className="text-xs text-muted-foreground">统一视觉风格</div>
                      <div className="mt-1 text-sm leading-7">{aiStoryBible.visualStyle}</div>
                    </div>
                    <div className="rounded-xl border border-dashed border-border p-3">
                      <div className="text-xs text-muted-foreground">连续性规则</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {aiStoryBible.continuityRules.map((rule) => (
                          <span key={rule} className="rounded-full bg-pink-50 px-3 py-1 text-[11px] text-pink-600">
                            {rule}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                    先点击“生成故事队列”。系统会先给你一套故事设定，再拆成连续分镜提示词。
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border p-4 bg-card">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">提示词队列</div>
                    <div className="text-xs text-muted-foreground mt-1">每张分镜都能单独刷新，并保留整体故事与风格连续性。</div>
                  </div>
                  <div className="text-xs text-muted-foreground">共 {aiStoryScenes.length} 张分镜</div>
                </div>

                <div className="mt-4 space-y-3 max-h-[780px] overflow-auto pr-1">
                  {aiStoryScenes.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                      暂无分镜提示词。生成后这里会按“剧情段落到插图提示词”的方式展开。
                    </div>
                  ) : (
                    aiStoryScenes.map((scene) => (
                      <div key={scene.id} className="rounded-2xl border border-border p-4 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(244,114,182,0.03))] space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm text-muted-foreground">Scene #{scene.index + 1}</div>
                            <div className="mt-1 text-lg font-semibold">{scene.title}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void refreshAiScene(scene)}
                            disabled={aiRefreshingSceneId === scene.id}
                            className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted disabled:opacity-50"
                          >
                            {aiRefreshingSceneId === scene.id ? '刷新中...' : '刷新本段'}
                          </button>
                        </div>

                        <div className="rounded-xl bg-amber-50/60 px-3 py-3">
                          <div className="text-xs text-amber-700">剧情段落</div>
                          <div className="mt-1 text-sm leading-7 text-foreground">{scene.paragraph}</div>
                        </div>

                        <div className="grid md:grid-cols-2 gap-3 text-sm">
                          <div className="rounded-xl bg-muted/20 px-3 py-3">
                            <div className="text-xs text-muted-foreground">分镜目标</div>
                            <div className="mt-1 leading-7">{scene.storyBeat}</div>
                          </div>
                          <div className="rounded-xl bg-muted/20 px-3 py-3">
                            <div className="text-xs text-muted-foreground">连续性说明</div>
                            <div className="mt-1 leading-7">{scene.continuityNotes}</div>
                          </div>
                        </div>

                        <div className="rounded-xl border border-border px-3 py-3">
                          <div className="text-xs text-muted-foreground">高级提示词</div>
                          <div className="mt-2 text-sm leading-7 whitespace-pre-wrap">{scene.prompt}</div>
                        </div>

                        <div className="grid md:grid-cols-2 gap-3 text-sm">
                          <div className="rounded-xl bg-zinc-50 px-3 py-3">
                            <div className="text-xs text-muted-foreground">负面提示词</div>
                            <div className="mt-1 leading-7">{scene.negativePrompt}</div>
                          </div>
                          <div className="rounded-xl bg-zinc-50 px-3 py-3">
                            <div className="text-xs text-muted-foreground">风格强化</div>
                            <div className="mt-1 leading-7">{scene.styleNotes}</div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid lg:grid-cols-[1.15fr_0.85fr] gap-3">
              <div className="rounded-xl border border-border p-4 bg-[linear-gradient(135deg,rgba(244,114,182,0.08),rgba(14,165,233,0.05))]">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Dispatcher</div>
                <div className="mt-2 text-lg font-semibold">默认实例池自动调度</div>
                <p className="mt-1 text-sm text-muted-foreground">
                  后端统一维护实例池、占用状态和回池时机。页面只负责提交队列和展示实时编排结果。
                </p>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-border bg-background/70 p-3">
                    <div className="text-[11px] text-muted-foreground">实例数</div>
                    <div className="mt-1 text-xl font-semibold">{dispatcherInstanceIds.length}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-background/70 p-3">
                    <div className="text-[11px] text-muted-foreground">提示词数</div>
                    <div className="mt-1 text-xl font-semibold">{normalizePromptLines(dispatcherPrompts).length}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-background/70 p-3">
                    <div className="text-[11px] text-muted-foreground">任务状态</div>
                    <div className="mt-1 text-sm font-semibold">
                      {dispatcherSummary
                        ? `${dispatcherSummary.success}/${dispatcherSummary.total} 成功`
                        : dispatcherTaskId
                          ? '运行中'
                          : '待启动'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border p-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs text-muted-foreground">默认实例池（逗号分隔）</label>
                  <span className="text-[11px] text-muted-foreground">调度器会逐个回收并重投</span>
                </div>
                <input
                  value={dispatcherInstanceIds.join(', ')}
                  onChange={(e) =>
                    setDispatcherInstanceIds(
                      e.target.value
                        .split(',')
                        .map((item) => item.trim())
                        .filter(Boolean)
                    )
                  }
                  className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm font-mono"
                />
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {dispatcherInstanceIds.map((instanceId) => (
                    <div key={instanceId} className="rounded-lg border border-border px-3 py-2 text-xs bg-muted/20">
                      <div className="font-mono">{instanceId}</div>
                      <div className="mt-1 text-muted-foreground">默认工作位</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs text-muted-foreground">提示词队列</label>
                <button
                  type="button"
                  onClick={() => setDispatcherPrompts((prev) => [...prev, ''])}
                  className="px-2.5 py-1 text-xs rounded-md border border-border hover:bg-muted"
                >
                  新增提示词
                </button>
              </div>
              <div className="space-y-2 max-h-64 overflow-auto">
                {dispatcherPrompts.map((item, idx) => (
                  <div key={`${idx}-${item}`} className="grid grid-cols-[auto_1fr_auto] gap-2">
                    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                      #{idx + 1}
                    </div>
                    <input
                      value={item}
                      onChange={(e) =>
                        setDispatcherPrompts((prev) =>
                          prev.map((entry, entryIdx) => (entryIdx === idx ? e.target.value : entry))
                        )
                      }
                      placeholder="输入一条要排队执行的图片提示词"
                      className="w-full border border-border rounded-lg bg-background px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setDispatcherPrompts((prev) => prev.filter((_, entryIdx) => entryIdx !== idx))}
                      disabled={dispatcherPrompts.length <= 1}
                      className="px-2.5 py-1 text-xs rounded-md border border-border hover:bg-muted disabled:opacity-50"
                    >
                      删除
                    </button>
                  </div>
                ))}
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
                  : generateCase === 'ads-ai-pool'
                    ? aiStoryScenes.length === 0 || instancePoolIds.length === 0
                    : normalizePromptLines(dispatcherPrompts).length === 0 || dispatcherInstanceIds.length === 0)
            }
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-white disabled:opacity-50"
          >
            {running
              ? '生成中...'
              : generateCase === 'single'
                ? '创建图片'
              : generateCase === 'ads-multi'
                ? '并行生成图片'
                : generateCase === 'ads-ai-pool'
                  ? isVisualStoryModule ? '启动故事批量生成' : '实例池批量生成'
                  : '启动调度器生成'}
          </button>
          {generateCase === 'ads-ha-10' && dispatcherTaskId && running && (
            <button
              type="button"
              onClick={() => void cancelDispatcherTask()}
              className="px-4 py-2 rounded-lg text-sm font-semibold border border-border hover:bg-muted"
            >
              取消调度
            </button>
          )}
          {sessionId && <span className="text-xs text-muted-foreground">session: {sessionId}</span>}
          {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
      </div>

      {(generateCase === 'ads-ha-10' || isVisualStoryModule) && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">实例调度看板</h2>
                <p className="text-xs text-muted-foreground mt-1">每个实例同一时刻只跑一个子任务，结束后自动回池。</p>
              </div>
              {dispatcherSummary && (
                <div className="text-xs text-muted-foreground">
                  总计 {dispatcherSummary.total} · 运行中 {dispatcherSummary.running} · 待执行 {dispatcherSummary.pending}
                </div>
              )}
            </div>
            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
              {liveDispatcherInstances.map((instance) => (
                <div key={instance.instanceId} className="rounded-xl border border-border p-3 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))] space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold font-mono">{instance.instanceId}</div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        {instance.currentItemId ? `当前任务 ${instance.currentItemId.split('-').pop()}` : '等待分配任务'}
                      </div>
                    </div>
                    <span className={
                      instance.state === 'running'
                        ? 'text-blue-500 text-xs'
                        : instance.state === 'idle'
                          ? 'text-green-500 text-xs'
                          : instance.state === 'busy'
                            ? 'text-amber-500 text-xs'
                            : 'text-zinc-500 text-xs'
                    }>
                      {instance.state === 'running' ? '执行中' : instance.state === 'idle' ? '空闲' : instance.state === 'busy' ? '被占用' : '未激活'}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground min-h-10">
                    {instance.currentPrompt || instance.detail || '调度器启动后会自动分配下一条 prompt'}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                    <div className="rounded-lg bg-muted/20 px-2 py-2">
                      <div>当前子任务</div>
                      <div className="mt-1 font-mono break-all text-foreground/85">{instance.batchTaskId || '-'}</div>
                    </div>
                    <div className="rounded-lg bg-muted/20 px-2 py-2">
                      <div>最近释放</div>
                      <div className="mt-1 text-foreground/85">{timeAgoLabel(instance.lastReleasedAt)}</div>
                    </div>
                  </div>
                  {(instance.lastResultStatus || instance.lastError || instance.lastImageUrl) && (
                    <div className="rounded-lg border border-border px-2 py-2 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">上次结果</span>
                        <span className={
                          instance.lastResultStatus === 'success'
                            ? 'text-green-500'
                            : instance.lastResultStatus === 'failed'
                              ? 'text-red-500'
                              : 'text-zinc-500'
                        }>
                          {instance.lastResultStatus || '-'}
                        </span>
                      </div>
                      {instance.lastImageUrl && (
                        <a href={instance.lastMediaUrl || instance.lastImageUrl || ''} target="_blank" rel="noreferrer" className="mt-1 block text-primary break-all hover:underline">
                          {instance.lastMediaUrl || instance.lastImageUrl}
                        </a>
                      )}
                      {instance.lastError && <div className="mt-1 text-red-500">{instance.lastError}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">任务结果网格</h2>
                <p className="text-xs text-muted-foreground mt-1">按 prompt 维度展示状态、实例归属、图片/视频结果和操作入口。</p>
              </div>
              {dispatcherSummary && (
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-700">成功 {dispatcherSummary.success}</div>
                  <div className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-rose-700">失败 {dispatcherSummary.failed}</div>
                  <div className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-zinc-600">取消 {dispatcherSummary.cancelled}</div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-[linear-gradient(180deg,rgba(236,72,153,0.04),rgba(255,255,255,0))] p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3 text-[11px]">
                <div className="rounded-xl bg-white px-3 py-3 border border-border">
                  <div className="text-muted-foreground">总任务</div>
                  <div className="mt-1 text-lg font-semibold">{dispatcherSummary?.total ?? adsPoolTasks.length}</div>
                </div>
                <div className="rounded-xl bg-white px-3 py-3 border border-border">
                  <div className="text-muted-foreground">排队中</div>
                  <div className="mt-1 text-lg font-semibold">{dispatcherSummary?.pending ?? 0}</div>
                </div>
                <div className="rounded-xl bg-white px-3 py-3 border border-border">
                  <div className="text-muted-foreground">执行中</div>
                  <div className="mt-1 text-lg font-semibold">{dispatcherSummary?.running ?? 0}</div>
                </div>
                <div className="rounded-xl bg-white px-3 py-3 border border-border">
                  <div className="text-muted-foreground">已完成</div>
                  <div className="mt-1 text-lg font-semibold text-emerald-600">{dispatcherSummary?.success ?? 0}</div>
                </div>
                <div className="rounded-xl bg-white px-3 py-3 border border-border">
                  <div className="text-muted-foreground">失败</div>
                  <div className="mt-1 text-lg font-semibold text-rose-600">{dispatcherSummary?.failed ?? 0}</div>
                </div>
                <div className="rounded-xl bg-white px-3 py-3 border border-border">
                  <div className="text-muted-foreground">已出媒体</div>
                  <div className="mt-1 text-lg font-semibold">{imageUrls.length}</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 max-h-[760px] overflow-auto pr-1">
              {adsPoolTasks.length === 0 ? (
                <div className="col-span-full rounded-2xl border border-dashed border-border bg-muted/10 px-5 py-12 text-center">
                  <div className="text-base font-medium">结果卡片会显示在这里</div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    调度器启动后，这里会持续刷新每条 prompt 的封面、状态、实例归属和媒体链接。
                  </div>
                </div>
              ) : (
                adsPoolTasks.map((task) => (
                  <div
                    key={task.id}
                    className={`rounded-[22px] border bg-white p-4 transition-all ${
                      task.status === 'success'
                        ? 'border-pink-200 shadow-[0_12px_30px_rgba(236,72,153,0.08)]'
                        : task.status === 'running'
                          ? 'border-sky-200 shadow-[0_10px_24px_rgba(14,165,233,0.08)]'
                          : 'border-border shadow-[0_8px_22px_rgba(15,23,42,0.04)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-base font-semibold text-foreground">任务 #{task.id.split('-').pop()}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          实例 {task.browserInstanceId || '-'} · 尝试 {task.attempts || 0} · {timeAgoLabel(task.endedAt || task.startedAt)}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium ${taskStatusClass(task.status)}`}>
                        {taskStatusLabel(task.status)}
                      </span>
                    </div>

                    <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-[linear-gradient(135deg,rgba(236,72,153,0.08),rgba(244,114,182,0.02),rgba(255,255,255,0.65))]">
                      {(task.mediaUrl || task.imageUrl) ? (
                        <button
                          onClick={() => {
                            const url = task.mediaUrl || task.imageUrl || null;
                            setPreviewUrl(url);
                            setPreviewMediaType(inferMediaKind(url || '', task.mediaType));
                          }}
                          className="block w-full text-left"
                        >
                          {inferMediaKind(task.mediaUrl || task.imageUrl || '', task.mediaType) === 'video' ? (
                            <video
                              src={task.mediaUrl || task.imageUrl}
                              className="h-44 w-full object-cover"
                              muted
                              playsInline
                              preload="metadata"
                            />
                          ) : (
                            <img src={task.mediaUrl || task.imageUrl} alt={task.prompt} className="h-44 w-full object-cover" loading="lazy" />
                          )}
                        </button>
                      ) : (
                        <div className="flex h-44 items-center justify-center px-6 text-center">
                          <div>
                            <div className="text-sm font-medium text-foreground/80">
                              {task.status === 'running' ? '正在生成媒体...' : task.status === 'failed' ? '本次未生成媒体' : '等待媒体产出'}
                            </div>
                            <div className="mt-2 text-xs text-muted-foreground">
                              调度器会在拿到媒体 URL 后自动更新这张卡片
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="mt-4">
                      <div className="line-clamp-2 text-[15px] font-semibold leading-7 text-foreground">{task.prompt}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full bg-pink-50 px-3 py-1 text-[11px] text-pink-600">实例 {task.browserInstanceId || '-'}</span>
                        <span className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] text-zinc-600">子任务 {task.batchTaskId ? '已创建' : '未创建'}</span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] text-slate-600">重试 {task.attempts || 0}</span>
                      </div>
                    </div>

                    <div className="mt-4 rounded-2xl bg-zinc-50/80 px-3 py-3 text-[11px] text-muted-foreground">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div>子任务 ID</div>
                          <div className="mt-1 break-all font-mono text-foreground/80">{task.batchTaskId || '-'}</div>
                        </div>
                        <div>
                          <div>最近更新时间</div>
                          <div className="mt-1 text-foreground/80">{timeAgoLabel(task.endedAt || task.startedAt)}</div>
                        </div>
                      </div>
                    </div>

                    {(task.mediaUrl || task.imageUrl) && (
                      <a href={task.mediaUrl || task.imageUrl} target="_blank" rel="noreferrer" className="mt-3 block text-xs text-primary break-all hover:underline">
                        {task.mediaUrl || task.imageUrl}
                      </a>
                    )}
                    {task.error && <div className="mt-3 text-xs text-rose-500">{task.error}</div>}

                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const url = task.mediaUrl || task.imageUrl || null;
                          if (!url) return;
                          setPreviewUrl(url);
                          setPreviewMediaType(inferMediaKind(url, task.mediaType));
                        }}
                        disabled={!(task.mediaUrl || task.imageUrl)}
                        className="flex-1 rounded-xl border border-border bg-white px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        预览结果
                      </button>
                      <button
                        type="button"
                        onClick={() => (task.mediaUrl || task.imageUrl) && navigator.clipboard.writeText(task.mediaUrl || task.imageUrl || '')}
                        disabled={!(task.mediaUrl || task.imageUrl)}
                        className="flex-1 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        复制链接
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

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
          <h2 className="text-sm font-semibold mb-3">生成媒体 URL 列表</h2>
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
                            : task.status === 'cancelled'
                              ? 'text-zinc-500'
                            : task.status === 'running'
                              ? 'text-blue-500'
                              : 'text-muted-foreground'
                      }>
                        {task.status}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      实例：{task.browserInstanceId || '-'} · 尝试：{task.attempts || 0}
                    </div>
                    <div className="text-xs">{task.prompt}</div>
                    {(task.mediaUrl || task.imageUrl) && (
                      <a href={task.mediaUrl || task.imageUrl} target="_blank" rel="noreferrer" className="text-xs text-primary break-all hover:underline">
                        {task.mediaUrl || task.imageUrl}
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
              <div className="text-sm text-muted-foreground">暂无媒体 URL</div>
            ) : (
              imageUrls.map((url, idx) => {
                const mediaKind = inferMediaKind(url);
                const publishLabel = mediaKind === 'video' ? '去视频发布页' : '去图片发布页';
                const fallbackTitle = mediaKind === 'video' ? `视频${idx + 1}` : `图片${idx + 1}`;
                return (
                <div key={url} className="border border-border rounded-lg p-3 space-y-2">
                  <div className="text-xs text-muted-foreground">
                    {mediaKind === 'video' ? `视频 ${idx + 1}` : `图片 ${idx + 1}`}
                  </div>
                  <button
                    onClick={() => {
                      setPreviewUrl(url);
                      setPreviewMediaType(mediaKind);
                    }}
                    className="w-full block overflow-hidden rounded-lg border border-border bg-muted/20"
                  >
                    {mediaKind === 'video' ? (
                      <video src={url} className="w-full h-40 object-cover" muted playsInline preload="metadata" />
                    ) : (
                      <img src={url} alt={`生成媒体 ${idx + 1}`} className="w-full h-40 object-cover" loading="lazy" />
                    )}
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
                      onClick={() => {
                        setPreviewUrl(url);
                        setPreviewMediaType(mediaKind);
                      }}
                      className="px-2.5 py-1 text-xs rounded-md border border-border hover:bg-muted"
                    >
                      预览
                    </button>
                    <button
                      onClick={() => router.push(`/publish?ossUrl=${encodeURIComponent(url)}&title=${encodeURIComponent(prompt.slice(0, 30) || fallbackTitle)}`)}
                      className="px-2.5 py-1 text-xs rounded-md border border-border hover:bg-muted"
                    >
                      {publishLabel}
                    </button>
                  </div>
                </div>
              )})
            )}
          </div>
        </div>
      </div>

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => {
            setPreviewUrl(null);
            setPreviewMediaType('image');
          }}
        >
          {previewMediaType === 'video' ? (
            <video
              src={previewUrl}
              controls
              autoPlay
              onClick={(e) => e.stopPropagation()}
              className="max-w-[95vw] max-h-[90vh] rounded-xl border border-border bg-black"
            />
          ) : (
            <img
              src={previewUrl}
              alt="预览媒体"
              onClick={(e) => e.stopPropagation()}
              className="max-w-[95vw] max-h-[90vh] object-contain rounded-xl border border-border bg-black"
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function ImageGeneratePage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-zinc-500">Loading...</div>}>
      <ImageGeneratePageInner />
    </Suspense>
  );
}
