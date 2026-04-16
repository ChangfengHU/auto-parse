'use client';

import { useEffect, useRef, useState } from 'react';
import type { StoryDirection } from '@/app/api/visual-story/direction/route';
import type { StoryOutline } from '@/app/api/visual-story/outline/route';
import type { StoryboardSegment, StoryScene } from '@/app/api/visual-story/storyboard/route';

// ─── Types ───────────────────────────────────────────────────────────────────

type PageStep = 'setting' | 'outline' | 'prompting' | 'imaging' | 'assembly';

type DispatcherItem = {
  index: number;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  attempts: number;
  primaryMediaUrl: string | null;
  primaryImageUrl: string | null;
  primaryMediaType: string | null;
  error?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mediaUrl(item?: DispatcherItem): string {
  return item?.primaryMediaUrl || item?.primaryImageUrl || '';
}

function statusColor(s?: DispatcherItem['status']) {
  switch (s) {
    case 'success': return 'border-emerald-400/60 bg-emerald-500/5';
    case 'failed': return 'border-rose-400/60 bg-rose-500/5';
    case 'running': return 'border-sky-400/60 bg-sky-500/5';
    case 'cancelled': return 'border-zinc-400/40 bg-zinc-500/5';
    default: return 'border-border/50 bg-muted/10';
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepDot({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
      done ? 'bg-emerald-500 text-white' : active ? 'bg-foreground text-white' : 'border border-border text-muted-foreground bg-background'
    }`}>
      {done ? '✓' : n}
    </span>
  );
}

function StepBar({ step, onStepClick }: { step: PageStep; onStepClick: (s: PageStep) => void }) {
  const steps: { id: PageStep; label: string }[] = [
    { id: 'setting', label: '故事设定' },
    { id: 'outline', label: '大纲规划' },
    { id: 'prompting', label: '分镜提示词' },
    { id: 'imaging', label: '图片生成' },
    { id: 'assembly', label: '最终组装' },
  ];
  const idx = steps.findIndex(s => s.id === step);
  return (
    <div className="flex items-center gap-2 text-sm overflow-x-auto no-scrollbar py-1">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2 shrink-0">
          {i > 0 && <div className={`h-px w-4 sm:w-8 ${i <= idx ? 'bg-foreground/30' : 'bg-border'}`} />}
          <button
            onClick={() => onStepClick(s.id)}
            disabled={i > idx && i !== idx + 1} // Only allow jumping back or to the very next step
            className={`flex items-center gap-1.5 transition-opacity ${i > idx && i !== idx + 1 ? 'opacity-30 cursor-not-allowed' : 'hover:opacity-80'}`}
          >
            <StepDot n={i + 1} active={i === idx} done={i < idx} />
            <span className={i === idx ? 'font-semibold text-foreground text-xs' : 'text-muted-foreground text-[10px] sm:text-xs'}>{s.label}</span>
          </button>
        </div>
      ))}
    </div>
  );
}

function VisualLockBadge({ outline }: { outline: StoryOutline }) {
  return (
    <div className="rounded-2xl border border-amber-200/60 bg-amber-50/40 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">🔒 视觉锁定</span>
        <span className="text-[10px] text-amber-600/70">所有 {outline.segments.reduce((s, g) => s + g.beats.length, 0)} 张图片共享以下锚点</span>
      </div>
      <div className="grid gap-1.5 text-[11px] text-muted-foreground">
        <div><span className="text-foreground/60 font-medium">画风：</span>{outline.visualLock.styleKeywords}</div>
        <div><span className="text-foreground/60 font-medium">色调：</span>{outline.visualLock.colorPalette}</div>
        <div><span className="text-foreground/60 font-medium">光线：</span>{outline.visualLock.lightingStyle}</div>
        {outline.characters.map(c => (
          <div key={c.name}>
            <span className="text-foreground/60 font-medium">{c.name}：</span>
            <span className="text-amber-700/80">{c.visualDescriptionZh}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SceneTile({
  scene,
  item,
}: {
  scene: StoryScene;
  item?: DispatcherItem;
}) {
  const url = mediaUrl(item);
  const status = item?.status;

  return (
    <div className={`rounded-2xl border overflow-hidden transition-all ${statusColor(status)}`}>
      <div className="aspect-square relative">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={scene.narrative} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-muted/20 px-3">
            {status === 'running' && (
              <div className="w-4 h-4 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
            )}
            <p className="text-[10px] text-center text-muted-foreground leading-relaxed line-clamp-4">
              {scene.narrative}
            </p>
          </div>
        )}
        {/* Beat index badge */}
        <span className="absolute top-1.5 left-1.5 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] text-white font-mono">
          #{scene.globalIndex + 1}
        </span>
      </div>
      {url && (
        <div className="flex gap-1 p-1.5">
          <a href={url} target="_blank" rel="noreferrer"
            className="flex-1 text-center text-[10px] text-muted-foreground hover:text-foreground py-1 rounded-lg hover:bg-muted transition-colors">
            查看
          </a>
          <button onClick={() => navigator.clipboard.writeText(url)}
            className="flex-1 text-center text-[10px] text-muted-foreground hover:text-foreground py-1 rounded-lg hover:bg-muted transition-colors">
            复制
          </button>
        </div>
      )}
      {item?.error && (
        <div className="px-2 py-1.5 text-[10px] text-rose-600 line-clamp-2 border-t border-rose-200/50">
          {item.error}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function VisualStoryPage() {
  const [step, setStep] = useState<PageStep>('setting');
  const [brief, setBrief] = useState('');
  const [direction, setDirection] = useState<StoryDirection | null>(null);
  const [outline, setOutline] = useState<StoryOutline | null>(null);
  const [segments, setSegments] = useState<StoryboardSegment[]>([]);
  const [segmentCount, setSegmentCount] = useState(6);

  const [directionLoading, setDirectionLoading] = useState(false);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [storyboardLoading, setStoryboardLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState('');

  const [taskId, setTaskId] = useState<string | null>(null);
  const [dispatcherStatus, setDispatcherStatus] = useState('');
  const [items, setItems] = useState<DispatcherItem[]>([]);
  const [progress, setProgress] = useState({ success: 0, failed: 0, running: 0, total: 0, percent: 0 });

  const pollingRef = useRef(false);

  // Restore all state from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('visual-story-v2-state');
      if (saved) {
        const data = JSON.parse(saved);
        if (data.step) setStep(data.step);
        if (data.brief) setBrief(data.brief);
        if (data.direction) setDirection(data.direction);
        if (data.outline) setOutline(data.outline);
        if (data.segments) setSegments(data.segments);
        if (data.segmentCount) setSegmentCount(data.segmentCount);
        if (data.taskId) setTaskId(data.taskId);
      }
    } catch (e) {
      console.warn('Failed to restore state', e);
    }
  }, []);

  // Persist state to localStorage
  useEffect(() => {
    const state = { step, brief, direction, outline, segments, segmentCount, taskId };
    localStorage.setItem('visual-story-v2-state', JSON.stringify(state));
  }, [step, brief, direction, outline, segments, segmentCount, taskId]);

  // Poll dispatcher when taskId is set
  useEffect(() => {
    if (!taskId) return;
    pollingRef.current = true;

    async function poll() {
      if (!pollingRef.current || !taskId) return;
      try {
        const res = await fetch(`/api/gemini-web/image/ads-dispatcher/tasks/${taskId}/summary`);
        const data = await res.json() as {
          status?: string; done?: boolean;
          progress?: typeof progress;
          items?: DispatcherItem[];
        };
        if (!res.ok) throw new Error(data as unknown as string);
        setDispatcherStatus(String(data.status || ''));
        setProgress(data.progress ?? { success: 0, failed: 0, running: 0, total: 0, percent: 0 });
        setItems(Array.isArray(data.items) ? data.items : []);
        if (!data.done) setTimeout(() => void poll(), 2000);
        else setLaunching(false);
      } catch {
        setTimeout(() => void poll(), 4000);
      }
    }
    void poll();
    return () => { pollingRef.current = false; };
  }, [taskId]);

  // ─── Step 1: Direction ──────────────────────────────────────────────────────

  async function fetchDirection() {
    setDirectionLoading(true);
    setError('');
    try {
      const res = await fetch('/api/visual-story/direction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief }),
      });
      const data = await res.json() as { direction?: StoryDirection; error?: string };
      if (!res.ok || !data.direction) throw new Error(data.error || '方向生成失败');
      setDirection(data.direction);
      // Reset downstream
      setOutline(null);
      setSegments([]);
      setTaskId(null);
      setItems([]);
      setStep('setting');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDirectionLoading(false);
    }
  }

  // ─── Step 2: Outline ─────────────────────────────────────────────────────────

  async function fetchOutline() {
    if (!direction) return;
    setOutlineLoading(true);
    setError('');
    setStep('outline');
    try {
      const res = await fetch('/api/visual-story/outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction, segmentCount }),
      });
      const data = await res.json() as { outline?: StoryOutline; error?: string };
      if (!res.ok || !data.outline) throw new Error(data.error || '大纲生成失败');
      setOutline(data.outline);
      setSegments([]);
      setTaskId(null);
      setItems([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOutlineLoading(false);
    }
  }

  // ─── Step 3: Storyboard ──────────────────────────────────────────────────────

  async function fetchStoryboard() {
    if (!outline) return;
    setStoryboardLoading(true);
    setError('');
    const resStep: PageStep = 'prompting';
    setStep(resStep);
    try {
      const res = await fetch('/api/visual-story/storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outline }),
      });
      const data = await res.json() as { segments?: StoryboardSegment[]; error?: string };
      if (!res.ok || !data.segments) throw new Error(data.error || '分镜生成失败');
      setSegments(data.segments);
      setTaskId(null);
      setItems([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStoryboardLoading(false);
    }
  }

  // ─── Launch dispatcher ───────────────────────────────────────────────────────

  async function launch() {
    const allScenes = segments.flatMap(s => s.scenes);
    if (allScenes.length === 0) return;
    setLaunching(true);
    setError('');
    setItems([]);
    try {
      const res = await fetch('/api/gemini-web/image/ads-dispatcher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompts: allScenes.map(s => s.prompt),
          instanceIds: ['k1b908rw', 'k1bdaoa7', 'k1ba8vac'],
          maxAttemptsPerPrompt: 5,
          childTaskTimeoutMs: 8 * 60 * 1000,
          autoCloseTab: false,
        }),
      });
      const data = await res.json() as { taskId?: string; error?: string };
      if (!res.ok || !data.taskId) throw new Error(data.error || '任务创建失败');
      setTaskId(data.taskId);
      setStep('imaging');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLaunching(false);
    }
  }

  // ─── Derived ──────────────────────────────────────────────────────────────────

  const allScenes: StoryScene[] = segments.flatMap(s => s.scenes);
  const totalImages = allScenes.length;
  const hasResults = items.length > 0;

  function getItem(scene: StoryScene): DispatcherItem | undefined {
    return items.find(it => it.index === scene.globalIndex);
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border bg-card/80 backdrop-blur px-4 sm:px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <h1 className="text-base font-semibold shrink-0">视觉故事工作台</h1>
            <StepBar step={step} onStepClick={setStep} />
          </div>
          {taskId && (
            <a href={`/ads-dispatcher/${taskId}`} target="_blank" rel="noreferrer"
              className="text-xs text-muted-foreground hover:text-primary transition-colors">
              查看任务详情 ↗
            </a>
          )}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* ── Error ── */}
        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex items-start gap-2">
            <span className="mt-0.5">⚠</span>
            <span>{error}</span>
            <button onClick={() => setError('')} className="ml-auto text-rose-400 hover:text-rose-600">✕</button>
          </div>
        )}

        {/* ── Steps ── */}
        <div className="space-y-6">
          {step === 'setting' && (
            <StepSetting
              brief={brief}
              setBrief={setBrief}
              direction={direction}
              loading={directionLoading}
              onFetch={fetchDirection}
              segmentCount={segmentCount}
              setSegmentCount={setSegmentCount}
              onNext={() => setStep('outline')}
            />
          )}

          {step === 'outline' && (
            <StepOutline
              outline={outline}
              loading={outlineLoading}
              onFetch={fetchOutline}
              onNext={() => setStep('prompting')}
            />
          )}

          {step === 'prompting' && (
            <StepPrompting
              outline={outline}
              segments={segments}
              loading={storyboardLoading}
              onFetch={fetchStoryboard}
              onNext={() => setStep('imaging')}
            />
          )}

          {step === 'imaging' && (
            <StepImaging
              segments={segments}
              taskId={taskId}
              dispatcherStatus={dispatcherStatus}
              progress={progress}
              items={items}
              onLaunch={launch}
              launching={launching}
              onNext={() => setStep('assembly')}
            />
          )}

          {step === 'assembly' && (
            <StepAssembly
              segments={segments}
              items={items}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step Components ─────────────────────────────────────────────────────────

function StepSetting({ brief, setBrief, direction, loading, onFetch, segmentCount, setSegmentCount, onNext }: any) {
  return (
    <section className="rounded-3xl border border-border bg-card p-5 sm:p-6 space-y-5 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">故事方向</div>
          <p className="mt-0.5 text-sm text-muted-foreground">AI 帮你发现一个有画面感的故事方向，每次结果都不同。</p>
        </div>
      </div>

      <div className="flex gap-3">
        <input
          value={brief}
          onChange={e => setBrief(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onFetch()}
          placeholder="可选：输入一个关键词方向（留空则完全随机发散）"
          className="flex-1 rounded-2xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
        />
        <button onClick={onFetch} disabled={loading}
          className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 whitespace-nowrap">
          {loading ? '思考中...' : direction ? '换一个方向' : '发现故事方向'}
        </button>
      </div>

      {direction && (
        <div className="rounded-[24px] border border-primary/20 bg-[linear-gradient(135deg,rgba(99,102,241,0.06),rgba(244,114,182,0.05),rgba(255,255,255,0.9))] p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2 flex-1">
              <div className="text-xl font-semibold">{direction.concept}</div>
              <p className="text-sm text-muted-foreground italic">"{direction.hook}"</p>
              <div className="flex flex-wrap gap-2 mt-3">
                {[direction.mood, direction.suggestedStyle].map(tag => (
                  <span key={tag} className="rounded-full bg-white/80 border border-border px-3 py-1 text-xs text-muted-foreground">{tag}</span>
                ))}
              </div>
              <div className="grid gap-2 mt-3 md:grid-cols-2 text-sm">
                <div className="rounded-2xl bg-white/70 px-3 py-2.5">
                  <div className="text-xs text-muted-foreground">主角形象</div>
                  <div className="mt-1 font-medium">{direction.protagonistHint}</div>
                </div>
                <div className="rounded-2xl bg-white/70 px-3 py-2.5">
                  <div className="text-xs text-muted-foreground">世界观</div>
                  <div className="mt-1 font-medium">{direction.worldHint}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">桥段数</span>
              <input type="number" min={5} max={7} value={segmentCount}
                onChange={e => setSegmentCount(Math.max(5, Math.min(7, Number(e.target.value) || 6)))}
                className="w-16 rounded-xl border border-border bg-background px-3 py-1.5 text-sm text-center" />
              <span className="text-muted-foreground text-xs">× 4张 = {segmentCount * 4} 张图</span>
            </div>
            <button onClick={onNext}
              className="rounded-2xl bg-foreground px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 hover:bg-foreground/80 ml-auto">
              确定方向，前往规划大纲 →
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function StepOutline({ outline, loading, onFetch, onNext }: any) {
  return (
    <section className="rounded-3xl border border-border bg-card p-5 sm:p-6 space-y-5 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">故事大纲与视觉锁定</div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {loading ? '正在深度思考，构建完整的故事骨架和视觉锁定元素...' : 'AI 深度思考模式，建立视觉连贯性锚点。'}
          </p>
        </div>
        {!loading && (
          <button onClick={onFetch} disabled={loading}
            className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {outline ? '重新生成大纲' : '生成大纲'}
          </button>
        )}
      </div>

      {loading && (
        <div className="rounded-2xl border border-border bg-muted/10 p-8 flex flex-col items-center gap-4">
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="w-1.5 h-6 rounded-full bg-primary/40 animate-pulse" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
          <div className="text-sm text-muted-foreground text-center">
            <div>AI 正在深度构思…</div>
            <div className="text-xs mt-1 opacity-60">建立角色设定 · 设计故事弧线 · 锁定视觉元素</div>
          </div>
        </div>
      )}

      {outline && !loading && (
        <div className="space-y-5">
          <div>
            <div className="text-2xl font-bold">{outline.title}</div>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">{outline.logline}</p>
            {outline.emotionalArc && (
              <p className="mt-1 text-xs text-muted-foreground/70 italic">{outline.emotionalArc}</p>
            )}
          </div>

          <VisualLockBadge outline={outline} />

          <div className="space-y-2">
            <div className="text-sm font-semibold text-muted-foreground">故事桥段</div>
            <div className="grid gap-2 md:grid-cols-2">
              {outline.segments.map((seg: any, i: number) => (
                <div key={seg.segmentIndex} className="rounded-2xl border border-border bg-muted/10 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground/60">#{i + 1}</span>
                    <span className="text-sm font-semibold">{seg.title}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">× 4张</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed line-clamp-2">{seg.narrative}</p>
                </div>
              ))}
            </div>
          </div>

          <button onClick={onNext}
            className="rounded-2xl bg-foreground px-6 py-3 text-sm font-semibold text-white disabled:opacity-50 hover:bg-foreground/80 w-full md:w-auto">
            规划完成，生成分镜提示词 →
          </button>
        </div>
      )}
    </section>
  );
}

function StepPrompting({ outline, segments, loading, onFetch, onNext }: any) {
  return (
    <section className="rounded-3xl border border-border bg-card p-5 sm:p-6 space-y-5 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">分镜提示词优化</div>
          <p className="mt-0.5 text-sm text-muted-foreground">为每个节拍生成精确的 AI 生图指令。你可以根据需要微调。</p>
        </div>
        {!loading && (
          <button onClick={onFetch} disabled={loading}
            className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {segments.length > 0 ? '重新生成提示词' : '生成提示词'}
          </button>
        )}
      </div>

      {loading && (
        <div className="rounded-3xl border border-border bg-muted/5 p-8 flex flex-col items-center gap-4">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <div className="text-sm text-muted-foreground text-center">正在为 {outline?.segments.length * 4} 个分镜生成提示词...</div>
        </div>
      )}

      {segments.length > 0 && !loading && (
        <div className="space-y-6">
          <div className="grid gap-6">
            {segments.map((seg: any) => (
              <div key={seg.segmentIndex} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">Segment {seg.segmentIndex + 1}</span>
                  <h3 className="text-sm font-semibold">{seg.title}</h3>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {seg.scenes.map((scene: any) => (
                    <div key={scene.globalIndex} className="rounded-2xl border border-border bg-background p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-muted-foreground">Shot #{scene.globalIndex + 1}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{scene.narrative}</p>
                      <div className="rounded-xl bg-muted/30 p-2 text-[10px] font-mono text-muted-foreground break-all line-clamp-3 overflow-hidden border border-border/50">
                        {scene.prompt}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <button onClick={onNext}
            className="rounded-2xl bg-foreground px-6 py-3 text-sm font-semibold text-white hover:bg-foreground/80 w-full md:w-auto">
            提示词已就绪，开始生图任务 →
          </button>
        </div>
      )}
    </section>
  );
}

function StepImaging({ segments, taskId, dispatcherStatus, progress, items, onLaunch, launching, onNext }: any) {
  const allScenes = segments.flatMap((s: any) => s.scenes);
  const totalImages = allScenes.length;
  const isDone = dispatcherStatus === 'success' || (progress.total > 0 && progress.percent === 100);

  function getItem(scene: any) {
    return items.find((it: any) => it.index === scene.globalIndex);
  }

  return (
    <section className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      <div className="rounded-2xl border border-border bg-card p-4 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-0">
          {taskId ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-sm">
                <span className={`font-semibold ${
                  dispatcherStatus === 'success' ? 'text-emerald-600' :
                  dispatcherStatus === 'failed' ? 'text-rose-600' : 'text-sky-600'
                }`}>
                  {dispatcherStatus === 'running' ? '生成中' :
                   dispatcherStatus === 'success' ? '全部完成' :
                   dispatcherStatus === 'queued' ? '排队中' : dispatcherStatus}
                </span>
                <span className="text-muted-foreground text-xs">
                  ✓{progress.success} / {progress.total} 张 &nbsp;·&nbsp;
                  {progress.running > 0 && `⚡${progress.running} 进行中`}
                  {progress.failed > 0 && ` ✗${progress.failed} 失败`}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 via-pink-500 to-indigo-500 transition-all duration-500"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              共 <span className="font-semibold text-foreground">{totalImages}</span> 张图片等待生成
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {!taskId ? (
            <button onClick={onLaunch} disabled={launching || totalImages === 0}
              className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 hover:bg-primary/90 whitespace-nowrap">
              {launching ? '提交中...' : `🚀 开始批量生图`}
            </button>
          ) : (
            <button onClick={onNext} disabled={!isDone}
              className={`rounded-2xl px-5 py-2.5 text-sm font-semibold text-white whitespace-nowrap ${isDone ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-muted text-muted-foreground cursor-not-allowed'}`}>
              生图完成，进入组装预览 →
            </button>
          )}
        </div>
      </div>

      <div className="space-y-8">
        {segments.map((seg: any) => (
          <div key={seg.segmentIndex}>
            <div className="flex items-baseline gap-3 mb-3">
              <span className="text-xs font-mono text-muted-foreground/50">{String(seg.segmentIndex + 1).padStart(2, '0')}</span>
              <h3 className="font-semibold text-foreground">{seg.title}</h3>
              <p className="text-xs text-muted-foreground flex-1 line-clamp-1">{seg.narrative}</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {seg.scenes.map((scene: any) => (
                <SceneTile key={scene.globalIndex} scene={scene} item={getItem(scene)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StepAssembly({ segments, items }: any) {
  function getItem(scene: any) {
    return items.find((it: any) => it.index === scene.globalIndex);
  }

  return (
    <section className="bg-muted/10 rounded-3xl p-4 sm:p-8 space-y-12 animate-in zoom-in-95 duration-500">
      <div className="max-w-2xl mx-auto space-y-16">
        <header className="text-center space-y-4">
          <h2 className="text-3xl font-bold tracking-tight">故事成品预览</h2>
          <div className="h-1 w-20 bg-primary mx-auto rounded-full" />
        </header>

        {segments.map((seg: any) => (
          <div key={seg.segmentIndex} className="space-y-8">
            <div className="space-y-3">
              <h3 className="text-xl font-bold border-l-4 border-primary pl-4">{seg.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{seg.narrative}</p>
            </div>

            <div className="grid gap-12">
              {seg.scenes.map((scene: any) => {
                const item = getItem(scene);
                const url = item?.primaryMediaUrl || item?.primaryImageUrl;
                return (
                  <div key={scene.globalIndex} className="group space-y-4">
                    <div className="aspect-[4/5] rounded-2xl overflow-hidden bg-muted shadow-xl transition-transform duration-500 group-hover:scale-[1.02]">
                      {url ? (
                        <img src={url} alt={scene.narrative} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs italic">
                          图片未生成
                        </div>
                      )}
                    </div>
                    <p className="text-lg leading-relaxed text-foreground/90 font-medium px-2">
                      {scene.narrative}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <footer className="pt-12 pb-6 text-center border-t border-border/50">
          <p className="text-sm text-muted-foreground">—— 故事结束 ——</p>
          <div className="mt-8 flex justify-center gap-4">
            <button onClick={() => window.print()} className="rounded-2xl border border-border px-6 py-2.5 text-sm hover:bg-background transition-colors">
              打印预览
            </button>
            <button className="rounded-2xl bg-foreground text-white px-6 py-2.5 text-sm hover:bg-foreground/80 transition-colors">
              复制全文图片
            </button>
          </div>
        </footer>
      </div>
    </section>
  );
}
