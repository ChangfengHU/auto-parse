'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { ImageGalleryPreview } from '@/components/image-gallery-preview';

/* ─── Types ─── */
type ItemStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
type InstanceState = 'idle' | 'running' | 'inactive' | 'busy';
type AttemptOutcome = 'running' | 'success' | 'failed' | 'timeout' | 'create_failed' | 'cancelled';

interface AttemptHistoryEntry {
  attempt: number;
  prompt?: string;
  browserInstanceId?: string;
  batchTaskId?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  outcome?: AttemptOutcome;
  error?: string;
  failureCategory?: string;
  rewriteApplied?: boolean;
  rewriteReason?: string;
}

interface DispatcherItem {
  id: string;
  index: number;
  prompt: string;
  sourceImageUrls: string[];
  promptHistory?: string[];
  promptOptimizedCount?: number;
  status: ItemStatus;
  attempts: number;
  browserInstanceId?: string;
  batchTaskId?: string;
  batchTaskHistory?: string[];
  mediaUrls: string[];
  imageUrls: string[];
  primaryMediaType?: 'image' | 'video' | 'unknown';
  error?: string;
  failureCategory?: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  attemptHistory?: AttemptHistoryEntry[];
}

interface DispatcherInstance {
  instanceId: string;
  state: InstanceState;
  leaseId?: string;
  currentItemId?: string;
  currentPrompt?: string;
  batchTaskId?: string;
  startedAt?: string;
  lastAssignedAt?: string;
  lastReleasedAt?: string;
  lastResultStatus?: string;
  lastMediaUrl?: string | null;
  lastMediaType?: string;
  lastError?: string;
  detail?: string;
  cooldownUntil?: string;
  consecutiveFailures: number;
  successCount: number;
  failureCount: number;
}

interface TaskSettings {
  instanceIds: string[];
  workflowId?: string;
  promptVarName?: string;
  maxAttemptsPerPrompt: number;
  pollIntervalMs: number;
  childTaskTimeoutMs: number;
  dispatcherTimeoutMs: number;
  maxIdleCyclesWithoutAssignment: number;
  instanceCooldownMs: number;
  failureCooldownThreshold: number;
  autoCloseTab: boolean;
  optimizePromptOnRetry: boolean;
  promptOptimizationModel: string;
}

interface TaskPreflight {
  requestedPromptCount: number;
  acceptedPromptCount: number;
  totalInstances: number;
  idleInstances: number;
  busyInstances: number;
  inactiveInstances: number;
  willWaitForCapacity: boolean;
}

interface TaskMetrics {
  totalAssignments: number;
  totalCompletions: number;
  idleCyclesWithoutAssignment: number;
}

interface TaskSummary {
  total: number;
  pending: number;
  running: number;
  success: number;
  failed: number;
  cancelled: number;
}

interface TaskDetail {
  id: string;
  status: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  cancelRequested: boolean;
  cancelReason?: string;
  pausedAt?: string;
  pauseReason?: string;
  error?: string;
  warnings: string[];
  preflight: TaskPreflight;
  settings: TaskSettings;
  summary: TaskSummary;
  metrics: TaskMetrics;
  prompts: string[];
  items: DispatcherItem[];
  instances: DispatcherInstance[];
  queue: { state: string; position?: number; size: number; runningTaskId?: string };
  result?: {
    durationMs?: number;
    retriedItemCount?: number;
    failureCategoryStats?: Record<string, number>;
  };
  traceUrl?: string;
  done: boolean;
}

/* ─── Helpers ─── */
const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  running: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  paused: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  success: 'bg-green-500/20 text-green-400 border-green-500/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
  cancelled: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  pending: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中', running: '运行中', paused: '已暂停',
  success: '已完成', failed: '失败', cancelled: '已取消',
  pending: '待处理',
};

const INST_STATE_COLORS: Record<InstanceState, string> = {
  idle: 'text-green-400',
  running: 'text-blue-400',
  inactive: 'text-gray-400',
  busy: 'text-orange-400',
};

