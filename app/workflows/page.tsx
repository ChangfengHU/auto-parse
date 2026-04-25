'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DropdownMenu from '@/components/DropdownMenu';

const NODE_ICONS: Record<string, string> = {
  navigate: '🌐', text_input: '✏️', click: '👆', scroll: '🖱️',
  screenshot: '📸', file_upload: '📤', wait_condition: '⏳', qrcode: '📱',
  vertex_ai: '🖼️',
  topic_picker_agent: '🧠',
  agent_react: '🤖',
};

const NODE_COLORS: Record<string, string> = {
  navigate: 'bg-blue-500', text_input: 'bg-purple-500', click: 'bg-orange-500',
  scroll: 'bg-cyan-500', screenshot: 'bg-gray-500', file_upload: 'bg-green-500',
  wait_condition: 'bg-yellow-500', qrcode: 'bg-pink-500',
  vertex_ai: 'bg-indigo-500',
  topic_picker_agent: 'bg-emerald-500',
  agent_react: 'bg-teal-500',
};

export default function WorkflowsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<Array<{
    id: string;
    name: string;
    description?: string;
    nodeCount: number;
    nodePreview: Array<{ type: string; label?: string }>;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [jumpPageInput, setJumpPageInput] = useState('1');
  const [pageSize, setPageSize] = useState(10);
  const [localQueryEnabled, setLocalQueryEnabled] = useState(false);
  const LOCAL_QUERY_STORAGE_KEY = 'workflows-local-query-enabled';

  useEffect(() => {
    try {
      setLocalQueryEnabled(localStorage.getItem(LOCAL_QUERY_STORAGE_KEY) === '1');
    } catch {
      setLocalQueryEnabled(false);
    }
  }, []);

  async function load(opts?: { q?: string; page?: number }) {
    const page = Math.max(1, opts?.page ?? currentPage);
    const q = opts?.q ?? query;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(pageSize) });
      params.set('page', String(page));
      if (q.trim()) params.set('q', q.trim());
      if (localQueryEnabled) params.set('local', '1');
      const res = await fetch(`/api/workflows?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      const normalizeListItem = (wf: any) => ({
        id: String(wf?.id || ''),
        name: String(wf?.name || ''),
        description: String(wf?.description || ''),
        nodeCount: Array.isArray(wf?.nodes) ? wf.nodes.length : Number(wf?.nodeCount || 0),
        nodePreview: Array.isArray(wf?.nodePreview)
          ? wf.nodePreview
          : (Array.isArray(wf?.nodes)
            ? wf.nodes.slice(0, 10).map((n: any) => ({ type: String(n?.type || ''), label: n?.label }))
            : []),
      });

      // 兼容旧接口：无分页时返回 WorkflowDef[]
      if (Array.isArray(data)) {
        const normalized = data.map(normalizeListItem);
        const total = normalized.length;
        const computedTotalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.min(page, computedTotalPages);
        const start = (safePage - 1) * pageSize;
        const sliced = normalized.slice(start, start + pageSize);
        setWorkflows(sliced);
        setCurrentPage(safePage);
        setTotalPages(computedTotalPages);
        setTotalCount(total);
        setJumpPageInput(String(safePage));
        return;
      }

      const incomingRaw = Array.isArray(data?.items) ? data.items : [];
      const incoming = incomingRaw.map(normalizeListItem);
      const serverPage = Math.max(1, Number(data?.page || page));
      const serverTotalPages = Math.max(1, Number(data?.totalPages || 1));
      const serverTotalCount = Math.max(0, Number(data?.total || incoming.length));
      setWorkflows(incoming);
      setCurrentPage(serverPage);
      setTotalPages(serverTotalPages);
      setTotalCount(serverTotalCount);
      setJumpPageInput(String(serverPage));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load({ q: query, page: currentPage }); }, [query, currentPage, localQueryEnabled, pageSize]);

  function handleSearchSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setQuery(queryInput.trim());
    setCurrentPage(1);
    setJumpPageInput('1');
  }

  function handleSearchReset() {
    setQueryInput('');
    setQuery('');
    setCurrentPage(1);
    setJumpPageInput('1');
  }

  function goToPage(page: number) {
    const target = Math.max(1, Math.min(totalPages, page));
    if (target === currentPage) return;
    setCurrentPage(target);
  }

  function toggleLocalQuery() {
    const next = !localQueryEnabled;
    setLocalQueryEnabled(next);
    try {
      localStorage.setItem(LOCAL_QUERY_STORAGE_KEY, next ? '1' : '0');
    } catch {
      // ignore persistence failure
    }
    setCurrentPage(1);
    setJumpPageInput('1');
  }

  async function handleCopy(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setCopying(id);
    try {
      const res = await fetch(`/api/workflows/${id}/copy`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      await load({ page: currentPage });
    } catch (e) { alert(String(e)); }
    finally { setCopying(null); }
  }

  async function handleRename(workflow: { id: string; name: string }, e: React.MouseEvent) {
    e.stopPropagation();
    const nextName = prompt('请输入新的工作流名称', workflow.name);
    if (nextName === null) return;

    const trimmedName = nextName.trim();
    if (!trimmedName) {
      alert('工作流名称不能为空');
      return;
    }
    if (trimmedName === workflow.name) return;

    setRenaming(workflow.id);
    try {
      const res = await fetch(`/api/workflows/${workflow.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      });
      if (!res.ok) throw new Error(await res.text());
      await load({ page: currentPage });
    } catch (e) { alert(String(e)); }
    finally { setRenaming(null); }
  }

  async function handleDelete(id: string, name: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`确认删除工作流「${name}」？`)) return;
    try {
      const res = await fetch(`/api/workflows/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      await load({ page: currentPage });
    } catch (e) { alert(String(e)); }
  }

  function handleOpenWorkflow(wf: { id: string }) {
    // 触发一次轻量 touch，更新 updated_at，用于「最近打开优先」排序。
    void fetch(`/api/workflows/${wf.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => {});
    router.push(`/workflows/${wf.id}`);
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <Link href="/" className="text-xl font-bold text-foreground hover:text-primary transition-colors">doouyin</Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-lg font-semibold truncate">工作流管理</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleLocalQuery}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors border ${
              localQueryEnabled
                ? 'bg-primary/10 text-primary border-primary/30'
                : 'bg-muted hover:bg-muted/80 border-border'
            }`}
          >
            本地查询：{localQueryEnabled ? '开' : '关'}
          </button>
          <Link href="/publish" className="px-3 py-1.5 bg-muted hover:bg-muted/80 text-sm rounded-lg transition-colors">返回发布</Link>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-foreground">工作流列表</h2>
            <p className="text-sm text-muted-foreground mt-0.5">每个工作流对应一个平台的自动化发布流程</p>
          </div>
        </div>

        <form onSubmit={handleSearchSubmit} className="mb-5 flex flex-col sm:flex-row gap-2">
          <input
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="搜索工作流（名称 / ID / 描述）"
            className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <select
            value={pageSize}
            onChange={(e) => {
              const next = Number(e.target.value) || 10;
              setPageSize(next);
              setCurrentPage(1);
              setJumpPageInput('1');
            }}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
            title="每页条数"
          >
            <option value={10}>每页 10 条</option>
            <option value={20}>每页 20 条</option>
            <option value={30}>每页 30 条</option>
          </select>
          <div className="flex gap-2">
            <button
              type="submit"
              className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
            >
              查询
            </button>
            <button
              type="button"
              onClick={handleSearchReset}
              className="px-4 py-2 text-sm bg-muted hover:bg-muted/80 rounded-lg transition-colors"
            >
              重置
            </button>
          </div>
        </form>

        {error && <WorkflowErrorBanner error={error} onSetupDone={load} />}

        {loading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">加载中...</div>
        ) : (
          <>
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
              {workflows.map(wf => (
                <div
                  key={wf.id}
                  onClick={() => handleOpenWorkflow(wf)}
                  className="bg-card border border-border rounded-2xl p-5 cursor-pointer hover:border-primary/50 hover:shadow-md transition-all group"
                >
                  {/* 标题行 */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">{wf.name}</h3>
                      {wf.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{wf.description}</p>
                      )}
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <DropdownMenu
                        items={[
                          {
                            label: renaming === wf.id ? '重命名中...' : '重命名',
                            icon: '✏️',
                            onClick: (e) => handleRename(wf, e),
                            disabled: renaming === wf.id,
                          },
                          {
                            label: copying === wf.id ? '复制中...' : '复制',
                            icon: '📋',
                            onClick: (e) => handleCopy(wf.id, e),
                            disabled: copying === wf.id,
                          },
                          {
                            label: '删除',
                            icon: '🗑️',
                            onClick: (e) => handleDelete(wf.id, wf.name, e),
                            destructive: true,
                          },
                        ]}
                      />
                    </div>
                  </div>

                  {/* 节点流程预览 */}
                  <div className="flex flex-wrap gap-1 items-center">
                    {wf.nodePreview.map((node, i) => (
                      <div key={i} className="flex items-center gap-0.5">
                        <span
                          title={node.label ?? node.type}
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] text-white ${NODE_COLORS[node.type] ?? 'bg-gray-500'}`}
                        >
                          {NODE_ICONS[node.type] ?? '⚙'}
                        </span>
                        {i < wf.nodeCount - 1 && i < 9 && (
                          <span className="text-muted-foreground text-[8px]">→</span>
                        )}
                      </div>
                    ))}
                    {wf.nodeCount > 10 && (
                      <span className="text-[10px] text-muted-foreground">+{wf.nodeCount - 10}</span>
                    )}
                  </div>

                  {/* 底部信息 */}
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{wf.nodeCount} 个节点</span>
                  </div>
                </div>
              ))}

              {/* 新建工作流卡片 */}
              <NewWorkflowCard onCreated={load} />
            </div>

            <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                共 {totalCount} 条，当前第 {currentPage}/{totalPages} 页
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md transition-colors disabled:opacity-50"
                >
                  上一页
                </button>
                {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                  const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
                  const page = start + i;
                  if (page > totalPages) return null;
                  return (
                    <button
                      key={`page-${page}`}
                      onClick={() => goToPage(page)}
                      className={`px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                        page === currentPage
                          ? 'bg-primary/10 text-primary border-primary/30'
                          : 'bg-muted hover:bg-muted/80 border-border'
                      }`}
                    >
                      {page}
                    </button>
                  );
                })}
                <button
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                  className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md transition-colors disabled:opacity-50"
                >
                  下一页
                </button>
                <div className="flex items-center gap-1">
                  <input
                    value={jumpPageInput}
                    onChange={(e) => setJumpPageInput(e.target.value.replace(/[^\d]/g, ''))}
                    placeholder="页码"
                    className="w-16 bg-card border border-border rounded-md px-2 py-1 text-xs outline-none focus:border-primary"
                  />
                  <button
                    onClick={() => goToPage(Number(jumpPageInput || '1'))}
                    className="px-2.5 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-md transition-colors"
                  >
                    跳转
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function isMissingTableError(error: string) {
  const normalized = error.toLowerCase();
  return normalized.includes('rpa_workflows')
    && (
      normalized.includes('does not exist')
      || normalized.includes('not exist')
      || normalized.includes('relation')
      || normalized.includes('pgrst')
      || normalized.includes('schema cache')
    );
}

