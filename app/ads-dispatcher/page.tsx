'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type TaskSummaryItem = {
  id: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  lastActivityAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  summary: {
    total: number;
    pending: number;
    running: number;
    success: number;
    failed: number;
    cancelled: number;
  } | null;
  settings: {
    instanceIds?: string[];
    workflowId?: string;
    maxAttemptsPerPrompt?: number;
  } | null;
  queue: {
    state: string;
    position?: number;
    size: number;
  };
};

const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  running: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  paused: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  success: 'bg-green-500/20 text-green-400 border-green-500/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
  cancelled: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  paused: '已暂停',
  success: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const ACTIVE_STATUSES = new Set(['queued', 'running', 'paused']);

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[status] ?? 'bg-muted text-muted-foreground border-border'}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function ProgressBar({ summary }: { summary: TaskSummaryItem['summary'] }) {
  if (!summary || summary.total === 0) return <span className="text-xs text-muted-foreground">-</span>;
  const done = summary.success + summary.failed + summary.cancelled;
  const pct = Math.round((done / summary.total) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 bg-muted rounded-full h-1.5 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            background: summary.failed > 0 ? 'linear-gradient(to right, #22c55e, #ef4444)' : '#3b82f6',
          }}
        />
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">{done}/{summary.total}</span>
    </div>
  );
}

