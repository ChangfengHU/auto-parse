'use client';

import { useEffect, useRef, useState } from 'react';

type IdeaPreset = {
  id: string;
  title: string;
  hook: string;
  theme: string;
  style: string;
  tone: string;
  sceneCount: number;
  audience: string;
  extraPrompt: string;
  tags: string[];
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
  enabled: boolean;
};

type DispatcherProgress = {
  total: number;
  completed: number;
  percent: number;
  pending: number;
  running: number;
  success: number;
  failed: number;
  cancelled: number;
};

type DispatcherItem = {
  index: number;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  attempts: number;
  primaryMediaUrl: string | null;
  primaryMediaType: string | null;
  primaryImageUrl: string | null;
  error?: string;
  startedAt?: string;
  endedAt?: string;
};

type DraftConfig = {
  theme: string;
  style: string;
  sceneCount: number;
  extra: string;
};

type IdeaProvider = 'gemini' | 'grok' | 'openai' | 'fallback';
type VisualStoryStep = 'ideas' | 'plan' | 'scenes' | 'submit' | 'results';

const STYLE_OPTIONS = [
  '宫崎骏式温柔童话插画',
  '高端绘本叙事插画',
  '电影感奇幻概念艺术',
  '国潮神话插图',
  '梦幻水彩儿童绘本',
  '复古油画质感插画',
];

const QUICK_STARTS = [
  '给我 6 个治愈系视觉故事灵感',
  '围绕春天、少女感和花园给我一组方向',
  '适合抖音图文的高打开率奇幻故事',
  '来一组东方神话感的连续插画选题',
  '我想做角色反差强的绘本故事',
];

const DEFAULT_INSTANCE_IDS = ['k1b908rw', 'k1bdaoa7', 'k1ba8vac'];

function inferMediaKind(url: string, mimeType?: string | null): 'image' | 'video' | 'unknown' {
  const value = String(url || '').toLowerCase();
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(value)) return 'video';
  if (/\.(png|jpg|jpeg|webp|gif|bmp|svg|avif)(\?|$)/i.test(value)) return 'image';
  return 'unknown';
}

function statusLabel(status: DispatcherItem['status']) {
  switch (status) {
    case 'success':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    case 'running':
      return '生成中';
    default:
      return '等待中';
  }
}

function statusClass(status: DispatcherItem['status']) {
  switch (status) {
    case 'success':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'failed':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    case 'cancelled':
      return 'border-zinc-200 bg-zinc-100 text-zinc-600';
    case 'running':
      return 'border-sky-200 bg-sky-50 text-sky-700';
    default:
      return 'border-amber-200 bg-amber-50 text-amber-700';
  }
}

function createEmptyProgress(): DispatcherProgress {
  return {
    total: 0,
    completed: 0,
    percent: 0,
    pending: 0,
    running: 0,
    success: 0,
    failed: 0,
    cancelled: 0,
  };
}

function providerLabel(provider: IdeaProvider | null) {
  switch (provider) {
    case 'gemini':
      return 'Gemini';
    case 'grok':
      return 'Grok';
    case 'openai':
      return 'OpenAI';
    case 'fallback':
      return '本地兜底';
    default:
      return '未使用';
  }
}

