'use client';

/**
 * Workflow Debug Editor
 *
 * 接入 /api/workflow/session 的新节点引擎：
 * - 左侧：节点步骤列表（每步可单独执行/跳过）
 * - 右上：发布参数 + 浏览器实时截图预览
 * - 右下：SSE 日志流 + QR 码弹窗
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowStep } from '@/components/workflow-visualizer';
import { douyinPublishWorkflow } from '@/lib/workflow/workflows/douyin-publish';

// ── 类型 ──────────────────────────────────────────────────────────────────────

type StepStatus = 'pending' | 'running' | 'success' | 'warn' | 'error' | 'skip';

interface LogEntry {
  ts: string;
  text: string;
}

interface DebugCtx {
  videoUrl: string;
  title: string;
  tags: string;
  clientId: string;
}

interface MaterialItem {
  id: string;
  platform: string;
  title: string;
  ossUrl: string;
  parsedAt: number;
}

interface WorkflowEditorProps {
  workflow: {
    id: string;
    name: string;
    steps: WorkflowStep[]; // kept for legacy compatibility, not used
  };
  initialContext?: Partial<DebugCtx>;
  onStepUpdate?: (stepId: string, updates: Partial<WorkflowStep>) => void;
}

// ── 工具 ──────────────────────────────────────────────────────────────────────

const NODE_ICONS: Record<string, string> = {
  navigate:       '🌐',
  text_input:     '✏️',
  click:          '👆',
  scroll:         '🖱️',
  screenshot:     '📸',
  file_upload:    '📤',
  wait_condition: '⏳',
  qrcode:         '📱',
};

const STATUS_STYLE: Record<StepStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  running: 'bg-blue-500/20 text-blue-400 animate-pulse',
  success: 'bg-green-500/20 text-green-400',
  warn:    'bg-yellow-500/20 text-yellow-400',
  error:   'bg-red-500/20 text-red-400',
  skip:    'bg-muted/50 text-muted-foreground/50',
};

const STATUS_LABEL: Record<StepStatus, string> = {
  pending: '待执行', running: '执行中', success: '✓ 成功',
  warn: '⚠ 警告', error: '✗ 失败', skip: '跳过',
};

function ts() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export function WorkflowEditor({ initialContext }: WorkflowEditorProps) {
  const workflow = douyinPublishWorkflow; // 使用新引擎的工作流定义
  const nodes = workflow.nodes;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepStatus, setStepStatus] = useState<StepStatus[]>(
    nodes.map(() => 'pending')
  );
  const [expandedParams, setExpandedParams] = useState<Set<number>>(new Set());
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [showMaterials, setShowMaterials] = useState(false);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [ctx, setCtx] = useState<DebugCtx>({
    videoUrl: initialContext?.videoUrl ?? '',
    title:    initialContext?.title ?? '',
    tags:     initialContext?.tags ?? '',
    clientId: initialContext?.clientId ?? '',
  });

  const logEndRef = useRef<HTMLDivElement>(null);

  // 自动滚动日志到底部
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const appendLog = useCallback((text: string) => {
    setLogs(prev => [...prev, { ts: ts(), text }]);
  }, []);

  // ── 创建 Session ─────────────────────────────────────────────────────────

  async function createSession() {
    if (!ctx.videoUrl || !ctx.title) {
      appendLog('❌ 请先填写视频地址和标题');
      return;
    }
    try {
      appendLog('🚀 正在创建 Debug 会话...');
      const res = await fetch('/api/workflow/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: 'douyin-publish',
          vars: { videoUrl: ctx.videoUrl, title: ctx.title, tags: ctx.tags ?? '' },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'session 创建失败');
      setSessionId(data.sessionId);
      setCurrentStep(0);
      setStepStatus(nodes.map(() => 'pending'));
      appendLog(`✅ 会话已创建：${data.sessionId}`);
      appendLog(`📋 工作流：${workflow.name}（${data.totalSteps} 步）`);
    } catch (e) {
      appendLog(`❌ 创建失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── 关闭 Session ─────────────────────────────────────────────────────────

  async function closeSession() {
    if (!sessionId) return;
    await fetch(`/api/workflow/session/${sessionId}`, { method: 'DELETE' }).catch(() => {});
    setSessionId(null);
    appendLog('🗑️ 会话已关闭');
  }

  // ── 执行步骤（SSE）──────────────────────────────────────────────────────

  const executeStep = useCallback(async (idx: number, skip = false) => {
    if (!sessionId || running) return;
    setRunning(true);
    setCurrentStep(idx);
    setStepStatus(prev => { const n = [...prev]; n[idx] = 'running'; return n; });
    appendLog(`\n── 步骤 ${idx + 1}/${nodes.length}：${nodes[idx].label ?? nodes[idx].type} ──`);

    try {
      const res = await fetch(`/api/workflow/session/${sessionId}/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(skip ? { skip: true } : {}),
      });

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';

        for (const part of parts) {
          const line = part.replace(/^data:\s*/m, '').trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line) as { type: string; payload: string };
            if (evt.type === 'log') appendLog(evt.payload);
            if (evt.type === 'screenshot') setScreenshot(evt.payload);
            if (evt.type === 'qrcode') { setQrcode(evt.payload); appendLog('📱 二维码已显示，请扫码'); }
            if (evt.type === 'done') {
              const data = JSON.parse(evt.payload) as {
                result?: { success: boolean; error?: string };
                nextStep: number;
                done: boolean;
                failed: boolean;
                skipped?: boolean;
              };
              const status: StepStatus = data.skipped
                ? 'skip'
                : data.failed
                  ? 'error'
                  : (data.result?.success ? 'success' : 'warn');
              setStepStatus(prev => { const n = [...prev]; n[idx] = status; return n; });
              if (data.done) {
                setCurrentStep(nodes.length);
                appendLog('\n🎉 工作流执行完成！');
              } else {
                setCurrentStep(data.nextStep);
              }
              if (data.result?.error) appendLog(`❌ ${data.result.error}`);
            }
            if (evt.type === 'error') {
              appendLog(`❌ 错误：${evt.payload}`);
              setStepStatus(prev => { const n = [...prev]; n[idx] = 'error'; return n; });
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (e) {
      appendLog(`❌ 步骤执行异常：${e instanceof Error ? e.message : String(e)}`);
      setStepStatus(prev => { const n = [...prev]; n[idx] = 'error'; return n; });
    } finally {
      setRunning(false);
    }
  }, [sessionId, running, nodes, appendLog]);

  // ── 素材库 ────────────────────────────────────────────────────────────

  async function openMaterials() {
    setShowMaterials(true);
    setMaterialsLoading(true);
    try {
      const res = await fetch('/api/materials');
      const data = await res.json() as MaterialItem[];
      setMaterials(Array.isArray(data) ? data : []);
    } catch { appendLog('❌ 素材库加载失败'); }
    finally { setMaterialsLoading(false); }
  }

  function applyMaterial(item: MaterialItem) {
    setCtx(p => ({ ...p, videoUrl: item.ossUrl, title: item.title || p.title }));
    setShowMaterials(false);
    appendLog(`📦 已选择素材：${item.title || '（无标题）'}`);
  }

  // ── 刷新截图 ─────────────────────────────────────────────────────────

  async function refreshScreenshot() {
    if (!sessionId) return;
    const res = await fetch(`/api/workflow/session/${sessionId}`).catch(() => null);
    if (!res) return;
    const data = await res.json() as { screenshot?: string };
    if (data.screenshot) setScreenshot(data.screenshot);
  }

  // ── 渲染 ─────────────────────────────────────────────────────────────

  const isDone = currentStep >= nodes.length;

  return (
    <div className="flex h-full">

      {/* ── 左侧：步骤列表 ── */}
      <div className="w-80 border-r border-border bg-card flex flex-col flex-shrink-0">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold text-foreground">{workflow.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{nodes.length} 个节点 · Debug 逐步执行</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {nodes.map((node, i) => {
            const status = stepStatus[i];
            const isCurrent = sessionId && i === currentStep && !isDone;
            const isExpanded = expandedParams.has(i);
            const paramEntries = Object.entries(node.params ?? {}).filter(([, v]) => v !== undefined && v !== '');
            return (
              <div
                key={i}
                className={`rounded-lg border transition-all ${
                  isCurrent
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/40'
                }`}
              >
                {/* 节点头部 */}
                <div className="p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-muted-foreground text-xs w-5 text-center">{i + 1}</span>
                    <span className="text-base">{NODE_ICONS[node.type] ?? '⚙️'}</span>
                    <span className="text-sm font-medium text-foreground truncate flex-1">
                      {node.label ?? node.type}
                    </span>
                    {paramEntries.length > 0 && (
                      <button
                        onClick={() => setExpandedParams(prev => {
                          const n = new Set(prev);
                          n.has(i) ? n.delete(i) : n.add(i);
                          return n;
                        })}
                        className="text-[10px] text-muted-foreground hover:text-foreground px-1"
                        title={isExpanded ? '收起参数' : '查看参数'}
                      >
                        {isExpanded ? '▲' : '▼'}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-1 pl-7">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_STYLE[status]}`}>
                      {STATUS_LABEL[status]}
                    </span>
                    <div className="flex gap-1">
                      <button
                        disabled={!sessionId || running || isDone}
                        onClick={() => void executeStep(i)}
                        className="px-2 py-0.5 text-[11px] bg-primary text-white rounded disabled:opacity-40 hover:bg-primary/80"
                      >
                        ▶
                      </button>
                      <button
                        disabled={!sessionId || running || isDone}
                        onClick={() => void executeStep(i, true)}
                        className="px-2 py-0.5 text-[11px] bg-muted text-foreground rounded disabled:opacity-40 hover:bg-muted/70"
                        title="跳过此步"
                      >
                        ⏭
                      </button>
                    </div>
                  </div>
                </div>

                {/* 参数展开区 */}
                {isExpanded && paramEntries.length > 0 && (
                  <div className="border-t border-border/60 px-3 py-2 space-y-1 bg-muted/20">
                    {paramEntries.map(([k, v]) => (
                      <div key={k} className="flex gap-2 text-[10px]">
                        <span className="text-muted-foreground font-mono shrink-0 w-24 truncate">{k}</span>
                        <span className="text-foreground font-mono break-all">
                          {Array.isArray(v)
                            ? `[${(v as unknown[]).join(', ')}]`
                            : typeof v === 'object'
                              ? JSON.stringify(v)
                              : String(v)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 底部操作栏 */}
        <div className="border-t border-border p-3 space-y-2">
          {!sessionId ? (
            <button
              onClick={() => void createSession()}
              disabled={!ctx.videoUrl || !ctx.title}
              className="w-full py-2 text-sm bg-primary text-white rounded-lg disabled:opacity-50 hover:bg-primary/90"
            >
              🚀 开始 Debug 会话
            </button>
          ) : (
            <>
              <button
                onClick={() => void executeStep(currentStep)}
                disabled={running || isDone}
                className="w-full py-2 text-sm bg-primary text-white rounded-lg disabled:opacity-50 hover:bg-primary/90"
              >
                {running ? '执行中...' : isDone ? '✓ 已完成' : `▶ 执行步骤 ${currentStep + 1}`}
              </button>
              <button
                onClick={() => void closeSession()}
                className="w-full py-1.5 text-xs bg-muted text-foreground rounded-lg hover:bg-muted/70"
              >
                🗑️ 关闭会话
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── 右侧：主区域 ── */}
      <div className="flex-1 min-w-0 flex flex-col bg-background overflow-hidden">

        {/* 顶部工具栏 */}
        <div className="h-12 border-b border-border bg-card px-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-foreground">Debug 发布控制台</span>
            {sessionId && (
              <span className="text-xs text-muted-foreground font-mono">
                #{sessionId.slice(-12)}
              </span>
            )}
            {sessionId && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                isDone ? 'bg-green-500/20 text-green-400' :
                running ? 'bg-blue-500/20 text-blue-400 animate-pulse' :
                'bg-yellow-500/20 text-yellow-400'
              }`}>
                {isDone ? '已完成' : running ? '执行中' : `步骤 ${currentStep + 1}/${nodes.length}`}
              </span>
            )}
          </div>
          {sessionId && (
            <button
              onClick={() => void refreshScreenshot()}
              className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/70 text-foreground"
            >
              🔄 刷新截图
            </button>
          )}
        </div>

        {/* 内容区（上下分割） */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">

          {/* 上半部分：参数 + 截图 */}
          <div className="flex gap-3 p-3 h-64 flex-shrink-0">

            {/* 发布参数 */}
            <div className="w-80 flex-shrink-0 bg-card border border-border rounded-xl p-3 overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-foreground">发布参数</p>
                <button
                  onClick={() => void openMaterials()}
                  className="text-[11px] px-2 py-0.5 border border-primary/40 text-primary rounded hover:bg-primary/10"
                >
                  从素材库选择 {materials.length > 0 ? materials.length : ''}
                </button>
              </div>
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-0.5">视频地址（OSS URL）</label>
                  <input
                    value={ctx.videoUrl}
                    onChange={e => setCtx(p => ({ ...p, videoUrl: e.target.value }))}
                    disabled={!!sessionId}
                    className="w-full bg-muted border border-border rounded px-2 py-1 text-[11px] text-foreground outline-none focus:border-primary disabled:opacity-60"
                    placeholder="https://...mp4"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-0.5">标题</label>
                  <input
                    value={ctx.title}
                    onChange={e => setCtx(p => ({ ...p, title: e.target.value }))}
                    disabled={!!sessionId}
                    className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-primary disabled:opacity-60"
                    placeholder="输入标题"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-0.5">话题标签（可选）</label>
                  <input
                    value={ctx.tags}
                    onChange={e => setCtx(p => ({ ...p, tags: e.target.value }))}
                    disabled={!!sessionId}
                    className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-primary disabled:opacity-60"
                    placeholder="情感,治愈,日常"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-0.5">插件凭证（可选）</label>
                  <input
                    value={ctx.clientId}
                    onChange={e => setCtx(p => ({ ...p, clientId: e.target.value }))}
                    disabled={!!sessionId}
                    className="w-full bg-muted border border-border rounded px-2 py-1 text-[11px] font-mono text-foreground outline-none focus:border-primary disabled:opacity-60"
                    placeholder="dy_xxxxxxx"
                  />
                </div>
              </div>
            </div>

            {/* 浏览器截图预览 */}
            <div className="flex-1 bg-card border border-border rounded-xl overflow-hidden relative">
              <div className="absolute top-2 left-3 text-[10px] text-muted-foreground z-10">
                浏览器预览
                {sessionId && <span className="ml-2 text-green-500">● 会话活跃</span>}
              </div>
              {screenshot ? (
                <img
                  src={screenshot}
                  alt="browser state"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                  {sessionId ? '等待第一次执行截图...' : '创建会话后将显示浏览器画面'}
                </div>
              )}
            </div>
          </div>

          {/* 下半部分：日志控制台 */}
          <div className="flex-1 min-h-0 mx-3 mb-3 bg-card border border-border rounded-xl flex flex-col overflow-hidden">
            <div className="px-4 py-2 border-b border-border flex items-center justify-between flex-shrink-0">
              <span className="text-xs font-semibold text-foreground">执行日志</span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">{logs.length} 条</span>
                <button
                  onClick={() => setLogs([])}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  清空
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-0.5">
              {logs.length === 0 ? (
                <p className="text-muted-foreground text-center mt-8">填写参数后点击「开始 Debug 会话」</p>
              ) : (
                logs.map((entry, i) => (
                  <div
                    key={i}
                    className={`leading-relaxed ${
                      entry.text.startsWith('❌') ? 'text-red-400' :
                      entry.text.startsWith('✅') || entry.text.startsWith('🎉') ? 'text-green-400' :
                      entry.text.startsWith('⚠') ? 'text-yellow-400' :
                      entry.text.startsWith('──') ? 'text-muted-foreground' :
                      'text-foreground'
                    }`}
                  >
                    <span className="text-muted-foreground mr-2">[{entry.ts}]</span>
                    {entry.text}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>

      {/* ── QR 码弹窗 ── */}
      {qrcode && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full text-center shadow-2xl">
            <p className="text-sm font-semibold text-foreground mb-1">📱 抖音扫码登录</p>
            <p className="text-xs text-muted-foreground mb-4">请用抖音 App 扫描下方二维码</p>
            <img
              src={qrcode}
              alt="QR code"
              className="w-56 h-56 mx-auto rounded-xl border border-border object-contain"
            />
            <p className="text-xs text-muted-foreground mt-3">扫码确认后此弹窗将自动关闭</p>
            <button
              onClick={() => setQrcode(null)}
              className="mt-4 text-xs text-muted-foreground hover:text-foreground"
            >
              关闭（不影响扫码进度）
            </button>
          </div>
        </div>
      )}

      {/* ── 素材库弹窗 ── */}
      {showMaterials && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setShowMaterials(false)}
        >
          <div
            className="w-full max-w-3xl max-h-[80vh] bg-card border border-border rounded-xl overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">选择素材</p>
              <button onClick={() => setShowMaterials(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {materialsLoading && <p className="text-sm text-muted-foreground text-center py-10">加载中...</p>}
              {!materialsLoading && materials.length === 0 && <p className="text-sm text-muted-foreground text-center py-10">暂无素材</p>}
              {!materialsLoading && materials.map(item => (
                <div key={item.id} className="border border-border rounded-lg p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground font-medium truncate">{item.title || '（无标题）'}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.ossUrl}</p>
                  </div>
                  <button
                    onClick={() => applyMaterial(item)}
                    className="px-3 py-1.5 text-xs bg-primary text-white rounded hover:bg-primary/90 flex-shrink-0"
                  >
                    选择
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
