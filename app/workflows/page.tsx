'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { WorkflowDef } from '@/lib/workflow/types';
import DropdownMenu from '@/components/DropdownMenu';

const NODE_ICONS: Record<string, string> = {
  navigate: '🌐', text_input: '✏️', click: '👆', scroll: '🖱️',
  screenshot: '📸', file_upload: '📤', wait_condition: '⏳', qrcode: '📱',
  vertex_ai: '🖼️',
  topic_picker_agent: '🧠',
};

const NODE_COLORS: Record<string, string> = {
  navigate: 'bg-blue-500', text_input: 'bg-purple-500', click: 'bg-orange-500',
  scroll: 'bg-cyan-500', screenshot: 'bg-gray-500', file_upload: 'bg-green-500',
  wait_condition: 'bg-yellow-500', qrcode: 'bg-pink-500',
  vertex_ai: 'bg-indigo-500',
  topic_picker_agent: 'bg-emerald-500',
};

export default function WorkflowsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/workflows');
      if (!res.ok) throw new Error(await res.text());
      setWorkflows(await res.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function handleCopy(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setCopying(id);
    try {
      const res = await fetch(`/api/workflows/${id}/copy`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e) { alert(String(e)); }
    finally { setCopying(null); }
  }

  async function handleRename(workflow: WorkflowDef, e: React.MouseEvent) {
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
      await load();
    } catch (e) { alert(String(e)); }
    finally { setRenaming(null); }
  }

  async function handleDelete(id: string, name: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`确认删除工作流「${name}」？`)) return;
    try {
      const res = await fetch(`/api/workflows/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e) { alert(String(e)); }
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

        {error && <SetupBanner error={error} onSetupDone={load} />}

        {loading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground">加载中...</div>
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
            {workflows.map(wf => (
              <div
                key={wf.id}
                onClick={() => router.push(`/workflows/${wf.id}`)}
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
                  {wf.nodes.slice(0, 10).map((node, i) => (
                    <div key={i} className="flex items-center gap-0.5">
                      <span
                        title={node.label ?? node.type}
                        className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] text-white ${NODE_COLORS[node.type] ?? 'bg-gray-500'}`}
                      >
                        {NODE_ICONS[node.type] ?? '⚙'}
                      </span>
                      {i < wf.nodes.length - 1 && i < 9 && (
                        <span className="text-muted-foreground text-[8px]">→</span>
                      )}
                    </div>
                  ))}
                  {wf.nodes.length > 10 && (
                    <span className="text-[10px] text-muted-foreground">+{wf.nodes.length - 10}</span>
                  )}
                </div>

                {/* 底部信息 */}
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{wf.nodes.length} 个节点</span>
                </div>
              </div>
            ))}

            {/* 新建工作流卡片 */}
            <NewWorkflowCard onCreated={load} />
          </div>
        )}
      </div>
    </div>
  );
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