export default function VisualStoryPage() {
  const [ideaBrief, setIdeaBrief] = useState('');
  const [ideaLoading, setIdeaLoading] = useState(false);
  const [ideas, setIdeas] = useState<IdeaPreset[]>([]);
  const [ideaProvider, setIdeaProvider] = useState<IdeaProvider | null>(null);
  const [ideaWarnings, setIdeaWarnings] = useState<string[]>([]);
  const [lastIdeaBrief, setLastIdeaBrief] = useState('');
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<VisualStoryStep>('ideas');
  const [showSceneDetails, setShowSceneDetails] = useState<Record<string, boolean>>({});
  const [showEnabledOnly, setShowEnabledOnly] = useState(false);
  const [storyBibleExpanded, setStoryBibleExpanded] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [config, setConfig] = useState<DraftConfig>({
    theme: '',
    style: STYLE_OPTIONS[0],
    sceneCount: 6,
    extra: '',
  });
  const [storyBible, setStoryBible] = useState<StoryBible | null>(null);
  const [storyScenes, setStoryScenes] = useState<StoryScene[]>([]);
  const [storyLoading, setStoryLoading] = useState(false);
  const [refreshingSceneId, setRefreshingSceneId] = useState<string | null>(null);
  const [instancePoolIds, setInstancePoolIds] = useState<string[]>(DEFAULT_INSTANCE_IDS);
  const [dispatcherTaskId, setDispatcherTaskId] = useState<string | null>(null);
  const [dispatcherStatus, setDispatcherStatus] = useState<string>('idle');
  const [dispatcherProgress, setDispatcherProgress] = useState<DispatcherProgress>(createEmptyProgress());
  const [dispatcherItems, setDispatcherItems] = useState<DispatcherItem[]>([]);
  const [submittedScenes, setSubmittedScenes] = useState<StoryScene[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const initializedRef = useRef(false);

  const steps: Array<{ id: VisualStoryStep; title: string; hint: string }> = [
    { id: 'ideas', title: '灵感', hint: '先找方向' },
    { id: 'plan', title: '方案', hint: '确认配置' },
    { id: 'scenes', title: '分镜', hint: '编辑细节' },
    { id: 'submit', title: '生成', hint: '准备提交' },
    { id: 'results', title: '结果', hint: '回看输出' },
  ];

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    void fetchIdeas('');
  }, []);

  useEffect(() => {
    if (!dispatcherTaskId) return;
    let alive = true;

    const poll = async () => {
      try {
        const res = await fetch(`/api/gemini-web/image/ads-dispatcher/tasks/${dispatcherTaskId}/summary`);
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) {
          throw new Error(data?.error || `任务摘要加载失败（HTTP ${res.status}）`);
        }

        setDispatcherStatus(String(data.status || 'running'));
        setDispatcherProgress((data.progress || createEmptyProgress()) as DispatcherProgress);
        setDispatcherItems(Array.isArray(data.items) ? (data.items as DispatcherItem[]) : []);

        if (data.done) {
          setRunning(false);
          return;
        }

        window.setTimeout(() => {
          void poll();
        }, 1800);
      } catch (pollError) {
        if (!alive) return;
        const message = pollError instanceof Error ? pollError.message : String(pollError);
        setError(message);
        setRunning(false);
      }
    };

    void poll();
    return () => {
      alive = false;
    };
  }, [dispatcherTaskId]);

  async function fetchIdeas(brief: string) {
    setIdeaLoading(true);
    setError('');
    try {
      const res = await fetch('/api/visual-story/inspirations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, count: 6 }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `灵感加载失败（HTTP ${res.status}）`);
      }
      setIdeas(Array.isArray(data.ideas) ? (data.ideas as IdeaPreset[]) : []);
      setIdeaProvider((data.provider || null) as IdeaProvider | null);
      setIdeaWarnings(Array.isArray(data.warnings) ? data.warnings.map((item: unknown) => String(item || '')).filter(Boolean) : []);
      setLastIdeaBrief(brief.trim());
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
      setError(message);
      setIdeas([]);
      setIdeaProvider(null);
      setIdeaWarnings([]);
    } finally {
      setIdeaLoading(false);
    }
  }

  function applyIdea(idea: IdeaPreset) {
    setSelectedIdeaId(idea.id);
    setConfig({
      theme: idea.theme,
      style: idea.style,
      sceneCount: idea.sceneCount,
      extra: `${idea.extraPrompt}\n受众方向：${idea.audience}\n情绪氛围：${idea.tone}`,
    });
    setCurrentStep('plan');
  }

  async function generateStoryQueue() {
    if (!config.theme.trim() || !config.style.trim()) {
      setError('请先确认主题和风格');
      return;
    }
    setStoryLoading(true);
    setError('');
    setStoryBible(null);
    setStoryScenes([]);
    setDispatcherTaskId(null);
    setDispatcherItems([]);
    setDispatcherProgress(createEmptyProgress());
    setSubmittedScenes([]);
    try {
      const res = await fetch('/api/image-generate/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: config.theme,
          style: config.style,
          count: config.sceneCount,
          extra: config.extra,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `故事生成失败（HTTP ${res.status}）`);
      }

      setStoryBible((data.bible || null) as StoryBible | null);
      const nextScenes: StoryScene[] = Array.isArray(data.scenes)
        ? data.scenes.map((scene: Omit<StoryScene, 'enabled'>) => ({
            ...scene,
            enabled: true,
          }))
        : [];
      setStoryScenes(nextScenes);
      setShowSceneDetails({});
      setCurrentStep('scenes');
    } catch (generateError) {
      const message = generateError instanceof Error ? generateError.message : String(generateError);
      setError(message);
    } finally {
      setStoryLoading(false);
    }
  }

  async function refreshScene(scene: StoryScene) {
    if (!storyBible) return;
    setRefreshingSceneId(scene.id);
    setError('');
    try {
      const scenesPayload = storyScenes.map((currentScene) => {
        const { enabled, ...rest } = currentScene;
        void enabled;
        return rest;
      });
      const res = await fetch('/api/image-generate/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: config.theme,
          style: config.style,
          count: config.sceneCount,
          extra: config.extra,
          currentBible: storyBible,
          currentScenes: scenesPayload,
          targetSceneIndex: scene.index,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.scene) {
        throw new Error(data?.error || `分镜刷新失败（HTTP ${res.status}）`);
      }
      setStoryScenes((prev) =>
        prev.map((item) =>
          item.id === scene.id
            ? {
                ...item,
                ...data.scene,
              }
            : item
        )
      );
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
      setError(message);
    } finally {
      setRefreshingSceneId(null);
    }
  }

  async function launchDispatcher() {
    const activeScenes = storyScenes.filter((scene) => scene.enabled && scene.prompt.trim());
    if (activeScenes.length === 0) {
      setError('请至少保留一个启用中的分镜');
      return;
    }

    setRunning(true);
    setError('');
    setDispatcherItems([]);
    setDispatcherProgress(createEmptyProgress());
    setSubmittedScenes(activeScenes);
    try {
      const res = await fetch('/api/gemini-web/image/ads-dispatcher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompts: activeScenes.map((scene) => scene.prompt),
          instanceIds: instancePoolIds,
          maxAttemptsPerPrompt: 6,
          childTaskTimeoutMs: 8 * 60 * 1000,
          pollIntervalMs: 2000,
          autoCloseTab: false,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.taskId) {
        throw new Error(data?.error || `调度任务创建失败（HTTP ${res.status}）`);
      }
      setDispatcherTaskId(String(data.taskId));
      setDispatcherStatus(String(data.status || 'queued'));
      setCurrentStep('results');
    } catch (launchError) {
      const message = launchError instanceof Error ? launchError.message : String(launchError);
      setError(message);
      setRunning(false);
    }
  }

  const selectedIdea = ideas.find((idea) => idea.id === selectedIdeaId) || null;
  const activeSceneCount = storyScenes.filter((scene) => scene.enabled).length;
  const visibleScenes = showEnabledOnly ? storyScenes.filter((scene) => scene.enabled) : storyScenes;
  const currentStepIndex = steps.findIndex((step) => step.id === currentStep);

  function canOpenStep(step: VisualStoryStep) {
    if (step === 'ideas') return true;
    if (step === 'plan') return Boolean(selectedIdea || config.theme.trim());
    if (step === 'scenes') return Boolean(storyBible && storyScenes.length > 0);
    if (step === 'submit') return activeSceneCount > 0;
    return Boolean(dispatcherTaskId || submittedScenes.length > 0 || running);
  }

  function stepStatus(step: VisualStoryStep) {
    const targetIndex = steps.findIndex((item) => item.id === step);
    if (targetIndex < currentStepIndex) return 'done';
    if (targetIndex === currentStepIndex) return 'current';
    return 'upcoming';
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <section className="rounded-[30px] border border-border bg-[linear-gradient(135deg,rgba(251,191,36,0.12),rgba(244,114,182,0.08),rgba(59,130,246,0.05))] p-6 sm:p-7">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">AI Visual Story Studio</div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">视觉故事工作台</h1>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                从灵感发现到分镜编辑，再到批量生成与结果回看，整个流程按步骤推进。
              </p>
            </div>
            <div className="rounded-2xl border border-white/60 bg-white/75 px-4 py-3 text-sm text-muted-foreground">
              当前步骤 <span className="font-semibold text-foreground">{steps[currentStepIndex]?.title}</span>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-5">
            {steps.map((step, index) => {
              const status = stepStatus(step.id);
              return (
                <button
                  key={step.id}
                  type="button"
                  disabled={!canOpenStep(step.id)}
                  onClick={() => canOpenStep(step.id) && setCurrentStep(step.id)}
                  className={`rounded-2xl border px-4 py-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-45 ${
                    status === 'current'
                      ? 'border-foreground/10 bg-white shadow-sm'
                      : status === 'done'
                        ? 'border-white/70 bg-white/80'
                        : 'border-white/40 bg-white/55'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                      status === 'current'
                        ? 'bg-foreground text-white'
                        : status === 'done'
                          ? 'bg-emerald-500 text-white'
                          : 'border border-border bg-white text-muted-foreground'
                    }`}>
                      {status === 'done' ? '✓' : index + 1}
                    </span>
                    <div>
                      <div className="text-sm font-semibold">{step.title}</div>
                      <div className="text-[11px] text-muted-foreground">{step.hint}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {currentStep === 'ideas' && (
            <section className="rounded-3xl border border-border bg-card p-5 sm:p-6 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xl font-semibold">先确定一个方向</div>
                  <p className="mt-1 text-sm text-muted-foreground">输入一个题材、角色、情绪或场景，AI 会为你生成一组中文候选方案。</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
                    来源 {providerLabel(ideaProvider)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void fetchIdeas(ideaBrief)}
                    disabled={ideaLoading}
                    className="rounded-xl border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                  >
                    {ideaLoading ? '生成中...' : '换一批'}
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-muted/20 p-4">
                <label className="block text-xs text-muted-foreground mb-2">第 1 步：输入你的方向</label>
                <textarea
                  value={ideaBrief}
                  onChange={(e) => setIdeaBrief(e.target.value)}
                  rows={3}
                  placeholder="例如：围绕春天、少女感和花园，给我一组适合抖音图文的治愈系绘本方向"
                  className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm resize-y"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  {QUICK_STARTS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setIdeaBrief(item);
                        void fetchIdeas(item);
                      }}
                      className="rounded-full border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted"
                    >
                      {item}
                    </button>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void fetchIdeas(ideaBrief)}
                    disabled={ideaLoading}
                    className="rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    生成灵感方案
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentStep('plan')}
                    disabled={!config.theme.trim()}
                    className="rounded-2xl border border-border px-5 py-3 text-sm hover:bg-muted disabled:opacity-50"
                  >
                    跳过灵感，直接手动配置
                  </button>
                </div>
              </div>

              {ideaWarnings.length > 0 && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  已自动切换灵感供应商，页面会优先保留中文结果。
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <div className="text-sm font-semibold">第 2 步：选择一个候选方案</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {lastIdeaBrief ? `以下方案基于“${lastIdeaBrief}”生成。` : '以下为默认推荐方向。'}
                  </p>
                </div>
                {ideaLoading && ideas.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">
                    AI 正在生成灵感卡...
                  </div>
                ) : ideas.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">
                    暂无候选方案，请先输入方向或点击快捷入口。
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {ideas.map((idea) => {
                      const active = selectedIdeaId === idea.id;
                      return (
                        <div
                          key={idea.id}
                          className={`rounded-[24px] border p-4 transition-all ${
                            active
                              ? 'border-pink-300 bg-[linear-gradient(135deg,rgba(251,191,36,0.10),rgba(244,114,182,0.08),rgba(255,255,255,0.88))] shadow-[0_12px_30px_rgba(244,114,182,0.08)]'
                              : 'border-border bg-background'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-lg font-semibold">{idea.title}</div>
                              <p className="mt-1 text-sm text-muted-foreground">{idea.hook}</p>
                            </div>
                            <span className="rounded-full border border-border bg-white/70 px-3 py-1 text-[11px] text-muted-foreground">
                              {idea.sceneCount} 张分镜
                            </span>
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-2 text-sm">
                            <div className="rounded-2xl bg-white/80 px-3 py-3">
                              <div className="text-xs text-muted-foreground">题材方向</div>
                              <div className="mt-1 font-medium">{idea.theme}</div>
                            </div>
                            <div className="rounded-2xl bg-white/80 px-3 py-3">
                              <div className="text-xs text-muted-foreground">视觉风格</div>
                              <div className="mt-1 font-medium">{idea.style}</div>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {idea.tags.map((tag) => (
                              <span key={tag} className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] text-zinc-600">
                                {tag}
                              </span>
                            ))}
                          </div>
                          <div className="mt-4">
                            <button
                              type="button"
                              onClick={() => applyIdea(idea)}
                              className="rounded-xl border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-muted"
                            >
                              采用这个方向
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          )}

          {currentStep === 'plan' && (
            <section className="rounded-3xl border border-border bg-card p-5 sm:p-6 space-y-5">
              <div>
                <div className="text-xl font-semibold">确认故事方案</div>
                <p className="mt-1 text-sm text-muted-foreground">微调主题、风格和分镜数，再生成故事母本与分镜。</p>
              </div>

              {selectedIdea && (
                <div className="rounded-[24px] border border-pink-200 bg-[linear-gradient(135deg,rgba(251,191,36,0.08),rgba(244,114,182,0.06),rgba(255,255,255,0.9))] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold">{selectedIdea.title}</div>
                      <p className="mt-1 text-sm text-muted-foreground">{selectedIdea.hook}</p>
                    </div>
                    <span className="rounded-full border border-border bg-white/70 px-3 py-1 text-[11px] text-muted-foreground">
                      已选方向
                    </span>
                  </div>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-xs text-muted-foreground mb-2">主题</label>
                  <input
                    value={config.theme}
                    onChange={(e) => setConfig((prev) => ({ ...prev, theme: e.target.value }))}
                    placeholder="例如：月光森林里的小狐狸冒险"
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-2">视觉风格</label>
                  <select
                    value={config.style}
                    onChange={(e) => setConfig((prev) => ({ ...prev, style: e.target.value }))}
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm"
                  >
                    {STYLE_OPTIONS.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-[180px_1fr]">
                <div>
                  <label className="block text-xs text-muted-foreground mb-2">分镜数</label>
                  <input
                    type="number"
                    min={4}
                    max={10}
                    value={config.sceneCount}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        sceneCount: Math.max(4, Math.min(10, Number(e.target.value) || 4)),
                      }))
                    }
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-2">补充要求</label>
                  <textarea
                    value={config.extra}
                    onChange={(e) => setConfig((prev) => ({ ...prev, extra: e.target.value }))}
                    rows={6}
                    placeholder="例如：适合社媒封面感，主角形象稳定，镜头有电影感，文字留白明确"
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm resize-y"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void generateStoryQueue()}
                  disabled={storyLoading || !config.theme.trim() || !config.style.trim()}
                  className="rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {storyLoading ? '生成故事母本中...' : '生成故事母本'}
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentStep('ideas')}
                  className="rounded-2xl border border-border px-5 py-3 text-sm hover:bg-muted"
                >
                  返回重选灵感
                </button>
              </div>
            </section>
          )}

          {currentStep === 'scenes' && (
            <section className="space-y-5">
              <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xl font-semibold">确认并编辑分镜</div>
                    <p className="mt-1 text-sm text-muted-foreground">把每个分镜整理成可直接提交给 Gemini 的最终英文生图 Prompt，确保每个子任务无状态也能稳定出图。</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStoryBibleExpanded((prev) => !prev)}
                    className="rounded-xl border border-border px-3 py-2 text-sm hover:bg-muted"
                  >
                    {storyBibleExpanded ? '收起母本' : '展开母本'}
                  </button>
                </div>

                {!storyBible ? (
                  <div className="mt-5 rounded-3xl border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">
                    先生成故事母本后再进入分镜编辑。
                  </div>
                ) : (
                  <div className="mt-5 space-y-4">
                    <div>
                      <div className="text-2xl font-semibold">{storyBible.title}</div>
                      <p className="mt-2 text-sm leading-7 text-muted-foreground">{storyBible.overview}</p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl bg-muted/20 p-4">
                        <div className="text-xs text-muted-foreground">主角设定</div>
                        <div className="mt-2 text-sm leading-7">{storyBible.protagonist}</div>
                      </div>
                      <div className="rounded-2xl bg-muted/20 p-4">
                        <div className="text-xs text-muted-foreground">连续性规则</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {storyBible.continuityRules.map((rule) => (
                            <span key={rule} className="rounded-full bg-pink-50 px-3 py-1 text-[11px] text-pink-600">
                              {rule}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    {storyBibleExpanded && (
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="rounded-2xl bg-muted/20 p-4">
                          <div className="text-xs text-muted-foreground">世界观</div>
                          <div className="mt-2 text-sm leading-7">{storyBible.world}</div>
                        </div>
                        <div className="rounded-2xl bg-muted/20 p-4">
                          <div className="text-xs text-muted-foreground">配角与氛围</div>
                          <div className="mt-2 text-sm leading-7">{storyBible.supportingCast}</div>
                        </div>
                        <div className="rounded-2xl bg-muted/20 p-4">
                          <div className="text-xs text-muted-foreground">统一视觉风格</div>
                          <div className="mt-2 text-sm leading-7">{storyBible.visualStyle}</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-lg font-semibold">分镜列表</div>
                    <p className="mt-1 text-sm text-muted-foreground">默认突出最终生图 Prompt；剧情摘要仅用于人工理解，更多细节按需展开。</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setStoryScenes((prev) => prev.map((scene) => ({ ...scene, enabled: true })))}
                      className="rounded-xl border border-border px-3 py-2 text-xs hover:bg-muted"
                    >
                      全部启用
                    </button>
                    <button
                      type="button"
                      onClick={() => setStoryScenes((prev) => prev.map((scene) => ({ ...scene, enabled: false })))}
                      className="rounded-xl border border-border px-3 py-2 text-xs hover:bg-muted"
                    >
                      全部停用
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowEnabledOnly((prev) => !prev)}
                      className="rounded-xl border border-border px-3 py-2 text-xs hover:bg-muted"
                    >
                      {showEnabledOnly ? '查看全部' : '仅看启用项'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void generateStoryQueue()}
                      disabled={storyLoading}
                      className="rounded-xl border border-border px-3 py-2 text-xs hover:bg-muted disabled:opacity-50"
                    >
                      {storyLoading ? '重生成中...' : '重生成全部分镜'}
                    </button>
                  </div>
                </div>

                <div className="mt-5 space-y-4">
                  {visibleScenes.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">
                      当前没有可展示的分镜。
                    </div>
                  ) : (
                    visibleScenes.map((scene) => {
                      const expanded = Boolean(showSceneDetails[scene.id]);
                      return (
                        <div key={scene.id} className="rounded-[26px] border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(244,114,182,0.03))] p-4 sm:p-5">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={scene.enabled}
                                onChange={(e) =>
                                  setStoryScenes((prev) =>
                                    prev.map((item) => (item.id === scene.id ? { ...item, enabled: e.target.checked } : item))
                                  )
                                }
                                className="mt-1 h-4 w-4 rounded border-border"
                              />
                              <div>
                                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Scene {scene.index + 1}</div>
                                <div className="mt-1 text-xl font-semibold">{scene.title}</div>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void refreshScene(scene)}
                                disabled={refreshingSceneId === scene.id}
                                className="rounded-xl border border-border px-3 py-2 text-xs hover:bg-muted disabled:opacity-50"
                              >
                                {refreshingSceneId === scene.id ? '刷新中...' : '刷新本段'}
                              </button>
                              <button
                                type="button"
                                onClick={() => navigator.clipboard.writeText(scene.prompt)}
                                className="rounded-xl border border-border px-3 py-2 text-xs hover:bg-muted"
                              >
                                复制提示词
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowSceneDetails((prev) => ({ ...prev, [scene.id]: !expanded }))}
                                className="rounded-xl border border-border px-3 py-2 text-xs hover:bg-muted"
                              >
                                {expanded ? '收起更多' : '展开更多'}
                              </button>
                            </div>
                          </div>

                          <div className="mt-4 rounded-[24px] border border-pink-200 bg-[linear-gradient(135deg,rgba(251,191,36,0.08),rgba(244,114,182,0.06),rgba(255,255,255,0.94))] p-4 sm:p-5">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold">最终生图 Prompt</div>
                                <div className="mt-1 text-xs text-muted-foreground">英文终态 prompt，直接提交给 Gemini，不依赖前文上下文。</div>
                              </div>
                              <span className="rounded-full border border-pink-200 bg-white/80 px-3 py-1 text-[11px] text-pink-600">
                                Primary Field
                              </span>
                            </div>
                            <textarea
                              value={scene.prompt}
                              onChange={(e) =>
                                setStoryScenes((prev) =>
                                  prev.map((item) => (item.id === scene.id ? { ...item, prompt: e.target.value } : item))
                                )
                              }
                              rows={5}
                              className="mt-4 w-full rounded-2xl border border-pink-200 bg-white px-4 py-3 font-mono text-[13px] leading-7 resize-y"
                            />
                            <div className="mt-3 grid gap-2 md:grid-cols-2">
                              <div className="rounded-2xl bg-white/80 px-3 py-3 text-xs text-muted-foreground">
                                要求：主体、环境、构图、镜头、光线、材质和风格都要写进这一条 prompt。
                              </div>
                              <div className="rounded-2xl bg-white/80 px-3 py-3 text-xs text-muted-foreground">
                                目标：这一条 prompt 本身就是完整图片任务，不需要引用上一张图。
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 rounded-2xl bg-amber-50/55 px-4 py-3">
                            <div className="text-xs text-amber-700">剧情摘要（仅辅助理解，不参与提交）</div>
                            <div className="mt-1 text-sm leading-7">{scene.paragraph}</div>
                          </div>

                          {expanded && (
                            <div className="mt-4 grid gap-3 md:grid-cols-3 text-sm">
                              <div className="rounded-2xl bg-muted/20 px-4 py-4">
                                <div className="text-xs text-muted-foreground">出图目标</div>
                                <div className="mt-2 leading-7">{scene.storyBeat}</div>
                              </div>
                              <div className="rounded-2xl bg-muted/20 px-4 py-4">
                                <div className="text-xs text-muted-foreground">角色与风格锚点</div>
                                <div className="mt-2 leading-7">{scene.continuityNotes}</div>
                              </div>
                              <div className="rounded-2xl bg-muted/20 px-4 py-4">
                                <div className="text-xs text-muted-foreground">生图约束 / Negative Prompt</div>
                                <div className="mt-2 leading-7">{scene.styleNotes}</div>
                                <div className="mt-3 rounded-xl bg-zinc-50 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                                  {scene.negativePrompt}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setCurrentStep('submit')}
                    disabled={activeSceneCount === 0}
                    className="rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    进入生成确认
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentStep('plan')}
                    className="rounded-2xl border border-border px-5 py-3 text-sm hover:bg-muted"
                  >
                    返回方案修改
                  </button>
                </div>
              </section>
            </section>
          )}

          {currentStep === 'submit' && (
            <section className="rounded-3xl border border-border bg-card p-5 sm:p-6 space-y-5">
              <div>
                <div className="text-xl font-semibold">确认并启动批量生成</div>
                <p className="mt-1 text-sm text-muted-foreground">这一步确认你提交的是最终英文生图 Prompt 队列，而不是故事背景描述。</p>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-border bg-muted/20 px-4 py-4">
                  <div className="text-xs text-muted-foreground">故事标题</div>
                  <div className="mt-2 text-sm font-medium">{storyBible?.title || '未生成'}</div>
                </div>
                <div className="rounded-2xl border border-border bg-muted/20 px-4 py-4">
                  <div className="text-xs text-muted-foreground">最终生图任务数</div>
                  <div className="mt-2 text-sm font-medium">{activeSceneCount} 条</div>
                </div>
                <div className="rounded-2xl border border-border bg-muted/20 px-4 py-4">
                  <div className="text-xs text-muted-foreground">最终生图风格</div>
                  <div className="mt-2 text-sm font-medium">{config.style || '未设置'}</div>
                </div>
                <div className="rounded-2xl border border-border bg-muted/20 px-4 py-4">
                  <div className="text-xs text-muted-foreground">实例池数量</div>
                  <div className="mt-2 text-sm font-medium">{instancePoolIds.length} 个</div>
                </div>
              </div>

              <div className="rounded-2xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
                系统会将每条启用分镜作为独立、无状态的图片生成任务提交。角色一致性依赖 prompt 内显式锚点，而不是前文记忆。
              </div>

              <div className="rounded-2xl border border-border bg-[linear-gradient(135deg,rgba(251,191,36,0.08),rgba(244,114,182,0.05),rgba(255,255,255,0.95))] px-4 py-4">
                <div className="text-sm font-semibold">提交前确认</div>
                <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
                  <div className="rounded-xl bg-white/80 px-3 py-3">每条任务使用最终英文 prompt</div>
                  <div className="rounded-xl bg-white/80 px-3 py-3">每条任务独立执行，不读取前文</div>
                  <div className="rounded-xl bg-white/80 px-3 py-3">角色一致性通过锚点直接写入 prompt</div>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-muted/15 p-4">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((prev) => !prev)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div>
                    <div className="text-sm font-semibold">高级设置</div>
                    <div className="mt-1 text-xs text-muted-foreground">这里只保留实例池配置，避免打断前面的创作流程。</div>
                  </div>
                  <span className="text-sm text-muted-foreground">{advancedOpen ? '收起' : '展开'}</span>
                </button>
                {advancedOpen && (
                  <div className="mt-4">
                    <label className="block text-xs text-muted-foreground mb-2">实例池（逗号分隔）</label>
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
                      className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm font-mono"
                    />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void launchDispatcher()}
                  disabled={running || activeSceneCount === 0}
                  className="rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {running ? '生成进行中...' : '启动批量生成'}
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentStep('scenes')}
                  className="rounded-2xl border border-border px-5 py-3 text-sm hover:bg-muted"
                >
                  返回分镜编辑
                </button>
              </div>
            </section>
          )}

          {currentStep === 'results' && (
            <section className="space-y-5">
              <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-xl font-semibold">结果回看</div>
                    <p className="mt-1 text-sm text-muted-foreground">按分镜维度回看图片结果，并反查最终生图 Prompt 是否足够精确。</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-border bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground">
                      状态 {dispatcherStatus}
                    </span>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">
                      成功 {dispatcherProgress.success}
                    </span>
                    <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">
                      失败 {dispatcherProgress.failed}
                    </span>
                  </div>
                </div>

                <div className="mt-5 rounded-3xl border border-border bg-[linear-gradient(180deg,rgba(236,72,153,0.04),rgba(255,255,255,0))] p-4">
                  <div className="h-3 overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#f59e0b,#ec4899,#3b82f6)] transition-all"
                      style={{ width: `${dispatcherProgress.percent}%` }}
                    />
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6 text-[11px]">
                    <div className="rounded-2xl border border-border bg-white px-3 py-3">
                      <div className="text-muted-foreground">总分镜</div>
                      <div className="mt-1 text-lg font-semibold">{dispatcherProgress.total}</div>
                    </div>
                    <div className="rounded-2xl border border-border bg-white px-3 py-3">
                      <div className="text-muted-foreground">完成度</div>
                      <div className="mt-1 text-lg font-semibold">{dispatcherProgress.percent}%</div>
                    </div>
                    <div className="rounded-2xl border border-border bg-white px-3 py-3">
                      <div className="text-muted-foreground">排队中</div>
                      <div className="mt-1 text-lg font-semibold">{dispatcherProgress.pending}</div>
                    </div>
                    <div className="rounded-2xl border border-border bg-white px-3 py-3">
                      <div className="text-muted-foreground">生成中</div>
                      <div className="mt-1 text-lg font-semibold">{dispatcherProgress.running}</div>
                    </div>
                    <div className="rounded-2xl border border-border bg-white px-3 py-3">
                      <div className="text-muted-foreground">已完成</div>
                      <div className="mt-1 text-lg font-semibold text-emerald-600">{dispatcherProgress.success}</div>
                    </div>
                    <div className="rounded-2xl border border-border bg-white px-3 py-3">
                      <div className="text-muted-foreground">失败 / 取消</div>
                      <div className="mt-1 text-lg font-semibold text-rose-600">
                        {dispatcherProgress.failed + dispatcherProgress.cancelled}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {submittedScenes.length === 0 ? (
                  <div className="col-span-full rounded-3xl border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">
                    任务创建后，这里会按分镜显示结果卡片。
                  </div>
                ) : (
                  submittedScenes.map((scene, index) => {
                    const item = dispatcherItems[index];
                    const mediaUrl = item?.primaryMediaUrl || item?.primaryImageUrl || '';
                    const mediaKind = inferMediaKind(mediaUrl, item?.primaryMediaType || null);
                    return (
                      <article
                        key={scene.id}
                        className={`rounded-[28px] border bg-card p-4 sm:p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)] ${
                          item?.status === 'success'
                            ? 'border-pink-200'
                            : item?.status === 'running'
                              ? 'border-sky-200'
                              : 'border-border'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Scene {index + 1}</div>
                            <div className="mt-1 text-xl font-semibold">{scene.title}</div>
                          </div>
                          <span className={`rounded-full border px-3 py-1 text-[11px] font-medium ${statusClass(item?.status || 'pending')}`}>
                            {statusLabel(item?.status || 'pending')}
                          </span>
                        </div>

                        <div className="mt-4 rounded-2xl bg-amber-50/70 px-4 py-4">
                          <div className="text-xs text-amber-700">剧情摘要（给人看）</div>
                          <div className="mt-2 text-sm leading-7">{scene.paragraph}</div>
                        </div>

                        <div className="mt-4 overflow-hidden rounded-[22px] border border-border bg-[linear-gradient(135deg,rgba(236,72,153,0.08),rgba(244,114,182,0.02),rgba(255,255,255,0.65))]">
                          {mediaUrl ? (
                            mediaKind === 'video' ? (
                              <video src={mediaUrl} className="h-52 w-full object-cover" muted playsInline preload="metadata" />
                            ) : (
                              // External media URLs are produced dynamically by dispatcher tasks.
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={mediaUrl} alt={scene.title} className="h-52 w-full object-cover" loading="lazy" />
                            )
                          ) : (
                            <div className="flex h-52 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                              {item?.status === 'running' ? '正在生成媒体...' : '等待该分镜出图'}
                            </div>
                          )}
                        </div>

                        <div className="mt-4 rounded-2xl bg-muted/20 px-4 py-4">
                          <div className="text-xs text-muted-foreground">最终生图 Prompt</div>
                          <div className="mt-2 text-sm leading-7 line-clamp-5">{scene.prompt}</div>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-3 text-[11px] text-muted-foreground">
                          <div className="rounded-2xl bg-zinc-50 px-3 py-3">
                            <div>尝试次数</div>
                            <div className="mt-1 text-foreground/85">{item?.attempts ?? 0}</div>
                          </div>
                          <div className="rounded-2xl bg-zinc-50 px-3 py-3">
                            <div>结果状态</div>
                            <div className="mt-1 text-foreground/85">{statusLabel(item?.status || 'pending')}</div>
                          </div>
                        </div>

                        {item?.error && <div className="mt-4 text-sm text-rose-600">{item.error}</div>}
                        {mediaUrl && (
                          <div className="mt-4 flex gap-2">
                            <a
                              href={mediaUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="flex-1 rounded-xl border border-border px-3 py-2 text-center text-sm hover:bg-muted"
                            >
                              打开结果
                            </a>
                            <button
                              type="button"
                              onClick={() => navigator.clipboard.writeText(mediaUrl)}
                              className="flex-1 rounded-xl bg-primary px-3 py-2 text-sm text-white hover:opacity-90"
                            >
                              复制链接
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
              </section>
            </section>
          )}

          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}
        </div>

        <aside className="rounded-3xl border border-border bg-card p-5 sm:p-6 h-fit xl:sticky xl:top-5 space-y-4">
          <div>
            <div className="text-lg font-semibold">流程摘要</div>
            <p className="mt-1 text-sm text-muted-foreground">始终保留上下文，避免在多步流程中迷路。</p>
          </div>

          <div className="space-y-3 text-sm">
            <div className="rounded-2xl bg-muted/20 px-4 py-3">
              <div className="text-xs text-muted-foreground">当前步骤</div>
              <div className="mt-1 font-semibold">{steps[currentStepIndex]?.title}</div>
            </div>
            <div className="rounded-2xl bg-muted/20 px-4 py-3">
              <div className="text-xs text-muted-foreground">灵感来源</div>
              <div className="mt-1 font-semibold">{providerLabel(ideaProvider)}</div>
            </div>
            <div className="rounded-2xl bg-muted/20 px-4 py-3">
              <div className="text-xs text-muted-foreground">已选方向</div>
              <div className="mt-1 font-semibold">{selectedIdea?.title || '未确定'}</div>
            </div>
            <div className="rounded-2xl bg-muted/20 px-4 py-3">
              <div className="text-xs text-muted-foreground">已选主题</div>
              <div className="mt-1 font-semibold">{config.theme || '未确定'}</div>
            </div>
            <div className="rounded-2xl bg-muted/20 px-4 py-3">
              <div className="text-xs text-muted-foreground">视觉风格</div>
              <div className="mt-1 font-semibold">{config.style || '未确定'}</div>
            </div>
            <div className="rounded-2xl bg-muted/20 px-4 py-3">
              <div className="text-xs text-muted-foreground">分镜数</div>
              <div className="mt-1 font-semibold">{config.sceneCount || 0} 张</div>
            </div>
            <div className="rounded-2xl bg-muted/20 px-4 py-3">
              <div className="text-xs text-muted-foreground">故事标题</div>
              <div className="mt-1 font-semibold">{storyBible?.title || '未生成'}</div>
            </div>
            <div className="rounded-2xl bg-muted/20 px-4 py-3">
              <div className="text-xs text-muted-foreground">启用分镜</div>
              <div className="mt-1 font-semibold">{activeSceneCount} / {storyScenes.length || config.sceneCount}</div>
            </div>
            <div className="rounded-2xl bg-muted/20 px-4 py-3">
              <div className="text-xs text-muted-foreground">任务状态</div>
              <div className="mt-1 font-semibold">{running ? '生成中' : dispatcherTaskId ? '等待回看' : '未启动'}</div>
            </div>
            {dispatcherTaskId && (
              <div className="rounded-2xl bg-muted/20 px-4 py-3">
                <div className="text-xs text-muted-foreground">taskId</div>
                <div className="mt-1 break-all font-mono text-xs">{dispatcherTaskId}</div>
              </div>
            )}
            {(dispatcherTaskId || running) && (
              <div className="rounded-2xl border border-border px-4 py-3">
                <div className="text-xs text-muted-foreground">运行摘要</div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl bg-zinc-50 px-3 py-3">
                    <div className="text-muted-foreground">进度</div>
                    <div className="mt-1 font-semibold text-foreground">{dispatcherProgress.percent}%</div>
                  </div>
                  <div className="rounded-xl bg-zinc-50 px-3 py-3">
                    <div className="text-muted-foreground">成功</div>
                    <div className="mt-1 font-semibold text-emerald-600">{dispatcherProgress.success}</div>
                  </div>
                  <div className="rounded-xl bg-zinc-50 px-3 py-3">
                    <div className="text-muted-foreground">失败</div>
                    <div className="mt-1 font-semibold text-rose-600">{dispatcherProgress.failed}</div>
                  </div>
                  <div className="rounded-xl bg-zinc-50 px-3 py-3">
                    <div className="text-muted-foreground">运行中</div>
                    <div className="mt-1 font-semibold text-sky-600">{dispatcherProgress.running}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}