function formatTime(iso: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const STATUS_TABS = [
  { value: 'all', label: '全部' },
  { value: 'running', label: '运行中' },
  { value: 'queued', label: '排队中' },
  { value: 'paused', label: '已暂停' },
  { value: 'success', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
];

export default function AdsDispatcherPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskSummaryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [operating, setOperating] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/gemini-web/image/ads-dispatcher/tasks?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setTasks(data.items ?? []);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const hasActive = tasks.some(t => ACTIVE_STATUSES.has(t.status));
    if (!hasActive) return;
    const timer = setInterval(() => void load(true), 4000);
    return () => clearInterval(timer);
  }, [tasks, load]);

  async function op(
    id: string,
    fn: () => Promise<Response>,
    confirm_msg?: string,
  ) {
    if (confirm_msg && !confirm(confirm_msg)) return;
    setOperating(id);
    try {
      const res = await fn();
      if (!res.ok) throw new Error(await res.text());
      await load(true);
    } catch (e) { alert(String(e)); }
    finally { setOperating(null); }
  }

  function stopCell(e: React.MouseEvent) { e.stopPropagation(); }

  async function handleRestart(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('将用原来的 prompts 重新创建新任务，确认？')) return;
    setOperating(id);
    try {
      const res = await fetch(`/api/gemini-web/image/ads-dispatcher/tasks/${id}`);
      if (!res.ok) throw new Error(await res.text());
      const task = await res.json();
      const s = task.settings ?? {};
      const runs = Array.isArray(task.items)
        ? task.items.map((item: any) => ({
            prompt: String(item?.prompt || ''),
            sourceImageUrls: Array.isArray(item?.sourceImageUrls) ? item.sourceImageUrls : [],
          }))
        : [];
      const body: Record<string, unknown> = runs.length > 0 ? { runs } : { prompts: task.prompts };
      if (s.instanceIds?.length) body.instanceIds = s.instanceIds;
      if (s.workflowId) body.workflowId = s.workflowId;
      if (s.promptVarName) body.promptVarName = s.promptVarName;
      if (s.maxAttemptsPerPrompt) body.maxAttemptsPerPrompt = s.maxAttemptsPerPrompt;
      if (s.autoCloseTab !== undefined) body.autoCloseTab = s.autoCloseTab;
      const cr = await fetch('/api/gemini-web/image/ads-dispatcher', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!cr.ok) throw new Error(await cr.text());
      const nt = await cr.json();
      router.push(`/ads-dispatcher/${nt.taskId}`);
    } catch (e) { alert(String(e)); }
    finally { setOperating(null); }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border px-4 sm:px-6 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="text-xl font-bold text-foreground hover:text-primary transition-colors">doouyin</Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-lg font-semibold">调度任务</h1>
        </div>
        <button onClick={() => void load()} className="px-3 py-1.5 bg-muted hover:bg-muted/80 text-sm rounded-lg transition-colors">
          刷新
        </button>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex gap-1 mb-5 overflow-x-auto pb-1">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                statusFilter === tab.value
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-400">{error}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">加载中...</div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
            <span className="text-3xl">📭</span>
            <span className="text-sm">暂无任务</span>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">任务 ID</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">状态</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">进度</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">实例</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">创建时间</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tasks.map(task => (
                  <tr
                    key={task.id}
                    onClick={() => router.push(`/ads-dispatcher/${task.id}`)}
                    className="cursor-pointer hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-foreground" title={task.id}>{task.id.slice(0, 8)}…</span>
                      {task.queue.state !== 'none' && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {task.queue.state === 'running' ? '正在执行' : `队列第 ${task.queue.position} 位`}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={task.status} /></td>
                    <td className="px-4 py-3">
                      <ProgressBar summary={task.summary} />
                      {task.summary && (
                        <div className="text-[11px] text-muted-foreground mt-1 flex gap-2">
                          <span className="text-green-400">✓{task.summary.success}</span>
                          <span className="text-red-400">✗{task.summary.failed}</span>
                          <span>⏳{task.summary.pending + task.summary.running}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {task.settings?.instanceIds?.length ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{formatTime(task.createdAt)}</td>
                    <td className="px-4 py-3" onClick={stopCell}>
                      <div className="flex justify-end gap-1.5">
                        {task.status === 'running' && (
                          <button
                            disabled={operating === task.id}
                            onClick={(e) => { stopCell(e); void op(task.id, () => fetch(`/api/gemini-web/image/ads-dispatcher/tasks/${task.id}/pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })); }}
                            className="px-2 py-1 text-xs bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-md hover:bg-orange-500/30 disabled:opacity-50 transition-colors"
                          >暂停</button>
                        )}
                        {(task.status === 'queued' || task.status === 'running') && (
                          <button
                            disabled={operating === task.id}
                            onClick={(e) => { stopCell(e); void op(task.id, () => fetch(`/api/gemini-web/image/ads-dispatcher/tasks/${task.id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: '用户手动停止' }) }), '确认停止该任务？'); }}
                            className="px-2 py-1 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded-md hover:bg-red-500/30 disabled:opacity-50 transition-colors"
                          >停止</button>
                        )}
                        {task.status === 'paused' && (
                          <>
                            <button
                              disabled={operating === task.id}
                              onClick={(e) => { stopCell(e); void op(task.id, () => fetch(`/api/gemini-web/image/ads-dispatcher/tasks/${task.id}/resume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })); }}
                              className="px-2 py-1 text-xs bg-green-500/20 text-green-400 border border-green-500/30 rounded-md hover:bg-green-500/30 disabled:opacity-50 transition-colors"
                            >继续</button>
                            <button
                              disabled={operating === task.id}
                              onClick={(e) => { stopCell(e); void op(task.id, () => fetch(`/api/gemini-web/image/ads-dispatcher/tasks/${task.id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: '用户手动停止' }) }), '确认停止该任务？'); }}
                              className="px-2 py-1 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded-md hover:bg-red-500/30 disabled:opacity-50 transition-colors"
                            >停止</button>
                          </>
                        )}
                        {(task.status === 'failed' || task.status === 'cancelled') && (
                          <button
                            disabled={operating === task.id}
                            onClick={(e) => void handleRestart(task.id, e)}
                            className="px-2 py-1 text-xs bg-primary/20 text-primary border border-primary/30 rounded-md hover:bg-primary/30 disabled:opacity-50 transition-colors"
                          >{operating === task.id ? '...' : '重新创建'}</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
