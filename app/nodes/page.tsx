'use client';

import { useState, useRef, useCallback } from 'react';
import { NODE_CATALOG, WORKFLOW_VARS_META, NODE_LEVEL_PARAM_META } from '@/lib/workflow/node-catalog';
import type { NodeCatalogItem, ParamMeta } from '@/lib/workflow/node-catalog';
import type { NodeDef } from '@/lib/workflow/types';

// ── 参数类型颜色 ──────────────────────────────────────────────────────────────

const TYPE_STYLE: Record<ParamMeta['type'], string> = {
  selector: 'bg-orange-500/15 text-orange-400 border-orange-400/30',
  template: 'bg-purple-500/15 text-purple-400 border-purple-400/30',
  url:      'bg-blue-500/15 text-blue-400 border-blue-400/30',
  string:   'bg-muted text-muted-foreground border-border',
  number:   'bg-green-500/15 text-green-400 border-green-400/30',
  boolean:  'bg-yellow-500/15 text-yellow-400 border-yellow-400/30',
  array:    'bg-cyan-500/15 text-cyan-400 border-cyan-400/30',
};

// ── 单参数行 ──────────────────────────────────────────────────────────────────

function ParamRow({ paramKey, meta }: { paramKey: string; meta: ParamMeta }) {
  return (
    <div className="grid grid-cols-[190px_1fr] gap-x-4 items-start py-2 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-mono text-foreground/90">{paramKey}</span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded border ${TYPE_STYLE[meta.type]}`}>{meta.type}</span>
        {meta.required && <span className="text-[9px] text-red-400 font-medium">必填</span>}
      </div>
      <div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          <span className="text-foreground/70 font-medium">{meta.label}：</span>{meta.desc}
        </p>
        {meta.example && (
          <p className="text-[10px] text-primary/70 font-mono mt-0.5">示例：{meta.example}</p>
        )}
      </div>
    </div>
  );
}

// ── Debug 面板 ────────────────────────────────────────────────────────────────

interface LogEntry { ts: string; text: string; }

function NodeDebugPanel({ item }: { item: NodeCatalogItem }) {
  // 参数（用于本次 debug）
  const [params, setParams] = useState<Record<string, unknown>>({ ...item.defaultParams });
  const [preUrl, setPreUrl] = useState('');
  const [vars, setVars] = useState<Record<string, string>>(
    Object.fromEntries(Object.keys(WORKFLOW_VARS_META).map(k => [k, '']))
  );

  // 结果
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [success, setSuccess] = useState<boolean | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const appendLog = useCallback((text: string) => {
    setLogs(prev => {
      const next = [...prev, { ts: new Date().toLocaleTimeString('zh-CN', { hour12: false }), text }];
      setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      return next;
    });
  }, []);

  function setVal(key: string, raw: string) {
    let val: unknown = raw;
    if (raw === 'true') val = true;
    else if (raw === 'false') val = false;
    else if (/^\d+$/.test(raw) && raw.length < 10) val = Number(raw);
    else if (raw.startsWith('[')) { try { val = JSON.parse(raw); } catch { val = raw; } }
    setParams(p => ({ ...p, [key]: val }));
  }

  function displayVal(v: unknown) {
    if (Array.isArray(v)) return JSON.stringify(v);
    if (typeof v === 'object' && v !== null) return JSON.stringify(v);
    return String(v ?? '');
  }

  async function runDebug() {
    if (running) return;
    setRunning(true);
    setDone(false);
    setSuccess(null);
    setLogs([]);
    setScreenshot(null);

    const node: NodeDef = {
      type: item.type,
      label: item.label,
      params,
      url: preUrl || undefined,
      autoScreenshot: true,
    };

    const activeVars: Record<string, string> = {};
    for (const [k, v] of Object.entries(vars)) {
      if (v) activeVars[k] = v;
    }

    try {
      const res = await fetch('/api/workflow/node-debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node, vars: activeVars }),
      });

      if (!res.body) throw new Error('无响应体');

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.replace(/^data:\s*/m, '').trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line) as { type: string; payload: string };
            if (evt.type === 'log') appendLog(evt.payload);
            if (evt.type === 'screenshot') setScreenshot(evt.payload);
            if (evt.type === 'done') {
              const d = JSON.parse(evt.payload) as { success: boolean; error?: string };
              setSuccess(d.success);
              setDone(true);
            }
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      appendLog(`❌ 请求失败：${e}`);
      setSuccess(false);
      setDone(true);
    } finally {
      setRunning(false);
    }
  }

  const hasTemplateParam = Object.keys(item.paramMeta).some(k => item.paramMeta[k].type === 'template');

  return (
    <div className="border-t border-border bg-background/60">
      <div className="p-4 grid grid-cols-2 gap-4">

        {/* 左列：参数配置 */}
        <div className="space-y-4">
          <div>
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">前置导航 URL</h4>
            <input
              value={preUrl}
              onChange={e => setPreUrl(e.target.value)}
              disabled={running}
              placeholder="https://... （留空则在当前页执行）"
              className="w-full bg-muted/30 border border-blue-400/30 rounded-xl px-3 py-2 text-[11px] font-mono outline-none focus:border-blue-400 disabled:opacity-50"
            />
          </div>

          <div>
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">节点参数</h4>
            <div className="space-y-2">
              {Object.entries(params).map(([k, v]) => {
                const meta = item.paramMeta[k];
                const isSelector = meta?.type === 'selector' || k.toLowerCase().includes('selector');
                const isTemplate = meta?.type === 'template';
                return (
                  <div key={k} className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[10px] font-semibold ${isSelector ? 'text-orange-400' : isTemplate ? 'text-purple-400' : 'text-muted-foreground'}`}>
                        {meta?.label ?? k}
                      </span>
                      <span className="text-[9px] text-muted-foreground font-mono">({k})</span>
                      {meta?.required && <span className="text-[9px] text-red-400">*</span>}
                    </div>
                    <input
                      value={displayVal(v)}
                      onChange={e => setVal(k, e.target.value)}
                      disabled={running}
                      placeholder={meta?.example ?? ''}
                      className={`w-full bg-muted/30 border rounded-xl px-3 py-1.5 text-[11px] font-mono outline-none focus:border-primary disabled:opacity-50 transition-colors ${
                        isSelector ? 'border-orange-400/30 focus:border-orange-400' :
                        isTemplate ? 'border-purple-400/30 focus:border-purple-400' :
                        'border-border/60'
                      }`}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* 模板变量（仅当有 template 类型参数时显示） */}
          {hasTemplateParam && (
            <div>
              <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">模板变量值</h4>
              <div className="space-y-1.5">
                {Object.entries(WORKFLOW_VARS_META).map(([k, desc]) => (
                  <div key={k} className="space-y-0.5">
                    <label className="text-[9px] text-muted-foreground">
                      <span className="font-mono text-primary">{`{{${k}}}`}</span>
                      <span className="ml-1">{desc}</span>
                    </label>
                    <input
                      value={vars[k] ?? ''}
                      onChange={e => setVars(p => ({ ...p, [k]: e.target.value }))}
                      disabled={running}
                      placeholder={`${k} 的值（可选）`}
                      className="w-full bg-muted/30 border border-border/60 rounded-xl px-3 py-1.5 text-[11px] font-mono outline-none focus:border-primary disabled:opacity-50"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 执行按钮 */}
          <button
            onClick={() => void runDebug()}
            disabled={running}
            className={`w-full py-2.5 rounded-xl text-sm font-medium transition-all ${
              running
                ? 'bg-primary/50 text-white cursor-not-allowed'
                : 'bg-primary text-white hover:bg-primary/90 active:scale-[0.98]'
            }`}
          >
            {running ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                执行中...
              </span>
            ) : (
              `▶ 执行 ${item.label}`
            )}
          </button>

          {done && (
            <div className={`text-center text-xs py-1.5 rounded-lg ${success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
              {success ? '✅ 执行成功' : '❌ 执行失败'}
            </div>
          )}
        </div>

        {/* 右列：截图 + 日志 */}
        <div className="space-y-3 flex flex-col">
          {/* 截图区 */}
          <div className="h-48 bg-card border border-border rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0">
            {screenshot ? (
              <img src={screenshot} alt="result" className="w-full h-full object-contain" />
            ) : (
              <div className="text-center text-muted-foreground">
                <p className="text-2xl mb-1">🖥</p>
                <p className="text-[10px]">执行后显示截图</p>
              </div>
            )}
          </div>

          {/* 日志区 */}
          <div className="flex-1 min-h-0 bg-card border border-border rounded-xl overflow-hidden flex flex-col" style={{ minHeight: '120px', maxHeight: '260px' }}>
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border flex-shrink-0">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">执行日志</p>
              <button onClick={() => setLogs([])} className="text-[9px] text-muted-foreground hover:text-foreground">清空</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2.5 font-mono text-[10px] space-y-0.5">
              {logs.length === 0 ? (
                <p className="text-muted-foreground">等待执行...</p>
              ) : logs.map((l, i) => (
                <div key={i} className={`flex gap-2 ${l.text.includes('❌') ? 'text-red-400' : l.text.includes('✅') || l.text.includes('🎉') ? 'text-green-400' : 'text-foreground/70'}`}>
                  <span className="text-muted-foreground shrink-0">{l.ts}</span>
                  <span className="whitespace-pre-wrap break-all">{l.text}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 节点完整卡片 ──────────────────────────────────────────────────────────────

type TabKey = 'docs' | 'debug';

function NodeCard({ item }: { item: NodeCatalogItem }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>('docs');

  return (
    <div className={`rounded-2xl border transition-all overflow-hidden ${open ? 'border-primary/50 shadow-md' : 'border-border'} bg-card`}>
      {/* 头部 */}
      <button
        onClick={() => setOpen(p => !p)}
        className="w-full text-left px-5 py-4 flex items-start gap-4 hover:bg-muted/10 transition-colors"
      >
        <span className="text-3xl flex-shrink-0 mt-0.5">{item.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-foreground">{item.label}</span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{item.type}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${item.category === 'basic' ? 'bg-blue-500/15 text-blue-400' : 'bg-purple-500/15 text-purple-400'}`}>
              {item.category === 'basic' ? '基础' : '高级'}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{item.desc}</p>
        </div>
        <span className="text-muted-foreground text-xs flex-shrink-0 mt-1.5">{open ? '▲' : '▼'}</span>
      </button>

      {/* 展开内容 */}
      {open && (
        <>
          {/* Tabs */}
          <div className="flex border-t border-border">
            {(['docs', 'debug'] as TabKey[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 text-xs font-medium transition-colors border-b-2 ${
                  tab === t ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t === 'docs' ? '📖 参数文档' : '🔧 Debug 调试'}
              </button>
            ))}
          </div>

          {/* 文档 Tab */}
          {tab === 'docs' && (
            <div className="px-5 py-4 space-y-4 bg-background/50">
              {/* 通用节点属性 */}
              <section>
                <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">通用属性（所有节点）</h3>
                <div className="space-y-0">
                  {Object.entries(NODE_LEVEL_PARAM_META).map(([key, meta]) => (
                    <ParamRow key={key} paramKey={key} meta={meta} />
                  ))}
                  {[
                    { key: 'waitAfter', type: 'boolean' as const, label: '后置等待', desc: '启用后节点执行完毕后继续等待指定条件（URL跳转/元素出现/关键词）', example: '{ enabled: true, urlContains: "/success", timeout: 15000 }' },
                    { key: 'autoScreenshot', type: 'boolean' as const, label: '自动截图', desc: '执行后自动截取页面快照（默认 true）。截图显示在 Debug 面板中', example: 'true' },
                    { key: 'continueOnError', type: 'boolean' as const, label: '失败继续', desc: '节点执行失败时是否继续执行下一步（默认 false）', example: 'true' },
                  ].map(({ key, type, label, desc, example }) => (
                    <div key={key} className="grid grid-cols-[190px_1fr] gap-x-4 items-start py-2 border-b border-border/40 last:border-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-mono text-foreground/90">{key}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border ${TYPE_STYLE[type]}`}>{type}</span>
                      </div>
                      <div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed"><span className="text-foreground/70 font-medium">{label}：</span>{desc}</p>
                        {example && <p className="text-[10px] text-primary/70 font-mono mt-0.5">示例：{example}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* 节点专属参数 */}
              {Object.keys(item.paramMeta).length > 0 && (
                <section>
                  <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">节点参数</h3>
                  <div>
                    {Object.entries(item.paramMeta).map(([key, meta]) => (
                      <ParamRow key={key} paramKey={key} meta={meta} />
                    ))}
                  </div>
                </section>
              )}

              {/* 默认值 */}
              {Object.keys(item.defaultParams).length > 0 && (
                <section>
                  <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">默认参数值</h3>
                  <pre className="bg-muted/40 rounded-xl px-3 py-2.5 text-[11px] font-mono text-foreground/80 overflow-x-auto">
                    {JSON.stringify(item.defaultParams, null, 2)}
                  </pre>
                </section>
              )}
            </div>
          )}

          {/* Debug Tab */}
          {tab === 'debug' && <NodeDebugPanel item={item} />}
        </>
      )}
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────────

export default function NodesPage() {
  const [filter, setFilter] = useState<'all' | 'basic' | 'advanced'>('all');
  const [search, setSearch] = useState('');

  const filtered = NODE_CATALOG.filter(n => {
    if (filter !== 'all' && n.category !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return n.label.toLowerCase().includes(q) || n.type.toLowerCase().includes(q) || n.desc.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* 页头 */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">节点库</h1>
        <p className="text-sm text-muted-foreground mt-1">
          浏览所有节点类型的参数文档，或直接在真实浏览器中 Debug 调试单个节点
        </p>
      </div>

      {/* 过滤栏 */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex gap-1 bg-muted/50 rounded-xl p-1">
          {(['all', 'basic', 'advanced'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-lg text-xs transition-colors ${filter === f ? 'bg-card shadow text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}>
              {f === 'all' ? '全部' : f === 'basic' ? '基础节点' : '高级节点'}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索节点..."
          className="flex-1 bg-muted/30 border border-border rounded-xl px-3 py-1.5 text-xs outline-none focus:border-primary"
        />
      </div>

      {/* 节点列表 */}
      <div className="space-y-2 mb-8">
        {filtered.map(item => (
          <NodeCard key={item.type} item={item} />
        ))}
        {filtered.length === 0 && (
          <div className="text-center text-muted-foreground py-12">
            <p className="text-2xl mb-2">🔍</p>
            <p className="text-sm">没有找到匹配的节点</p>
          </div>
        )}
      </div>

      {/* 模板变量说明 */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <h2 className="text-sm font-semibold mb-1">模板变量</h2>
        <p className="text-[11px] text-muted-foreground mb-3">
          在 <span className="font-mono bg-muted px-1 rounded">template</span> 类型参数中使用 <span className="font-mono bg-muted px-1 rounded">{'{{变量名}}'}</span> 占位，执行时自动替换：
        </p>
        <div>
          {Object.entries(WORKFLOW_VARS_META).map(([key, desc]) => (
            <div key={key} className="flex items-center gap-3 py-1.5 border-b border-border/50 last:border-0">
              <span className="font-mono text-[11px] text-primary w-28 shrink-0">{`{{${key}}}`}</span>
              <span className="text-[11px] text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