function WorkflowErrorBanner({ error, onSetupDone }: { error: string; onSetupDone: () => void }) {
  if (!isMissingTableError(error)) {
    return (
      <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-xl p-4 space-y-2">
        <div className="flex items-start gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-foreground">工作流列表加载失败</p>
            <p className="text-xs text-muted-foreground mt-0.5">这次更像是 Supabase 网络或鉴权失败，不是建表问题。</p>
            <p className="text-xs text-red-400 mt-0.5 font-mono break-all">{error.slice(0, 240)}</p>
          </div>
        </div>
      </div>
    );
  }

  return <SetupBanner error={error} onSetupDone={onSetupDone} />;
}

function SetupBanner({ error, onSetupDone }: { error: string; onSetupDone: () => void }) {
  const [sql, setSql] = useState('');
  const [copied, setCopied] = useState(false);
  const [setting, setSetting] = useState(false);

  useEffect(() => {
    fetch('/api/workflows/setup').then(r => r.json()).then(d => setSql(d.sql ?? '')).catch(() => {});
  }, []);

  async function tryAutoSetup() {
    setSetting(true);
    const res = await fetch('/api/workflows/setup', { method: 'POST' });
    const data = await res.json();
    if (data.ok) { onSetupDone(); }
    else { setSql(data.sql ?? sql); }
    setSetting(false);
  }

  return (
    <div className="mb-6 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="text-2xl">⚠️</span>
        <div>
          <p className="text-sm font-semibold text-foreground">需要初始化数据库</p>
          <p className="text-xs text-muted-foreground mt-0.5">rpa_workflows 表不存在，请执行以下 SQL 完成初始化</p>
          <p className="text-xs text-red-400 mt-0.5 font-mono">{error.slice(0, 120)}</p>
        </div>
      </div>
      {sql && (
        <pre className="text-[10px] font-mono bg-muted/50 rounded-lg p-3 overflow-x-auto text-foreground/80 whitespace-pre">{sql}</pre>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => tryAutoSetup()}
          disabled={setting}
          className="px-3 py-1.5 text-xs bg-primary text-white rounded-lg disabled:opacity-50 hover:bg-primary/90"
        >
          {setting ? '尝试自动创建...' : '自动创建表'}
        </button>
        {sql && (
          <button
            onClick={() => { navigator.clipboard.writeText(sql); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
            className="px-3 py-1.5 text-xs bg-muted rounded-lg hover:bg-muted/80"
          >
            {copied ? '✓ 已复制' : '复制 SQL'}
          </button>
        )}
        <a
          href="https://app.supabase.com"
          target="_blank"
          rel="noreferrer"
          className="px-3 py-1.5 text-xs bg-muted rounded-lg hover:bg-muted/80"
        >
          打开 Supabase Studio →
        </a>
      </div>
    </div>
  );
}

function NewWorkflowCard({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [showForm, setShowForm] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), nodes: [], vars: [] }),
      });
      if (!res.ok) throw new Error(await res.text());
      const wf = await res.json();
      onCreated();
      router.push(`/workflows/${wf.id}`);
    } catch (e) { alert(String(e)); }
    finally { setCreating(false); }
  }

  if (!showForm) {
    return (
      <button
        onClick={() => setShowForm(true)}
        className="bg-card border-2 border-dashed border-border rounded-2xl p-5 flex flex-col items-center justify-center gap-2 hover:border-primary/50 hover:bg-muted/20 transition-all h-full min-h-[140px] text-muted-foreground hover:text-foreground"
      >
        <span className="text-3xl">+</span>
        <span className="text-sm">新建工作流</span>
      </button>
    );
  }

  return (
    <div className="bg-card border-2 border-primary/30 rounded-2xl p-5 flex flex-col gap-3">
      <p className="text-sm font-semibold">新建工作流</p>
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && void create()}
        placeholder="工作流名称，如：小红书视频发布"
        className="bg-muted border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
      />
      <div className="flex gap-2">
        <button
          onClick={() => void create()}
          disabled={!name.trim() || creating}
          className="flex-1 py-2 text-sm bg-primary text-white rounded-lg disabled:opacity-50 hover:bg-primary/90"
        >
          {creating ? '创建中...' : '创建'}
        </button>
        <button onClick={() => setShowForm(false)} className="px-3 py-2 text-sm bg-muted rounded-lg hover:bg-muted/80">取消</button>
      </div>
    </div>
  );
}