const INST_STATE_LABELS: Record<InstanceState, string> = {
  idle: '空闲', running: '运行中', inactive: '不活跃', busy: '占用中',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[status] ?? 'bg-muted text-muted-foreground border-border'}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function formatTime(iso?: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

function formatMaybeMs(ms?: number) {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return '-';
  return formatMs(ms);
}

function failureCategoryLabel(category?: string) {
  const labels: Record<string, string> = {
    fast_fail: '快速失败',
    timeout: '超时',
    policy_blocked: '策略/违禁',
    policy_violation: '策略/违禁',
    no_media: '无媒体结果',
    no_result: '无结果',
    child_create_failed: '子任务创建失败',
    network: '网络异常',
    network_error: '网络异常',
    unknown: '未知',
  };
  return labels[category || ''] || (category || '未分类');
}

function outcomeLabel(outcome?: AttemptOutcome) {
  const labels: Record<string, string> = {
    running: '运行中',
    success: '成功',
    failed: '失败',
    timeout: '超时',
    create_failed: '创建失败',
    cancelled: '已取消',
  };
  return labels[outcome || ''] || (outcome || '-');
}

function truncate(s: string, n = 60) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/* ─── Child task types ─── */
interface Checkpoint {
  stepIndex: number;
  name: string;
  status: 'running' | 'ok' | 'error' | 'cancelled';
  message: string;
  timestamp: string;
}

interface WebImageTask {
  id: string;
  status: string;
  workflowName: string;
  error?: string;
  startedAt?: string;
  endedAt?: string;
  checkpoints: Checkpoint[];
}

interface BatchTaskRun {
  index: number;
  taskId?: string;
  browserInstanceId: string;
  status: string;
  attempts: number;
  primaryMediaUrl: string | null;
  primaryMediaType: string | null;
  primaryImageUrl: string | null;
  error?: string;
  startedAt?: string;
  endedAt?: string;
}

interface BatchTask {
  id: string;
  status: string;
  workflowName: string;
  startedAt?: string;
  endedAt?: string;
  result?: { runs: BatchTaskRun[] };
}

const CP_ICON: Record<string, string> = { ok: '✓', error: '✗', cancelled: '✕', running: '⟳' };
const CP_COLOR: Record<string, string> = {
  ok: 'text-green-400',
  error: 'text-red-400',
  cancelled: 'text-gray-400',
  running: 'text-blue-400',
};

function CheckpointTimeline({ checkpoints }: { checkpoints: Checkpoint[] }) {
  // Keep last checkpoint per stepIndex (running → ok/error)
  const stepMap = new Map<number, Checkpoint>();
  for (const cp of checkpoints) stepMap.set(cp.stepIndex, cp);
  const steps = Array.from(stepMap.values()).sort((a, b) => a.stepIndex - b.stepIndex);

  if (steps.length === 0) {
    return <div className="text-xs text-muted-foreground">等待工作流启动…</div>;
  }

  return (
    <div className="space-y-1">
      {steps.map(cp => (
        <div key={cp.stepIndex} className="flex items-start gap-2 text-xs">
          <span className={`shrink-0 w-4 text-center font-bold ${CP_COLOR[cp.status] ?? 'text-muted-foreground'} ${cp.status === 'running' ? 'animate-spin' : ''}`}>
            {CP_ICON[cp.status] ?? '·'}
          </span>
          <span className="shrink-0 text-muted-foreground w-5 text-right">{cp.stepIndex + 1}</span>
          <span className={`font-medium ${cp.status === 'running' ? 'text-foreground' : cp.status === 'ok' ? 'text-foreground/70' : 'text-foreground'}`}>
            {cp.name}
          </span>
          <span className={`flex-1 ${CP_COLOR[cp.status] ?? 'text-muted-foreground'}`}>{cp.message}</span>
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {new Date(cp.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>
      ))}
    </div>
  );
}

function HistoricalAttempt({ attemptIndex, batchTaskId }: { attemptIndex: number; batchTaskId: string }) {
  const [detail, setDetail] = useState<{ status: string; error?: string; workflowId?: string; startedAt?: number; completedAt?: number } | null>(null);

  useEffect(() => {
    fetch(`/api/workflows/tasks/${batchTaskId}`)
      .then(r => r.ok ? r.json() : null)
      .then((wt: any) => {
        if (!wt) return;
        setDetail({
          status: wt.status,
          workflowId: wt.workflowId,
          error: wt.errorMessage || undefined,
          startedAt: wt.startedAt,
          completedAt: wt.completedAt,
        });
      })
      .catch(() => null);
  }, [batchTaskId]);

  return (
    <div className="flex items-start gap-3 bg-red-500/5 border border-red-500/15 rounded-lg px-3 py-2 text-xs">
      <span className="shrink-0 text-red-400 font-medium">第 {attemptIndex} 次</span>
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <code className="font-mono text-muted-foreground">{batchTaskId.slice(0, 12)}…</code>
          {detail?.workflowId && <span className="text-muted-foreground">{detail.workflowId.slice(0, 8)}…</span>}
          {detail && <StatusBadge status={detail.status} />}
        </div>
        {detail?.error && (
          <div className="text-red-400 break-all">{detail.error}</div>
        )}
        {detail?.completedAt && (
          <div className="text-muted-foreground">结束：{formatTime(detail.completedAt)}</div>
        )}
      </div>
    </div>
  );
}

function ItemExpandedDetail({ item, onOpenGallery }: { item: DispatcherItem; onOpenGallery: () => void }) {
  const [wfTask, setWfTask] = useState<any | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!item.batchTaskId) return;
    try {
      const wRes = await fetch(`/api/workflows/tasks/${item.batchTaskId}`);
      if (!wRes.ok) { setFetchError(`workflow task ${wRes.status}`); return; }
      setWfTask(await wRes.json());
      setFetchError(null);
    } catch (e) {
      setFetchError(String(e));
    }
  }, [item.batchTaskId]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // Poll while running
  const isActive = Boolean(item.batchTaskId) && (wfTask === null || !['done', 'error', 'stopped'].includes(String(wfTask.status)));
  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => void fetchAll(), 2000);
    return () => clearInterval(t);
  }, [isActive, fetchAll]);

  return (
    <div className="space-y-4 text-xs">
      {/* Meta row */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground">
        <span>开始：{formatTime(item.startedAt)}</span>
        <span>结束：{formatTime(item.endedAt)}</span>
        <span>耗时：{formatMaybeMs(item.durationMs)}</span>
        {item.failureCategory && <span>失败分类：<span className="text-red-400">{failureCategoryLabel(item.failureCategory)}</span></span>}
        {item.browserInstanceId && (
          <span>实例：<code className="font-mono text-foreground">{item.browserInstanceId}</code></span>
        )}
        {item.batchTaskId && (
          <span>子任务：<code className="font-mono text-primary">{item.batchTaskId.slice(0, 12)}…</code></span>
        )}
        {item.batchTaskId && (
          <a className="text-primary hover:underline" href={`/api/workflows/tasks/${item.batchTaskId}`} target="_blank" rel="noreferrer">
            打开子任务详情(JSON)
          </a>
        )}
      </div>

      {/* 尝试明细 */}
      {item.attemptHistory && item.attemptHistory.length > 0 && (
        <div>
          <div className="font-medium text-muted-foreground mb-2">尝试明细（{item.attemptHistory.length}）</div>
          <div className="space-y-1.5">
            {item.attemptHistory.map((attempt) => (
              <div key={`${item.id}-attempt-${attempt.attempt}`} className="bg-muted/20 border border-border rounded-lg px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">第 {attempt.attempt} 次</span>
                  <span className="text-muted-foreground">状态：{outcomeLabel(attempt.outcome)}</span>
                  <span className="text-muted-foreground">耗时：{formatMaybeMs(attempt.durationMs)}</span>
                  {attempt.failureCategory && <span className="text-red-400">分类：{failureCategoryLabel(attempt.failureCategory)}</span>}
                  {attempt.rewriteApplied && (
                    <span className="text-amber-400 border border-amber-500/30 rounded px-1">
                      已改写{attempt.rewriteReason ? ` (${attempt.rewriteReason})` : ''}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                  <span>开始：{formatTime(attempt.startedAt)}</span>
                  <span>结束：{formatTime(attempt.endedAt)}</span>
                  {attempt.browserInstanceId && <span>实例：{attempt.browserInstanceId}</span>}
                  {attempt.batchTaskId && <span>Batch：<code className="font-mono text-primary">{attempt.batchTaskId.slice(0, 12)}…</code></span>}
                </div>
                {attempt.error && <div className="mt-1 text-red-400 break-all">{attempt.error}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 历史尝试记录（旧数据兼容） */}
      {(!item.attemptHistory || item.attemptHistory.length === 0) && item.batchTaskHistory && item.batchTaskHistory.length > 0 && (
        <div>
          <div className="font-medium text-muted-foreground mb-2">历史尝试（{item.batchTaskHistory.length} 次失败）</div>
          <div className="space-y-1.5">
            {item.batchTaskHistory.map((prevBatchId, i) => (
              <HistoricalAttempt key={prevBatchId} attemptIndex={i + 1} batchTaskId={prevBatchId} />
            ))}
          </div>
        </div>
      )}

      {/* Prompt history */}
      {item.promptHistory && item.promptHistory.length > 1 && (
        <div>
          <div className="text-muted-foreground mb-1.5 font-medium">Prompt 改写历史</div>
          <div className="space-y-1.5">
            {item.promptHistory.map((p, i) => (
              <div key={i} className="flex gap-2">
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${i === 0 ? 'bg-muted text-muted-foreground' : 'bg-amber-500/20 text-amber-400'}`}>
                  {i === 0 ? '原始' : `改写 ${i}`}
                </span>
                <span className="text-foreground/80 leading-relaxed">{p}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Workflow checkpoint timeline */}
      {item.batchTaskId && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="font-medium text-muted-foreground">工作流执行日志</span>
            {isActive && (
              <span className="inline-flex items-center gap-1 text-[10px] text-blue-400">
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
                实时
              </span>
            )}
            {wfTask && <StatusBadge status={wfTask.status} />}
          </div>
          {fetchError ? (
            <div className="text-red-400">{fetchError}</div>
          ) : !wfTask ? (
            <div className="text-muted-foreground">加载中…</div>
          ) : (
            <div className="bg-muted/20 rounded-lg p-3 border border-border">
              {wfTask.resultHighlights?.primaryGeneratedImageUrl && (
                <div className="mb-2">
                  <div className="text-muted-foreground mb-1">主产出</div>
                  <a className="text-primary hover:underline break-all" href={wfTask.resultHighlights.primaryGeneratedImageUrl} target="_blank" rel="noreferrer">
                    {wfTask.resultHighlights.primaryGeneratedImageUrl}
                  </a>
                </div>
              )}
              {Array.isArray(wfTask.stepStatus) && wfTask.stepStatus.length > 0 ? (
                <div className="space-y-1">
                  {wfTask.stepStatus.map((s: any) => (
                    <div key={s.idx} className="flex items-start gap-2">
                      <span className="shrink-0 w-5 text-right text-muted-foreground">{s.idx}</span>
                      <span className="shrink-0 w-16"><StatusBadge status={s.status} /></span>
                      <span className="shrink-0 text-muted-foreground">{s.label || s.nodeType}</span>
                      {(s.status === 'success' || s.status === 'done') && typeof s.duration === 'number' && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          耗时 {formatMs(s.duration)}
                        </span>
                      )}
                      {s.output_preview && (
                        <span className="text-muted-foreground break-all line-clamp-2">
                          {Object.entries(s.output_preview).slice(0, 3).map(([k, v]) => `${k}=${v}`).join('  ')}
                        </span>
                      )}
                      {s.error && <span className="text-red-400 break-all">{s.error}</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground">暂无 stepStatus</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Media result */}
      {(item.mediaUrls?.length > 0 || item.imageUrls?.length > 0) && (
        <div>
          <div className="font-medium text-muted-foreground mb-1.5 flex items-center gap-2">
            <span>生成结果</span>
            <button
              type="button"
              onClick={onOpenGallery}
              className="px-2 py-0.5 text-[11px] bg-primary/20 text-primary border border-primary/30 rounded hover:bg-primary/30 transition-colors"
            >
              查看全部出图
            </button>
          </div>
          <div className="flex flex-wrap gap-3">
            {(item.mediaUrls?.length > 0 ? item.mediaUrls : item.imageUrls).map((url, i) => (
              <button key={i} type="button" onClick={onOpenGallery} className="group">
                <img
                  src={url}
                  alt={`result-${i}`}
                  className="w-24 h-24 object-cover rounded-lg border border-border group-hover:border-primary transition-colors"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error detail */}
      {item.error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2 text-red-400">
          {item.error}
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ─── */
function ProgressSection({ summary }: { summary: TaskSummary }) {
  const done = summary.success + summary.failed + summary.cancelled;
  const pct = summary.total > 0 ? Math.round((done / summary.total) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{pct}% 完成</span>
        <span>{done} / {summary.total}</span>
      </div>
      <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex gap-4 text-xs">
        <span className="text-green-400">✓ 成功 {summary.success}</span>
        <span className="text-red-400">✗ 失败 {summary.failed}</span>
        <span className="text-blue-400">⟳ 运行 {summary.running}</span>
        <span className="text-muted-foreground">⏳ 待处理 {summary.pending}</span>
        <span className="text-muted-foreground">✕ 已取消 {summary.cancelled}</span>
      </div>
    </div>
  );
}

function ItemRow({
  item,
  expanded,
  onToggle,
  onRetryItem,
  onOpenGallery,
  retrying,
}: {
  item: DispatcherItem;
  expanded: boolean;
  onToggle: () => void;
  onRetryItem: (item: DispatcherItem) => void;
  onOpenGallery: () => void;
  retrying: boolean;
}) {
  const primaryMedia = item.mediaUrls?.[0] || item.imageUrls?.[0];
  const isImage = item.primaryMediaType === 'image' || (!item.primaryMediaType && primaryMedia);
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer transition-colors ${expanded ? 'bg-muted/40' : 'hover:bg-muted/20'}`}
      >
        <td className="px-4 py-2.5 text-muted-foreground text-xs w-10">{item.index + 1}</td>
        <td className="px-4 py-2.5 max-w-[200px]">
          <span className="text-xs text-foreground" title={item.prompt}>{truncate(item.prompt, 55)}</span>
          {(item.promptOptimizedCount ?? 0) > 0 && (
            <span className="ml-1 text-[10px] text-amber-400 border border-amber-500/30 rounded px-1">改写×{item.promptOptimizedCount}</span>
          )}
        </td>
        <td className="px-4 py-2.5"><StatusBadge status={item.status} /></td>
        <td className="px-4 py-2.5 text-xs text-muted-foreground text-center">{item.attempts}</td>
        <td className="px-4 py-2.5 text-xs">
          {item.failureCategory ? (
            <span className="text-red-400">{failureCategoryLabel(item.failureCategory)}</span>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </td>
        <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatMaybeMs(item.durationMs)}</td>
        <td className="px-4 py-2.5">
          {primaryMedia && isImage ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenGallery();
              }}
              title="点击查看全部出图"
            >
              <img src={primaryMedia} alt="" className="w-10 h-10 object-cover rounded border border-border hover:border-primary transition-colors" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            </button>
          ) : primaryMedia ? (
            <span className="text-[10px] text-blue-400 border border-blue-500/30 rounded px-1">视频</span>
          ) : null}
        </td>
        <td className="px-4 py-2.5 max-w-[160px]">
          {item.error && <span className="text-[11px] text-red-400" title={item.error}>{truncate(item.error, 40)}</span>}
        </td>
        <td className="px-4 py-2.5 text-muted-foreground text-[11px]">
          <div className="flex items-center justify-end gap-2">
            {item.status === 'running' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRetryItem(item);
                }}
                disabled={retrying}
                className="px-2 py-1 text-[11px] bg-primary/20 text-primary border border-primary/30 rounded-md hover:bg-primary/30 disabled:opacity-50 transition-colors"
                title="携带当前子任务入参跳转到工作流调试页"
              >
                {retrying ? '跳转中...' : 'Debug执行'}
              </button>
            )}
            <span>{expanded ? '▲' : '▼'}</span>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-muted/20">
          <td colSpan={9} className="px-5 py-4">
            <ItemExpandedDetail item={item} onOpenGallery={onOpenGallery} />
          </td>
        </tr>
      )}
    </>
  );
}

function InstancesTable({ instances }: { instances: DispatcherInstance[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[700px]">
        <thead className="bg-muted/50 border-b border-border">
          <tr>
            <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">实例 ID</th>
            <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">状态</th>
            <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">当前任务</th>
            <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">上次结果</th>
            <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">连续失败</th>
            <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">冷却到</th>
            <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">成功/失败</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {instances.map(inst => (
            <tr key={inst.instanceId} className="hover:bg-muted/20">
              <td className="px-3 py-2.5">
                <code className="font-mono">{inst.instanceId}</code>
                {inst.leaseId && <span className="ml-1 text-[10px] text-blue-400">[租约中]</span>}
              </td>
              <td className="px-3 py-2.5">
                <span className={`font-medium ${INST_STATE_COLORS[inst.state as InstanceState] ?? 'text-muted-foreground'}`}>
                  {INST_STATE_LABELS[inst.state as InstanceState] ?? inst.state}
                </span>
                {inst.state === 'running' && (
                  <span className="ml-1 inline-block w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
                )}
              </td>
              <td className="px-3 py-2.5 max-w-[160px]">
                {inst.currentPrompt ? (
                  <span className="text-foreground/70" title={inst.currentPrompt}>{truncate(inst.currentPrompt, 40)}</span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
                {inst.batchTaskId && (
                  <div className="text-[10px] text-primary mt-0.5">{inst.batchTaskId.slice(0, 12)}…</div>
                )}
              </td>
              <td className="px-3 py-2.5">
                {inst.lastResultStatus ? (
                  <StatusBadge status={inst.lastResultStatus} />
                ) : <span className="text-muted-foreground">-</span>}
                {inst.lastError && (
                  <div className="text-[10px] text-red-400 mt-0.5" title={inst.lastError}>{truncate(inst.lastError, 30)}</div>
                )}
              </td>
              <td className="px-3 py-2.5">
                <span className={inst.consecutiveFailures > 0 ? 'text-red-400 font-medium' : 'text-muted-foreground'}>
                  {inst.consecutiveFailures}
                </span>
              </td>
              <td className="px-3 py-2.5">
                {inst.cooldownUntil ? (
                  <span className="text-orange-400">{formatTime(inst.cooldownUntil)}</span>
                ) : <span className="text-muted-foreground">-</span>}
              </td>
              <td className="px-3 py-2.5">
                <span className="text-green-400">{inst.successCount}</span>
                <span className="text-muted-foreground mx-1">/</span>
                <span className="text-red-400">{inst.failureCount}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {instances.length === 0 && (
        <div className="text-center text-muted-foreground py-8 text-sm">暂无实例数据</div>
      )}
    </div>
  );
}

/* ─── Main Page ─── */
export default function AdsDispatcherDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'items' | 'instances'>('items');
  const [itemFilter, setItemFilter] = useState<string>('all');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [operating, setOperating] = useState(false);
  const [retryingItemId, setRetryingItemId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [copiedRuns, setCopiedRuns] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await fetch(`/api/gemini-web/image/ads-dispatcher/tasks/${id}`);
      if (!res.ok) throw new Error(await res.text());
      setTask(await res.json());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!task || task.done) return;
    const timer = setInterval(() => void load(true), 3000);
    return () => clearInterval(timer);
  }, [task, load]);

  async function doOp(fn: () => Promise<Response>, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setOperating(true);
    try {
      const res = await fn();
      if (!res.ok) throw new Error(await res.text());
      await load(true);
    } catch (e) { alert(String(e)); }
    finally { setOperating(false); }
  }

  async function handleRestart() {
    if (!task) return;
    if (!confirm('将用原来的 prompts 重新创建新任务，确认？')) return;
    setOperating(true);
    try {
      const s = task.settings;
      const runs = task.items.map((item) => ({
        prompt: item.prompt,
        sourceImageUrls: Array.isArray(item.sourceImageUrls) ? item.sourceImageUrls : [],
      }));
      const body: Record<string, unknown> = runs.length > 0 ? { runs } : { prompts: task.prompts };
      if (s.instanceIds?.length) body.instanceIds = s.instanceIds;
      if (s.workflowId) body.workflowId = s.workflowId;
      if (s.promptVarName) body.promptVarName = s.promptVarName;
      body.maxAttemptsPerPrompt = s.maxAttemptsPerPrompt;
      body.force = true;
      body.forceReason = 'beach朋友圈 test';
      body.autoCloseTab = false;
      const cr = await fetch('/api/gemini-web/image/ads-dispatcher', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!cr.ok) throw new Error(await cr.text());
      const nt = await cr.json();
      router.push(`/ads-dispatcher/${nt.taskId}`);
    } catch (e) { alert(String(e)); }
    finally { setOperating(false); }
  }

  async function handleRetrySingleItem(item: DispatcherItem) {
    if (!task) return;
    if (!confirm('将携带该子任务入参跳转到工作流调试页，确认继续？')) return;
    setRetryingItemId(item.id);
    try {
      const s = task.settings;
      if (!s.workflowId) throw new Error('当前任务缺少 workflowId，无法跳转到工作流调试页');
      const params = new URLSearchParams();
      const promptVarName = String(s.promptVarName || 'noteUrl').trim();
      params.set(promptVarName, item.prompt || '');
      if (item.browserInstanceId) {
        params.set('browserInstanceId', item.browserInstanceId);
      } else if (Array.isArray(s.instanceIds) && s.instanceIds.length > 0) {
        params.set('browserInstanceId', s.instanceIds[0]);
      }
      const sourceImageUrls = Array.isArray(item.sourceImageUrls)
        ? item.sourceImageUrls.filter((url) => typeof url === 'string' && url.trim())
        : [];
      if (sourceImageUrls.length > 0) {
        params.set('sourceImageUrl', sourceImageUrls[0]);
        params.set('sourceImageUrls', JSON.stringify(sourceImageUrls));
      }
      router.push(`/workflows/${s.workflowId}?${params.toString()}`);
    } catch (e) {
      alert(String(e));
    } finally {
      setRetryingItemId(null);
    }
  }

  const toggleItem = (itemId: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  };

  // Extract successful images for preview
  const galleryImages = task
    ? task.items
        .filter(item => item.status === 'success' && (item.imageUrls?.length > 0 || item.mediaUrls?.length > 0))
        .flatMap(item => {
          const urls = item.imageUrls?.length > 0 ? item.imageUrls : item.mediaUrls || [];
          return urls.map((url, idx) => ({
            id: `${item.id}-${idx}`,
            url,
            prompt: item.prompt,
          }));
        })
    : [];

  const runsInput = useMemo(() => {
    if (!task) return [];
    return task.items.map((item) => ({
      prompt: item.prompt || '',
      sourceImageUrls: Array.isArray(item.sourceImageUrls)
        ? item.sourceImageUrls.filter((url) => typeof url === 'string' && url.trim())
        : [],
    }));
  }, [task]);

  async function copyRunsInputJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(runsInput, null, 2));
      setCopiedRuns(true);
      setTimeout(() => setCopiedRuns(false), 1800);
    } catch (e) {
      alert(String(e));
    }
  }

  // Show preview mode
  if (previewMode && !loading && task) {
    return <ImageGalleryPreview images={galleryImages} onClose={() => setPreviewMode(false)} />;
  }

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground text-sm">加载中...</div>
  );

  if (error || !task) return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
      <span className="text-red-400 text-sm">{error ?? '任务不存在'}</span>
      <Link href="/ads-dispatcher" className="text-sm text-primary hover:underline">← 返回列表</Link>
    </div>
  );

  const filteredItems = itemFilter === 'all' ? task.items : task.items.filter(i => i.status === itemFilter);

  const ITEM_TABS = [
    { value: 'all', label: `全部 (${task.items.length})` },
    { value: 'pending', label: `待处理 (${task.summary.pending})` },
    { value: 'running', label: `运行中 (${task.summary.running})` },
    { value: 'success', label: `成功 (${task.summary.success})` },
    { value: 'failed', label: `失败 (${task.summary.failed})` },
    { value: 'cancelled', label: `已取消 (${task.summary.cancelled})` },
  ].filter(t => t.value === 'all' || Number(t.label.match(/\d+/)?.[0]) > 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border px-4 sm:px-6 py-3 flex items-center justify-between gap-2 sticky top-0 z-10">
        <div className="flex items-center gap-2 min-w-0 text-sm">
          <Link href="/" className="font-bold text-foreground hover:text-primary">doouyin</Link>
          <span className="text-muted-foreground">/</span>
          <Link href="/ads-dispatcher" className="text-muted-foreground hover:text-foreground">调度任务</Link>
          <span className="text-muted-foreground">/</span>
          <code className="font-mono text-xs text-foreground" title={task.id}>{task.id.slice(0, 12)}…</code>
        </div>
        <button onClick={() => void load()} className="px-3 py-1.5 bg-muted hover:bg-muted/80 text-xs rounded-lg transition-colors shrink-0">刷新</button>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* Overview card */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <StatusBadge status={task.status} />
              {task.queue.state !== 'none' && (
                <span className="text-xs text-muted-foreground">
                  {task.queue.state === 'running' ? '正在执行' : `队列第 ${task.queue.position} 位 / 共 ${task.queue.size} 个`}
                </span>
              )}
              {task.warnings?.length > 0 && (
                <span className="text-xs text-amber-400 border border-amber-500/30 rounded px-2 py-0.5">
                  ⚠ {task.warnings.length} 条警告
                </span>
              )}
            </div>
            {/* Operation buttons */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => void copyRunsInputJson()}
                className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-lg transition-colors"
                title="复制该调度任务 prompts 入参（runs JSON）"
              >
                {copiedRuns ? '✅ 已复制入参' : '复制任务入参(JSON)'}
              </button>
              {galleryImages.length > 0 && (
                <button
                  onClick={() => setPreviewMode(true)}
                  className="px-3 py-1.5 text-xs bg-primary/20 text-primary border border-primary/30 rounded-lg hover:bg-primary/30 transition-colors"
                  title={`预览 ${galleryImages.length} 张图片`}
                >
                  🖼️ 预览 ({galleryImages.length})
                </button>
              )}
              {task.status === 'running' && (
                <button disabled={operating} onClick={() => void doOp(() => fetch(`/api/gemini-web/image/ads-dispatcher/tasks/${id}/pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))}
                  className="px-3 py-1.5 text-xs bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-lg hover:bg-orange-500/30 disabled:opacity-50 transition-colors">
                  暂停
                </button>
              )}
              {task.status === 'paused' && (
                <button disabled={operating} onClick={() => void doOp(() => fetch(`/api/gemini-web/image/ads-dispatcher/tasks/${id}/resume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))}
                  className="px-3 py-1.5 text-xs bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/30 disabled:opacity-50 transition-colors">
                  继续
                </button>
              )}
              {(task.status === 'queued' || task.status === 'running' || task.status === 'paused') && (
                <button disabled={operating} onClick={() => void doOp(() => fetch(`/api/gemini-web/image/ads-dispatcher/tasks/${id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: '用户手动停止' }) }), '确认停止该任务？')}
                  className="px-3 py-1.5 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 disabled:opacity-50 transition-colors">
                  停止
                </button>
              )}
              {(task.status === 'failed' || task.status === 'cancelled' || task.status === 'success') && (
                <button disabled={operating} onClick={() => void handleRestart()}
                  className="px-3 py-1.5 text-xs bg-primary/20 text-primary border border-primary/30 rounded-lg hover:bg-primary/30 disabled:opacity-50 transition-colors">
                  重新创建
                </button>
              )}
            </div>
          </div>

          {/* Progress */}
          <ProgressSection summary={task.summary} />

          {/* Timestamps & metrics */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span>创建：{formatTime(task.createdAt)}</span>
            <span>开始：{formatTime(task.startedAt)}</span>
            <span>结束：{formatTime(task.endedAt)}</span>
            <span>总耗时：{formatMaybeMs(task.durationMs)}</span>
            <span>分配总数：{task.metrics.totalAssignments}</span>
            <span>完成总数：{task.metrics.totalCompletions}</span>
            {typeof task.result?.retriedItemCount === 'number' && <span>发生重试：{task.result.retriedItemCount} 项</span>}
            <span className={task.metrics.idleCyclesWithoutAssignment > 5 ? 'text-amber-400' : ''}>
              空闲轮次：{task.metrics.idleCyclesWithoutAssignment}
            </span>
          </div>

          {task.result?.failureCategoryStats && Object.keys(task.result.failureCategoryStats).length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(task.result.failureCategoryStats)
                .sort((a, b) => b[1] - a[1])
                .map(([category, count]) => (
                  <span key={category} className="px-2 py-0.5 rounded border border-red-500/25 text-red-400 bg-red-500/10">
                    {failureCategoryLabel(category)}: {count}
                  </span>
                ))}
            </div>
          )}

          {/* Error */}
          {task.error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400">{task.error}</div>
          )}

          {/* Warnings */}
          {task.warnings?.length > 0 && (
            <div className="space-y-1">
              {task.warnings.map((w, i) => (
                <div key={i} className="text-xs text-amber-400 flex gap-2">
                  <span>⚠</span><span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Settings accordion */}
          <div className="border-t border-border pt-3">
            <button onClick={() => setSettingsOpen(o => !o)} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <span>{settingsOpen ? '▼' : '▶'}</span>
              <span className="font-medium">配置 & 预检</span>
            </button>
            {settingsOpen && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {[
                  ['实例列表', task.settings.instanceIds.join(', ')],
                  ['工作流 ID', task.settings.workflowId || '-'],
                  ['最大重试', String(task.settings.maxAttemptsPerPrompt)],
                  ['子任务超时', formatMs(task.settings.childTaskTimeoutMs)],
                  ['调度总超时', formatMs(task.settings.dispatcherTimeoutMs)],
                  ['实例冷却', formatMs(task.settings.instanceCooldownMs)],
                  ['冷却触发阈值', String(task.settings.failureCooldownThreshold)],
                  ['自动关 Tab', task.settings.autoCloseTab ? '是' : '否'],
                  ['Prompt 优化', task.settings.optimizePromptOnRetry ? `是 (${task.settings.promptOptimizationModel})` : '否'],
                  ['预检实例', `${task.preflight.idleInstances} 空闲 / ${task.preflight.busyInstances} 占用 / ${task.preflight.inactiveInstances} 不活跃`],
                  ['接受 Prompt 数', String(task.preflight.acceptedPromptCount)],
                ].map(([label, val]) => (
                  <div key={label} className="bg-muted/30 rounded-lg p-2">
                    <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
                    <div className="text-xs text-foreground truncate" title={val}>{val}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border pb-0">
          {[
            { key: 'items', label: `子任务 (${task.items.length})` },
            { key: 'instances', label: `实例状态 (${task.instances.length})` },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as typeof tab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Items Tab */}
        {tab === 'items' && (
          <div className="space-y-3">
            {/* Item filter */}
            <div className="flex gap-1 flex-wrap">
              {ITEM_TABS.map(t => (
                <button
                  key={t.value}
                  onClick={() => setItemFilter(t.value)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    itemFilter === t.value
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="bg-card border border-border rounded-xl overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-10">#</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Prompt</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">状态</th>
                    <th className="text-center px-4 py-2.5 font-medium text-muted-foreground">尝试</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">失败分类</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">耗时</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">媒体</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">错误</th>
                    <th className="px-4 py-2.5 w-6" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredItems.map(item => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      expanded={expandedItems.has(item.id)}
                      onToggle={() => toggleItem(item.id)}
                      onRetryItem={handleRetrySingleItem}
                      onOpenGallery={() => setPreviewMode(true)}
                      retrying={retryingItemId === item.id}
                    />
                  ))}
                </tbody>
              </table>
              {filteredItems.length === 0 && (
                <div className="text-center text-muted-foreground py-10 text-sm">暂无匹配子任务</div>
              )}
            </div>
          </div>
        )}

        {/* Instances Tab */}
        {tab === 'instances' && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <InstancesTable instances={task.instances} />
          </div>
        )}
      </div>
    </div>
  );
}
