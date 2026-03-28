'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkflowDef, NodeDef, NodeType, WaitAfterConfig } from '@/lib/workflow/types';
import type { HumanOptions } from '@/lib/workflow/human-options';
import { DEFAULT_HUMAN_OPTIONS } from '@/lib/workflow/human-options';
import { NODE_CATALOG, getCatalogItem, WORKFLOW_VARS_META, NODE_LEVEL_PARAM_META } from '@/lib/workflow/node-catalog';

// ── 类型 ──────────────────────────────────────────────────────────────────────

type StepStatus = 'pending' | 'running' | 'success' | 'warn' | 'error' | 'skip';
interface LogEntry { ts: string; text: string; }
interface DebugCtx { videoUrl: string; title: string; tags: string; clientId: string; }
interface MaterialItem { id: string; platform?: string; title: string; ossUrl: string; }

export interface WorkflowEditorProps {
  workflow: WorkflowDef;
  initialContext?: Partial<DebugCtx>;
}

// ── 常量 ──────────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<StepStatus, string> = {
  pending: 'bg-muted/80 text-muted-foreground',
  running: 'bg-blue-500/20 text-blue-400 animate-pulse',
  success: 'bg-green-500/20 text-green-400',
  warn:    'bg-yellow-500/20 text-yellow-400',
  error:   'bg-red-500/20 text-red-400',
  skip:    'bg-muted/40 text-muted-foreground/50',
};
const STATUS_LABEL: Record<StepStatus, string> = {
  pending:'待执行', running:'执行中', success:'✓ 成功', warn:'⚠ 警告', error:'✗ 失败', skip:'跳过',
};
function ts() { return new Date().toLocaleTimeString('zh-CN', { hour12: false }); }

// ── 参数说明 Tooltip ──────────────────────────────────────────────────────────

function ParamTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="w-3.5 h-3.5 rounded-full bg-muted text-muted-foreground text-[8px] flex items-center justify-center hover:bg-primary/20 hover:text-primary transition-colors"
      >?</button>
      {show && (
        <span className="absolute left-5 top-0 z-50 w-60 bg-popover border border-border rounded-lg p-2 text-[10px] text-foreground shadow-xl leading-relaxed whitespace-pre-wrap">
          {text}
        </span>
      )}
    </span>
  );
}

function ScreenshotPreviewModal({
  screenshot,
  title,
  onClose,
}: {
  screenshot: string;
  title?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[90] bg-black/85 backdrop-blur-sm p-4 md:p-6" onClick={onClose}>
      <div className="h-full w-full flex flex-col gap-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-white">
          <div>
            <p className="text-sm font-semibold">{title ?? '截图预览'}</p>
            <p className="text-[11px] text-white/60">按 `Esc` 关闭，适合扫码和查看页面细节</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/15"
          >
            关闭
          </button>
        </div>
        <div className="flex-1 overflow-hidden rounded-2xl border border-white/10 bg-black/30 flex items-center justify-center">
          <img src={screenshot} alt="browser preview" className="w-full h-full object-contain" draggable={false} />
        </div>
      </div>
    </div>
  );
}

// ── 参数编辑器 ────────────────────────────────────────────────────────────────

function ParamEditor({
  params, onChange, nodeType, showVarsHint, compact,
}: {
  params: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
  nodeType?: NodeType;
  showVarsHint?: boolean;
  compact?: boolean;
}) {
  const catalog = nodeType ? getCatalogItem(nodeType) : undefined;
  const entries = Object.entries(params);

  function setVal(key: string, raw: string) {
    let val: unknown = raw;
    if (raw === 'true') val = true;
    else if (raw === 'false') val = false;
    else if (/^\d+$/.test(raw) && raw.length < 10) val = Number(raw);
    else if (raw.startsWith('[')) { try { val = JSON.parse(raw); } catch { val = raw; } }
    onChange({ ...params, [key]: val });
  }

  function addKey() {
    const key = prompt('参数名（英文）');
    if (key && !(key in params)) onChange({ ...params, [key]: '' });
  }

  function removeKey(key: string) {
    const p = { ...params }; delete p[key]; onChange(p);
  }

  function displayVal(v: unknown) {
    if (Array.isArray(v)) return JSON.stringify(v);
    if (typeof v === 'object' && v !== null) return JSON.stringify(v);
    return String(v ?? '');
  }

  return (
    <div className="space-y-2">
      {showVarsHint && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg px-2.5 py-2 mb-1">
          <p className="text-[9px] text-primary font-semibold mb-1.5">可用模板变量</p>
          <div className="grid grid-cols-2 gap-0.5">
            {Object.entries(WORKFLOW_VARS_META).map(([k, desc]) => (
              <div key={k} className="text-[9px]">
                <span className="font-mono text-primary">{`{{${k}}}`}</span>
                <span className="text-muted-foreground ml-1">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {entries.map(([k, v]) => {
        const meta = catalog?.paramMeta[k];
        const isSelector = meta?.type === 'selector' || k.toLowerCase().includes('selector');
        const isTemplate = meta?.type === 'template';
        return (
          <div key={k} className="space-y-0.5">
            <div className="flex items-center gap-1">
              <span className={`text-[10px] font-semibold ${isSelector ? 'text-orange-400' : isTemplate ? 'text-purple-400' : 'text-muted-foreground'}`}>
                {meta?.label ?? k}
              </span>
              {!compact && meta && (
                <span className="text-[9px] text-muted-foreground font-mono">({k})</span>
              )}
              {meta && <ParamTooltip text={`${meta.desc}${meta.example ? `\n\n示例：${meta.example}` : ''}`} />}
              {meta?.required && <span className="text-[9px] text-red-400">*</span>}
              <div className="flex-1" />
              <button onClick={() => removeKey(k)} className="text-[9px] text-muted-foreground hover:text-red-400 transition-colors">✕</button>
            </div>
            <input
              value={displayVal(v)}
              onChange={e => setVal(k, e.target.value)}
              className={`w-full bg-background border rounded-lg px-2.5 py-1.5 text-[11px] font-mono outline-none focus:border-primary transition-colors ${
                isSelector ? 'border-orange-400/40 focus:border-orange-400' :
                isTemplate ? 'border-purple-400/40 focus:border-purple-400' :
                'border-border'
              }`}
              placeholder={meta?.example ?? ''}
            />
          </div>
        );
      })}
      <button onClick={addKey} className="text-[10px] text-primary hover:underline">+ 添加参数</button>
    </div>
  );
}

// ── waitAfter 编辑器 ──────────────────────────────────────────────────────────

function WaitAfterEditor({
  value, onChange,
}: {
  value?: WaitAfterConfig;
  onChange: (v: WaitAfterConfig) => void;
}) {
  const wa = value ?? {};
  const enabled = wa.enabled ?? false;

  function set(patch: Partial<WaitAfterConfig>) { onChange({ ...wa, ...patch }); }

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <div
          className={`w-7 h-3.5 rounded-full transition-colors relative flex-shrink-0 ${enabled ? 'bg-primary' : 'bg-muted'}`}
          onClick={() => set({ enabled: !enabled })}
        >
          <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
        </div>
        <span className="text-[11px] text-foreground">启用后置等待</span>
        <ParamTooltip text="节点执行完成后，继续等待额外条件成立（URL跳转、元素出现/消失、关键词）。适合需要确认执行结果的节点" />
      </label>
      {enabled && (
        <div className="pl-3 space-y-2 border-l-2 border-primary/30">
          {[
            { key: 'urlContains', label: 'URL 包含', placeholder: '/content/manage' },
            { key: 'selector',    label: '等待元素', placeholder: '.publish-success' },
          ].map(({ key, label, placeholder }) => (
            <div key={key} className="space-y-0.5">
              <label className="text-[10px] text-muted-foreground">{label}</label>
              <input
                value={String(wa[key as keyof WaitAfterConfig] ?? '')}
                onChange={e => set({ [key]: e.target.value || undefined })}
                placeholder={placeholder}
                className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-[11px] font-mono outline-none focus:border-primary"
              />
            </div>
          ))}
          {wa.selector && (
            <div className="space-y-0.5">
              <label className="text-[10px] text-muted-foreground">条件</label>
              <select
                value={wa.action ?? 'appeared'}
                onChange={e => set({ action: e.target.value as WaitAfterConfig['action'] })}
                className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-[11px] outline-none focus:border-primary"
              >
                <option value="appeared">元素出现</option>
                <option value="disappeared">元素消失</option>
              </select>
            </div>
          )}
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground">超时 (ms)</label>
            <input
              type="number"
              value={wa.timeout ?? 15000}
              onChange={e => set({ timeout: Number(e.target.value) })}
              className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-[11px] outline-none focus:border-primary"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── 节点详情 + 执行面板（右侧）──────────────────────────────────────────────

function NodeDetailPanel({
  node, idx, total, onChange, onClose,
  sessionId, vars,
  onStepStatusChange,
}: {
  node: NodeDef;
  idx: number;
  total: number;
  onChange: (patch: Partial<NodeDef>) => void;
  onClose: () => void;
  sessionId: string | null;
  vars: Record<string, string>;
  onStepStatusChange?: (idx: number, status: 'success' | 'error' | 'running') => void;
}) {
  const catalog = getCatalogItem(node.type);
  const [running, setRunning] = useState(false);
  const [screenshotting, setScreenshotting] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [execResult, setExecResult] = useState<{ success: boolean } | null>(null);
  const [pauseState, setPauseState] = useState<{ token: string; message: string } | null>(null);
  const [remoteControl, setRemoteControl] = useState(false);
  const [remoteTyping, setRemoteTyping] = useState('');
  const [hoverCoord, setHoverCoord] = useState<{ x: number; y: number } | null>(null);
  const [isScreenshotExpanded, setIsScreenshotExpanded] = useState(false);
  const [isScreenshotFullscreen, setIsScreenshotFullscreen] = useState(false);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const screenshotImgRef = useRef<HTMLImageElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // 遥控模式：自动刷新截图
  useEffect(() => {
    if (remoteControl) {
      autoRefreshRef.current = setInterval(() => { void refreshScreenshot(); }, 1500);
    } else {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    }
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
  }, [remoteControl]); // eslint-disable-line react-hooks/exhaustive-deps

  // 计算图像内实际坐标（考虑 object-contain 留边）
  function calcBrowserCoords(e: React.MouseEvent<HTMLDivElement>): { x: number; y: number } | null {
    const img = screenshotImgRef.current;
    const container = e.currentTarget;
    if (!img) return null;
    const rect = container.getBoundingClientRect();
    // 浏览器视口尺寸（Playwright 默认 1280×800）
    const vpW = 1280, vpH = 800;
    const scaleX = rect.width / vpW;
    const scaleY = rect.height / vpH;
    const scale = Math.min(scaleX, scaleY); // object-contain 缩放比
    const renderedW = vpW * scale;
    const renderedH = vpH * scale;
    const offsetX = (rect.width - renderedW) / 2;
    const offsetY = (rect.height - renderedH) / 2;
    const relX = e.clientX - rect.left - offsetX;
    const relY = e.clientY - rect.top - offsetY;
    if (relX < 0 || relY < 0 || relX > renderedW || relY > renderedH) return null;
    return {
      x: Math.round(relX / scale),
      y: Math.round(relY / scale),
    };
  }

  async function remoteInteract(action: string, extra?: Record<string, unknown>) {
    const res = await fetch('/api/workflow/browser/interact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId ?? undefined, action, ...extra }),
    });
    if (res.ok) {
      const d = await res.json() as { screenshot?: string; url?: string };
      if (d.screenshot) setScreenshot(d.screenshot);
    }
  }

  async function refreshScreenshot() {
    if (screenshotting) return;
    setScreenshotting(true);
    try {
      if (sessionId) {
        const res = await fetch(`/api/workflow/session/${sessionId}`);
        if (res.ok) {
          const d = await res.json() as { screenshot?: string };
          if (d.screenshot) setScreenshot(d.screenshot);
        }
      } else {
        const res = await fetch('/api/workflow/node-debug');
        if (res.ok) {
          const d = await res.json() as { screenshot?: string };
          if (d.screenshot) setScreenshot(d.screenshot);
        }
      }
    } finally {
      setScreenshotting(false);
    }
  }

  function addLog(text: string) {
    setLogs(prev => {
      const next = [...prev, { ts: new Date().toLocaleTimeString('zh-CN', { hour12: false }), text }];
      setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
      return next;
    });
  }

  async function runNode() {
    if (running) return;
    setRunning(true);
    setLogs([]);
    setScreenshot(null);
    setExecResult(null);
    onStepStatusChange?.(idx, 'running');

    try {
      let res: Response;
      if (sessionId) {
        // 通过 session 执行（接力浏览器状态）
        res = await fetch(`/api/workflow/session/${sessionId}/step`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stepIndex: idx }),
        });
      } else {
        // 无 session：用 node-debug 开临时页面执行
        res = await fetch('/api/workflow/node-debug', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ node, vars }),
        });
      }

      if (!res.body) throw new Error('无响应流');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.replace(/^data:\s*/m, '').trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line) as { type: string; payload: string };
            if (evt.type === 'log') addLog(evt.payload);
            if (evt.type === 'screenshot') setScreenshot(evt.payload);
            if (evt.type === 'human_pause') {
              const p = JSON.parse(evt.payload) as { token: string; message: string };
              setPauseState(p);
            }
            if (evt.type === 'done') {
              setPauseState(null);
              const d = JSON.parse(evt.payload) as { success?: boolean; result?: { success: boolean } };
              const ok = d.success ?? d.result?.success ?? false;
              setExecResult({ success: ok });
              onStepStatusChange?.(idx, ok ? 'success' : 'error');
            }
            if (evt.type === 'error') {
              setPauseState(null);
              addLog(`❌ ${evt.payload}`);
              setExecResult({ success: false });
              onStepStatusChange?.(idx, 'error');
            }
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      addLog(`❌ ${e}`);
      setExecResult({ success: false });
      onStepStatusChange?.(idx, 'error');
    } finally {
      setRunning(false);
    }
  }

  function renderScreenshotCanvas(extraClassName = '') {
    return (
      <div
        className={`bg-card border rounded-xl overflow-hidden relative ${
          remoteControl
            ? 'border-orange-500/60 cursor-crosshair'
            : 'border-border cursor-default'
        } ${extraClassName}`}
        onClick={remoteControl ? async (e) => {
          const coord = calcBrowserCoords(e);
          if (!coord) return;
          addLog(`🖱 点击 (${coord.x}, ${coord.y})`);
          await remoteInteract('click', { x: coord.x, y: coord.y });
        } : undefined}
        onMouseMove={remoteControl ? (e) => {
          const coord = calcBrowserCoords(e);
          setHoverCoord(coord);
        } : undefined}
        onMouseLeave={() => setHoverCoord(null)}
      >
        {screenshot ? (
          <>
            <img
              ref={screenshotImgRef}
              src={screenshot}
              alt="browser"
              className="w-full h-full object-contain"
              draggable={false}
            />
            <div className="absolute top-2 right-2 flex items-center gap-1.5">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsScreenshotExpanded(v => !v);
                }}
                className="rounded-md border border-black/10 bg-black/65 px-2 py-1 text-[10px] font-medium text-white hover:bg-black/80"
                title={isScreenshotExpanded ? '缩回标准高度' : '放大截图区域'}
              >
                {isScreenshotExpanded ? '缩回' : '放大'}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsScreenshotFullscreen(true);
                }}
                className="rounded-md border border-black/10 bg-black/65 px-2 py-1 text-[10px] font-medium text-white hover:bg-black/80"
                title="全屏查看截图"
              >
                全屏
              </button>
            </div>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-center text-muted-foreground">
            <div>
              <p className="text-2xl mb-1">🖥</p>
              <p className="text-[10px]">执行节点后显示截图</p>
              <p className="text-[9px] mt-0.5 text-muted-foreground/60">或点「🖱 遥控」截取当前状态</p>
            </div>
          </div>
        )}
        {remoteControl && (
          <div className="absolute top-1.5 left-1.5 bg-orange-500/90 text-white text-[9px] px-1.5 py-0.5 rounded font-medium">
            遥控中 · 1.5s 自动刷新
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="h-full flex flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border flex-shrink-0 bg-card">
        <span className="text-lg">{catalog?.icon ?? '⚙️'}</span>
        <div className="flex-1 min-w-0">
          <input
            value={node.label ?? ''}
            onChange={e => onChange({ label: e.target.value })}
            placeholder={catalog?.label ?? node.type}
            className="bg-transparent text-sm font-semibold outline-none hover:bg-muted/30 focus:bg-muted/30 rounded px-1 -ml-1 w-full"
          />
          <p className="text-[10px] text-muted-foreground">
            步骤 {idx + 1}/{total}
            {sessionId
              ? <span className="ml-1.5 text-green-400">· session 接力</span>
              : <span className="ml-1.5 text-muted-foreground/60">· 独立执行</span>}
          </p>
        </div>
        {/* 重置草稿页（无 session 时可见） */}
        {!sessionId && (
          <button
            onClick={async () => {
              await fetch('/api/workflow/node-debug', { method: 'DELETE' });
              setLogs([]);
              setScreenshot(null);
              setExecResult(null);
              addLog('🔄 草稿页已重置，浏览器状态清空');
            }}
            disabled={running}
            title="重置浏览器状态，从空白页重新开始"
            className="text-[10px] px-2 py-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-muted/70 disabled:opacity-40 transition-colors"
          >
            🔄 重置
          </button>
        )}
        {/* 执行按钮 */}
        <button
          onClick={() => void runNode()}
          disabled={running}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            running
              ? 'bg-primary/50 text-white cursor-not-allowed'
              : execResult?.success === true
              ? 'bg-green-500 text-white hover:bg-green-500/90'
              : execResult?.success === false
              ? 'bg-red-500/80 text-white hover:bg-red-500/90'
              : 'bg-primary text-white hover:bg-primary/90'
          }`}
        >
          {running
            ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />执行中</>
            : execResult?.success === true ? '✓ 成功'
            : execResult?.success === false ? '✗ 重试'
            : '▶ 执行'}
        </button>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-sm w-6 h-6 flex items-center justify-center rounded hover:bg-muted/50">✕</button>
      </div>

      {/* 主体：左侧参数 + 右侧执行结果 */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* 左侧：参数配置（可滚动） */}
        <div className="w-[52%] border-r border-border overflow-y-auto p-4 space-y-4 flex-shrink-0">

          {/* 前置导航 URL */}
          <section>
            <div className="flex items-center gap-1 mb-1.5">
              <h3 className="text-[10px] font-semibold text-blue-400 uppercase tracking-wide">前置导航 URL</h3>
              <ParamTooltip text={NODE_LEVEL_PARAM_META.url.desc} />
            </div>
            <input
              value={node.url ?? ''}
              onChange={e => onChange({ url: e.target.value || undefined })}
              className="w-full bg-background border border-blue-400/30 rounded-lg px-2.5 py-1.5 text-[11px] font-mono outline-none focus:border-blue-400"
              placeholder="https://... （留空则不自动导航）"
            />
          </section>

          {/* 节点参数 */}
          <section>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">节点参数</h3>
            <ParamEditor
              params={node.params as Record<string, unknown>}
              onChange={p => onChange({ params: p })}
              nodeType={node.type}
              showVarsHint={node.type === 'text_input' || node.type === 'file_upload'}
            />
          </section>

          {/* 后置等待 */}
          <section>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">后置等待</h3>
            <WaitAfterEditor
              value={node.waitAfter}
              onChange={wa => onChange({ waitAfter: wa })}
            />
          </section>

          {/* 其他选项 */}
          <section>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">其他选项</h3>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={!!node.continueOnError}
                  onChange={e => onChange({ continueOnError: e.target.checked })}
                  className="accent-primary" />
                <span className="text-[11px] text-foreground">失败时继续执行</span>
                <ParamTooltip text="即使此节点执行失败，也不中断工作流，继续执行下一步" />
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={node.autoScreenshot !== false}
                  onChange={e => onChange({ autoScreenshot: e.target.checked || undefined })}
                  className="accent-primary" />
                <span className="text-[11px] text-foreground">执行后自动截图</span>
                <ParamTooltip text="节点执行完毕后自动截取页面快照（默认开启）" />
              </label>
            </div>
          </section>
        </div>

        {/* 右侧：执行结果（截图 + 日志） */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

          {/* 人工暂停横幅 */}
          {pauseState && (
            <div className="mx-3 mt-3 rounded-xl border-2 border-yellow-500/60 bg-yellow-500/10 p-3 flex-shrink-0">
              <div className="flex items-start gap-2 mb-2.5">
                <span className="text-lg shrink-0">🙋</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-yellow-400">等待人工操作</p>
                  <p className="text-[11px] text-yellow-300/80 mt-0.5 leading-relaxed">{pauseState.message}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    await fetch('/api/workflow/pause/resume', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ token: pauseState.token }),
                    });
                    setPauseState(null);
                    addLog('▶ 已确认完成，继续执行');
                  }}
                  className="flex-1 py-1.5 text-xs font-medium bg-yellow-500 text-black rounded-lg hover:bg-yellow-400 transition-colors"
                >
                  ✓ 已完成，继续执行
                </button>
                <button
                  onClick={() => void refreshScreenshot()}
                  disabled={screenshotting}
                  className="px-3 py-1.5 text-xs bg-muted text-foreground rounded-lg hover:bg-muted/70 transition-colors disabled:opacity-50"
                >
                  {screenshotting ? '...' : '📸 刷新截图'}
                </button>
              </div>
            </div>
          )}

          {/* 截图 / 遥控区 */}
          <div className="flex-shrink-0 m-3 mb-0 flex flex-col gap-1.5">
            {/* 工具栏 */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  setRemoteControl(p => {
                    if (!p) void refreshScreenshot(); // 开启时立即截一张
                    return !p;
                  });
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                  remoteControl
                    ? 'bg-orange-500 text-white border-orange-400 shadow'
                    : 'bg-background text-foreground border-border hover:border-orange-400 hover:text-orange-500'
                }`}
                title="点击开启遥控模式，然后直接点击截图里的元素操控浏览器"
              >
                🖱 {remoteControl ? '遥控中 ●' : '开启遥控'}
              </button>
              {remoteControl && (
                <>
                  <button onClick={() => void remoteInteract('key', { key: 'Escape' })} className="px-2 py-1 rounded-lg text-[10px] bg-muted text-muted-foreground hover:bg-muted/70">Esc</button>
                  <button onClick={() => void remoteInteract('key', { key: 'Enter' })} className="px-2 py-1 rounded-lg text-[10px] bg-muted text-muted-foreground hover:bg-muted/70">Enter</button>
                  <button onClick={() => void remoteInteract('key', { key: 'Tab' })} className="px-2 py-1 rounded-lg text-[10px] bg-muted text-muted-foreground hover:bg-muted/70">Tab</button>
                  <div className="flex-1" />
                  <button
                    onClick={() => void refreshScreenshot()}
                    disabled={screenshotting}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] bg-blue-500 text-white hover:bg-blue-400 disabled:opacity-50"
                    title="重新截取浏览器当前画面"
                  >
                    {screenshotting ? '...' : '📸 立即刷新画面'}
                  </button>
                  {hoverCoord && (
                    <span className="text-[9px] text-muted-foreground font-mono ml-1.5">
                      {hoverCoord.x}, {hoverCoord.y}
                    </span>
                  )}
                </>
              )}
              {!remoteControl && (
                <>
                  {screenshot && (
                    <>
                      <button
                        onClick={() => setIsScreenshotExpanded(v => !v)}
                        className="px-2 py-1 rounded-lg text-[10px] bg-muted text-muted-foreground hover:bg-muted/70 ml-auto"
                      >
                        {isScreenshotExpanded ? '↙ 缩回' : '↗ 放大'}
                      </button>
                      <button
                        onClick={() => setIsScreenshotFullscreen(true)}
                        className="px-2 py-1 rounded-lg text-[10px] bg-muted text-muted-foreground hover:bg-muted/70"
                      >
                        ⛶ 全屏
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => void refreshScreenshot()}
                    disabled={screenshotting}
                    className={`px-2 py-1 rounded-lg text-[10px] bg-muted text-muted-foreground hover:bg-muted/70 disabled:opacity-50 ${screenshot ? '' : 'ml-auto'}`}
                  >
                    {screenshotting ? '...' : '📸 刷新'}
                  </button>
                </>
              )}
            </div>

            {/* 截图画布 */}
            {renderScreenshotCanvas(isScreenshotExpanded ? 'h-[30rem]' : 'h-44')}

            {/* 遥控输入框 */}
            {remoteControl && (
              <div className="flex gap-1.5">
                <input
                  value={remoteTyping}
                  onChange={e => setRemoteTyping(e.target.value)}
                  onKeyDown={async e => {
                    if (e.key === 'Enter') {
                      await remoteInteract('type', { text: remoteTyping });
                      addLog(`⌨ 输入：${remoteTyping}`);
                      setRemoteTyping('');
                    }
                  }}
                  placeholder="需要模拟键盘输入时在此输入（如搜索框文字） → 回车发送"
                  className="flex-1 bg-background border border-orange-500/40 rounded-lg px-2.5 py-1.5 text-[11px] outline-none focus:border-orange-500 placeholder:text-muted-foreground/50"
                />
                <button
                  onClick={async () => {
                    if (!remoteTyping) return;
                    await remoteInteract('type', { text: remoteTyping });
                    addLog(`⌨ 输入：${remoteTyping}`);
                    setRemoteTyping('');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-[11px] font-semibold hover:bg-orange-400 flex-shrink-0"
                >
                  键盘发送
                </button>
              </div>
            )}
          </div>

          {/* 日志 */}
          <div className="flex-1 m-3 bg-card border border-border rounded-xl overflow-hidden flex flex-col min-h-0">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border flex-shrink-0">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">执行日志</p>
              <button onClick={() => setLogs([])} className="text-[9px] text-muted-foreground hover:text-foreground">清空</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2.5 font-mono text-[10px] space-y-0.5">
              {logs.length === 0
                ? <p className="text-muted-foreground">等待执行...</p>
                : logs.map((l, i) => (
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

      {isScreenshotFullscreen && screenshot && (
        <div className="fixed inset-0 z-[95] bg-black/90 backdrop-blur-sm p-3 md:p-5" onClick={() => setIsScreenshotFullscreen(false)}>
          <div className="h-full w-full flex flex-col gap-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-white">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">节点调试截图</p>
                <p className="text-[11px] text-white/60">
                  {remoteControl ? '全屏遥控模式，适合扫码和精确点按页面控件' : '全屏预览模式，适合扫码和查看页面细节'}
                </p>
              </div>
              {remoteControl && hoverCoord && (
                <span className="rounded-md bg-white/10 px-2 py-1 text-[11px] font-mono text-white/80">
                  {hoverCoord.x}, {hoverCoord.y}
                </span>
              )}
              <button
                onClick={() => setIsScreenshotFullscreen(false)}
                className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/15"
              >
                关闭
              </button>
            </div>
            {renderScreenshotCanvas('flex-1 min-h-0')}
          </div>
        </div>
      )}
    </>
  );
}

// ── 节点添加面板（Modal 方式）────────────────────────────────────────────────

function AddNodeModal({
  onSelect, onClose,
}: {
  onSelect: (type: NodeType) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-80 p-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold">选择节点类型</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-sm">✕</button>
        </div>
        <div className="space-y-3">
          {(['basic', 'advanced'] as const).map(cat => (
            <div key={cat}>
              <p className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1.5">
                {cat === 'basic' ? '基础节点' : '高级节点'}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {NODE_CATALOG.filter(n => n.category === cat).map(item => (
                  <button
                    key={item.type}
                    onClick={() => { onSelect(item.type); onClose(); }}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-xl border border-border hover:border-primary/50 hover:bg-muted/40 text-left transition-colors"
                  >
                    <span className="text-lg">{item.icon}</span>
                    <div>
                      <p className="text-xs font-medium text-foreground">{item.label}</p>
                      <p className="text-[9px] text-muted-foreground leading-tight">{item.desc.slice(0, 20)}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 右键菜单 ──────────────────────────────────────────────────────────────────

function ContextMenu({
  x, y, onEdit, onCopy, onDelete, onInsertBefore, onInsertAfter, onClose,
}: {
  x: number; y: number;
  onEdit: () => void; onCopy: () => void; onDelete: () => void;
  onInsertBefore: () => void; onInsertAfter: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  const items = [
    { label: '✏️ 编辑参数', fn: onEdit },
    { label: '📋 复制节点', fn: onCopy },
    { sep: true },
    { label: '⬆ 在上方插入', fn: onInsertBefore },
    { label: '⬇ 在下方插入', fn: onInsertAfter },
    { sep: true },
    { label: '🗑 删除节点', fn: onDelete, danger: true },
  ];

  return (
    <div ref={ref} style={{ position: 'fixed', top: y, left: x, zIndex: 9999 }}
      className="bg-card border border-border rounded-xl shadow-xl py-1 min-w-[150px]">
      {items.map((item, i) =>
        'sep' in item ? <div key={i} className="border-t border-border my-1" /> : (
          <button key={i} onClick={() => { item.fn(); onClose(); }}
            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors ${item.danger ? 'text-red-400' : 'text-foreground'}`}>
            {item.label}
          </button>
        )
      )}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export function WorkflowEditor({ workflow: initialWorkflow, initialContext }: WorkflowEditorProps) {
  // ── 工作流编辑 ─────────────────────────────────────────────────────────────
  const [nodes, setNodes] = useState<NodeDef[]>(initialWorkflow.nodes);
  const [workflowName, setWorkflowName] = useState(initialWorkflow.name);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [addNodeAfterIdx, setAddNodeAfterIdx] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeIdx: number } | null>(null);
  const [showHumanOptions, setShowHumanOptions] = useState(false);
  const dragIdx = useRef<number | null>(null);

  // ── Debug ──────────────────────────────────────────────────────────────────
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [lastExecutedStep, setLastExecutedStep] = useState<number | null>(null); // 接力追踪
  const [stepStatus, setStepStatus] = useState<StepStatus[]>(initialWorkflow.nodes.map(() => 'pending'));
  const [humanOptions, setHumanOptions] = useState<HumanOptions>({ ...DEFAULT_HUMAN_OPTIONS });
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [isDebugScreenshotFullscreen, setIsDebugScreenshotFullscreen] = useState(false);

  // ── 素材 ───────────────────────────────────────────────────────────────────
  const [showMaterialPicker, setShowMaterialPicker] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialItem | null>(null);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [ctx, setCtx] = useState<DebugCtx>({
    videoUrl: initialContext?.videoUrl ?? '',
    title:    initialContext?.title ?? '',
    tags:     initialContext?.tags ?? '',
    clientId: initialContext?.clientId ?? '',
  });

  const logEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  useEffect(() => {
    fetch('/api/materials').then(r => r.json()).then(d => { if (Array.isArray(d)) setMaterials(d); }).catch(() => {});
  }, []);

  const appendLog = useCallback((text: string) => {
    setLogs(prev => [...prev, { ts: ts(), text }]);
  }, []);

  function updateNodes(next: NodeDef[]) {
    setNodes(next);
    setIsDirty(true);
    if (!sessionId) setStepStatus(next.map(() => 'pending'));
  }

  // ── 保存 ───────────────────────────────────────────────────────────────────
  async function saveWorkflow() {
    setSaving(true);
    try {
      const res = await fetch(`/api/workflows/${initialWorkflow.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: workflowName, nodes, vars: initialWorkflow.vars, description: initialWorkflow.description }),
      });
      if (!res.ok) throw new Error(await res.text());
      setIsDirty(false);
    } catch (e) { alert(`保存失败: ${e}`); }
    finally { setSaving(false); }
  }

  // ── 节点操作 ───────────────────────────────────────────────────────────────
  function updateNode(idx: number, patch: Partial<NodeDef>) {
    updateNodes(nodes.map((n, i) => i === idx ? { ...n, ...patch } : n));
  }
  function copyNode(idx: number) {
    const next = [...nodes];
    next.splice(idx + 1, 0, JSON.parse(JSON.stringify(nodes[idx])));
    updateNodes(next);
  }
  function deleteNode(idx: number) {
    if (!confirm(`确认删除「${nodes[idx].label ?? nodes[idx].type}」？`)) return;
    updateNodes(nodes.filter((_, i) => i !== idx));
    if (editingIdx === idx) setEditingIdx(null);
    else if (editingIdx !== null && editingIdx > idx) setEditingIdx(editingIdx - 1);
  }
  function insertNode(afterIdx: number, type: NodeType) {
    const catalog = getCatalogItem(type);
    if (!catalog) return;
    const newNode: NodeDef = { type, label: catalog.label, params: { ...catalog.defaultParams } };
    const next = [...nodes];
    next.splice(afterIdx + 1, 0, newNode);
    updateNodes(next);
    setEditingIdx(afterIdx + 1);
  }

  // ── 拖拽 ───────────────────────────────────────────────────────────────────
  function onDragStart(e: React.DragEvent, idx: number) { dragIdx.current = idx; e.dataTransfer.effectAllowed = 'move'; }
  function onDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    const next = [...nodes];
    const [moved] = next.splice(dragIdx.current, 1);
    next.splice(idx, 0, moved);
    dragIdx.current = idx;
    updateNodes(next);
  }
  function onDragEnd() { dragIdx.current = null; }

  // ── Debug Session ──────────────────────────────────────────────────────────
  async function createSession() {
    if (!ctx.videoUrl || !ctx.title) { appendLog('❌ 请先填写视频地址和标题'); return; }
    try {
      appendLog('🚀 创建 Debug 会话...');
      const vars: Record<string, string> = {};
      if (ctx.videoUrl) vars.videoUrl = ctx.videoUrl;
      if (ctx.title)    vars.title    = ctx.title;
      if (ctx.tags)     vars.tags     = ctx.tags;
      if (ctx.clientId) vars.clientId = ctx.clientId;
      const res = await fetch('/api/workflow/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflow: { ...initialWorkflow, name: workflowName, nodes },
          vars,
          humanOptions,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSessionId(data.sessionId);
      setCurrentStep(0);
      setLastExecutedStep(null);
      setStepStatus(nodes.map(() => 'pending'));
      setEditingIdx(null);
      appendLog(`✅ 会话已创建（${data.totalSteps} 步）— 点击任意节点 ▶ 执行`);
    } catch (e) { appendLog(`❌ ${e}`); }
  }

  async function closeSession() {
    if (!sessionId) return;
    await fetch(`/api/workflow/session/${sessionId}`, { method: 'DELETE' }).catch(() => {});
    setSessionId(null);
    setLastExecutedStep(null);
    appendLog('🗑️ 会话已关闭');
  }

  const executeStep = useCallback(async (idx: number, skip = false) => {
    if (!sessionId || running) return;
    setRunning(true);
    setCurrentStep(idx);
    setStepStatus(prev => { const n = [...prev]; n[idx] = 'running'; return n; });
    try {
      const body = skip ? { skip: true, stepIndex: idx } : { stepIndex: idx };
      const res = await fetch(`/api/workflow/session/${sessionId}/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.body) throw new Error('No body');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n'); buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.replace(/^data:\s*/m, '').trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line) as { type: string; payload: string };
            if (evt.type === 'log') appendLog(evt.payload);
            if (evt.type === 'screenshot') setScreenshot(evt.payload);
            if (evt.type === 'qrcode') { setQrcode(evt.payload); appendLog('📱 二维码已显示'); }
            if (evt.type === 'done') {
              const d = JSON.parse(evt.payload) as {
                result?: { success: boolean; error?: string };
                executedStep: number;
                nextStep: number;
                done: boolean;
                failed: boolean;
                skipped?: boolean;
                relay: boolean;
              };
              const st: StepStatus = d.skipped ? 'skip' : d.failed ? 'error' : d.result?.success ? 'success' : 'warn';
              setStepStatus(prev => { const n = [...prev]; n[idx] = st; return n; });
              setLastExecutedStep(d.executedStep ?? idx);
              if (d.done) { setCurrentStep(nodes.length); appendLog('\n🎉 工作流完成！'); }
              else setCurrentStep(d.nextStep);
              if (d.result?.error) appendLog(`❌ ${d.result.error}`);
            }
            if (evt.type === 'error') {
              appendLog(`❌ ${evt.payload}`);
              setStepStatus(prev => { const n = [...prev]; n[idx] = 'error'; return n; });
            }
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      appendLog(`❌ ${e}`);
      setStepStatus(prev => { const n = [...prev]; n[idx] = 'error'; return n; });
    } finally { setRunning(false); }
  }, [sessionId, running, nodes, appendLog]);

  async function refreshScreenshot() {
    if (!sessionId) return;
    const res = await fetch(`/api/workflow/session/${sessionId}`).catch(() => null);
    if (!res?.ok) return;
    const d = await res.json() as { screenshot?: string };
    if (d.screenshot) setScreenshot(d.screenshot);
  }

  const isDone = currentStep >= nodes.length;

  // ── 右侧面板决策 ───────────────────────────────────────────────────────────
  // 节点已选中 → 节点详情 + 执行面板（无论有无 session）
  // session 激活但未选节点 → 全局 debug 日志面板
  // 空闲（无 session，无选中）→ 发布参数填写

  const rightPanelMode: 'node' | 'debug' | 'idle' =
    editingIdx !== null ? 'node' :
    sessionId ? 'debug' :
    'idle';

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── 左侧：节点列表 ── */}
      <div className="w-[260px] border-r border-border bg-card flex flex-col flex-shrink-0 overflow-hidden">

        {/* 工具栏 */}
        <div className="px-3 py-2 border-b border-border flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground flex-1">{nodes.length} 个节点</span>
          {isDirty && (
            <button onClick={() => void saveWorkflow()} disabled={saving}
              className="text-[10px] px-2 py-0.5 bg-primary text-white rounded hover:bg-primary/90 disabled:opacity-50">
              {saving ? '保存中' : '保存'}
            </button>
          )}
          {!sessionId && (
            <button onClick={() => setAddNodeAfterIdx(nodes.length - 1)}
              className="text-[10px] px-2 py-0.5 bg-muted hover:bg-muted/70 rounded text-foreground">
              + 添加
            </button>
          )}
        </div>

        {/* 节点列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">

          {/* 预节点：显示工作流变量 */}
          <div className="rounded-lg border border-dashed border-primary/30 bg-primary/3 px-2.5 py-2 mb-2">
            <p className="text-[9px] uppercase tracking-wide text-primary/70 font-semibold mb-1.5">输入变量</p>
            <div className="space-y-0.5">
              {initialWorkflow.vars.map(v => (
                <div key={v} className="flex items-center gap-1.5 text-[10px]">
                  <span className="font-mono text-muted-foreground w-16 truncate shrink-0">{v}</span>
                  <span className="text-primary/50">→</span>
                  <span className="font-mono text-primary">{`{{${v}}}`}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 节点卡片 */}
          {nodes.map((node, i) => {
            const status = stepStatus[i] ?? 'pending';
            const isCurrent = !!sessionId && i === currentStep && !isDone;
            const isSelected = editingIdx === i;
            const catalog = getCatalogItem(node.type);
            // 接力状态：上一步刚执行完，本步是相邻下一步
            const isRelay = !!sessionId && lastExecutedStep !== null && lastExecutedStep + 1 === i;
            // 非相邻跳跃（仅在 session 中有意义）
            const isJump = !!sessionId && lastExecutedStep !== null && lastExecutedStep + 1 !== i && i !== lastExecutedStep;

            return (
              <div key={i}>
                <div
                  draggable={!sessionId}
                  onDragStart={e => onDragStart(e, i)}
                  onDragOver={e => onDragOver(e, i)}
                  onDragEnd={onDragEnd}
                  onDoubleClick={() => !sessionId && setEditingIdx(isSelected ? null : i)}
                  onClick={() => !sessionId && setEditingIdx(isSelected ? null : i)}
                  onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, nodeIdx: i }); }}
                  className={`rounded-lg border transition-all select-none ${
                    isCurrent ? 'border-primary bg-primary/5' :
                    isRelay ? 'border-green-500/60 bg-green-500/5' :
                    isSelected ? 'border-primary/70 bg-primary/5 shadow-sm' :
                    'border-border hover:bg-muted/20 hover:border-border/80'
                  } ${!sessionId ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
                >
                  <div className="px-2 py-2">
                    <div className="flex items-center gap-1.5">
                      {!sessionId && <span className="text-muted-foreground text-[10px] cursor-grab">⠿</span>}
                      <span className="text-[10px] text-muted-foreground w-4 text-center shrink-0">{i + 1}</span>
                      <span className="text-sm shrink-0">{catalog?.icon ?? '⚙️'}</span>
                      <span className="text-[11px] font-medium text-foreground flex-1 truncate">{node.label ?? node.type}</span>
                      {/* 接力徽章 */}
                      {isRelay && (
                        <span className="text-[8px] px-1 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 shrink-0">接力</span>
                      )}
                      <span className={`text-[9px] px-1 py-0.5 rounded-full shrink-0 ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
                    </div>

                    {/* URL 前置提示 */}
                    {node.url && (
                      <div className="pl-7 mt-0.5">
                        <span className="text-[9px] text-blue-400 font-mono truncate block">🌐 {node.url}</span>
                      </div>
                    )}

                    {/* waitAfter 提示 */}
                    {node.waitAfter?.enabled && (
                      <div className="pl-7 mt-0.5">
                        <span className="text-[9px] text-yellow-400">⏳ 后置等待</span>
                      </div>
                    )}

                    {/* 接力 / 跳跃提示（session 激活时） */}
                    {sessionId && (isRelay || isJump) && (
                      <div className="pl-7 mt-0.5">
                        {isRelay && <span className="text-[9px] text-green-400">🔗 接力自步骤 {lastExecutedStep! + 1}</span>}
                        {isJump && <span className="text-[9px] text-muted-foreground/50">🔀 跳跃执行</span>}
                      </div>
                    )}
                  </div>
                </div>

                {/* 节点间插入按钮 */}
                {!sessionId && (
                  <div className="h-4 flex items-center justify-center group/ins">
                    <button onClick={e => { e.stopPropagation(); setAddNodeAfterIdx(i); }}
                      className="opacity-0 group-hover/ins:opacity-100 text-[9px] px-2 py-0.5 bg-primary/15 text-primary rounded-full hover:bg-primary/25 transition-all">
                      + 插入
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {nodes.length === 0 && (
            <div className="flex flex-col items-center justify-center h-24 text-muted-foreground text-xs gap-2">
              <span className="text-2xl">📭</span>
              <span>点击上方「添加」开始</span>
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="border-t border-border p-2 space-y-2">
          {/* 人工模拟（折叠） */}
          <div>
            <button onClick={() => setShowHumanOptions(p => !p)}
              className="w-full flex items-center justify-between text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1">
              <span>🤖 人工模拟</span>
              <span>{showHumanOptions ? '▲' : '▼'}</span>
            </button>
            {showHumanOptions && (
              <div className="mt-1.5 bg-muted/20 rounded-lg p-1.5 space-y-1">
                {([
                  { key: 'humanMouse',     label: '🐭 鼠标轨迹' },
                  { key: 'humanType',      label: '⌨️ 打字节奏' },
                  { key: 'randomDelay',    label: '⏱️ 步骤停顿' },
                  { key: 'idleSimulation', label: '😴 空闲行为' },
                ] as { key: keyof HumanOptions; label: string }[]).map(({ key, label }) => (
                  <label key={key} className={`flex items-center justify-between cursor-pointer rounded px-1 py-0.5 transition-colors ${sessionId ? 'opacity-40 pointer-events-none' : 'hover:bg-muted/50'}`}>
                    <span className="text-[10px]">{label}</span>
                    <div className={`w-7 h-3.5 rounded-full transition-colors relative ${humanOptions[key] ? 'bg-primary' : 'bg-muted'}`}
                      onClick={() => !sessionId && setHumanOptions(p => ({ ...p, [key]: !p[key] }))}>
                      <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform ${humanOptions[key] ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Session 按钮 */}
          {!sessionId ? (
            <button onClick={() => void createSession()}
              className="w-full py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary/90">
              🚀 开始 Debug 会话
            </button>
          ) : (
            <div className="flex gap-1.5">
              <div className="flex-1 flex flex-col gap-1">
                <p className="text-[9px] text-muted-foreground text-center">点击左侧节点查看参数并执行</p>
                <button onClick={() => void closeSession()}
                  className="w-full py-1.5 text-xs bg-muted text-foreground rounded-lg hover:bg-muted/70">
                  🗑 关闭会话
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 右侧：上下文感知面板 ── */}
      <div className="flex-1 min-w-0 flex flex-col bg-background overflow-hidden">

        {/* 顶部栏 */}
        <div className="h-10 border-b border-border bg-card px-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <input value={workflowName} onChange={e => { setWorkflowName(e.target.value); setIsDirty(true); }}
              className="bg-transparent text-sm font-medium outline-none hover:bg-muted/30 focus:bg-muted/30 rounded px-1 -ml-1 w-48" />
            {sessionId && <span className="text-[10px] text-muted-foreground font-mono">#{sessionId.slice(-8)}</span>}
            {sessionId && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isDone ? 'bg-green-500/20 text-green-400' : running ? 'bg-blue-500/20 text-blue-400 animate-pulse' : 'bg-yellow-500/20 text-yellow-400'}`}>
                {isDone ? '已完成' : running ? '执行中...' : lastExecutedStep !== null ? `已执行步骤 ${lastExecutedStep + 1}` : '点击任意节点 ▶'}
              </span>
            )}
            {rightPanelMode === 'node' && editingIdx !== null && !sessionId && (
              <span className="text-[10px] text-muted-foreground">
                步骤 {editingIdx + 1}：{nodes[editingIdx]?.label ?? nodes[editingIdx]?.type}
              </span>
            )}
          </div>
          {sessionId && (
            <button onClick={() => void refreshScreenshot()} className="text-[10px] px-2 py-1 rounded bg-muted hover:bg-muted/70">🔄</button>
          )}
        </div>

        {/* ── 节点详情 + 执行面板（选中节点时始终显示）── */}
        {rightPanelMode === 'node' && editingIdx !== null && (
          <NodeDetailPanel
            node={nodes[editingIdx]}
            idx={editingIdx}
            total={nodes.length}
            onChange={patch => updateNode(editingIdx, patch)}
            onClose={() => setEditingIdx(null)}
            sessionId={sessionId}
            vars={Object.fromEntries(Object.entries(ctx).filter(([, v]) => v))}
            onStepStatusChange={(i, status) => {
              setStepStatus(prev => {
                const n = [...prev];
                n[i] = status;
                return n;
              });
              if (status !== 'running') setLastExecutedStep(i);
            }}
          />
        )}

        {/* ── 空闲模式：发布参数填写 ── */}
        {rightPanelMode === 'idle' && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="max-w-md">
              <p className="text-sm font-semibold mb-1">发布参数</p>
              <p className="text-[11px] text-muted-foreground mb-4">填写后点击「开始 Debug」启动调试会话，或点击左侧节点查看/编辑参数</p>

              {/* 素材选择器 */}
              <div className="mb-3">
                <label className="text-[10px] text-muted-foreground block mb-1">从素材库选择</label>
                <button onClick={() => setShowMaterialPicker(p => !p)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-[11px] transition-colors ${selectedMaterial ? 'border-primary/50 bg-primary/5 text-primary' : 'border-dashed border-border bg-muted/20 text-muted-foreground hover:border-primary/40'}`}>
                  <span className="truncate">{selectedMaterial ? `📦 ${selectedMaterial.title || '（无标题）'}` : `📦 选择素材${materials.length > 0 ? ` (${materials.length})` : ''}`}</span>
                  <span className="shrink-0 ml-1">{showMaterialPicker ? '▲' : '▼'}</span>
                </button>
                {showMaterialPicker && (
                  <div className="mt-1 border border-border rounded-xl overflow-hidden bg-card max-h-48 overflow-y-auto shadow-lg">
                    {materials.length === 0
                      ? <p className="text-center text-[10px] text-muted-foreground py-4">素材库为空</p>
                      : materials.map(m => (
                        <button key={m.id} onClick={() => {
                          setCtx(p => ({ ...p, videoUrl: m.ossUrl, title: m.title || p.title }));
                          setSelectedMaterial(m); setShowMaterialPicker(false);
                          appendLog(`📦 已选择素材：${m.title}`);
                        }}
                          className={`w-full text-left px-3 py-2.5 hover:bg-muted flex items-center gap-2 text-[11px] transition-colors ${selectedMaterial?.id === m.id ? 'bg-primary/10' : ''}`}>
                          <span>▶</span>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{m.title || '（无标题）'}</p>
                            <p className="truncate text-muted-foreground text-[9px]">{m.ossUrl}</p>
                          </div>
                          {selectedMaterial?.id === m.id && <span className="text-primary ml-auto shrink-0">✓</span>}
                        </button>
                      ))}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {([
                  { key: 'videoUrl', label: '视频地址', ph: 'https://...mp4' },
                  { key: 'title',    label: '标题',     ph: '输入标题' },
                  { key: 'tags',     label: '话题标签', ph: '情感,治愈（可选）' },
                  { key: 'clientId', label: '账号ID',   ph: 'dy_...' },
                ] as { key: keyof DebugCtx; label: string; ph: string }[]).map(({ key, label, ph }) => (
                  <div key={key}>
                    <label className="text-[10px] text-muted-foreground block mb-1">{label}</label>
                    <input value={ctx[key]} onChange={e => setCtx(p => ({ ...p, [key]: e.target.value }))}
                      className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-[11px] outline-none focus:border-primary transition-colors"
                      placeholder={ph} />
                  </div>
                ))}
              </div>

              {nodes.length > 0 && (
                <div className="mt-6 p-3 bg-muted/30 rounded-xl border border-dashed border-border">
                  <p className="text-[10px] text-muted-foreground">💡 点击左侧节点可查看和编辑参数，双击也可编辑</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Debug 模式：截图 + 日志 ── */}
        {rightPanelMode === 'debug' && (
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">

            {/* 上半：参数 + 截图 */}
            <div className="flex gap-3 p-3 h-60 flex-shrink-0">

              {/* 发布参数（只读，debug 中不能改） */}
              <div className="w-56 flex-shrink-0 bg-card border border-border rounded-xl p-3 overflow-y-auto">
                <p className="text-xs font-semibold mb-2">发布参数</p>
                <div className="space-y-1.5">
                  {([
                    { key: 'videoUrl', label: '视频地址' },
                    { key: 'title',    label: '标题' },
                    { key: 'tags',     label: '话题标签' },
                    { key: 'clientId', label: '账号ID' },
                  ] as { key: keyof DebugCtx; label: string }[]).map(({ key, label }) => (
                    <div key={key}>
                      <label className="text-[9px] text-muted-foreground block mb-0.5">{label}</label>
                      <p className="text-[11px] font-mono text-foreground/80 truncate bg-muted/30 rounded px-2 py-0.5">{ctx[key] || '—'}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* 截图 */}
              <div className="relative flex-1 bg-card border border-border rounded-xl overflow-hidden flex items-center justify-center">
                {screenshot
                  ? (
                    <>
                      <img
                        src={screenshot}
                        alt="browser"
                        className="w-full h-full object-contain cursor-zoom-in"
                        onClick={() => setIsDebugScreenshotFullscreen(true)}
                      />
                      <button
                        onClick={() => setIsDebugScreenshotFullscreen(true)}
                        className="absolute top-2 right-2 rounded-lg border border-black/10 bg-black/65 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-black/80"
                      >
                        ⛶ 全屏查看
                      </button>
                    </>
                  )
                  : <div className="text-center text-muted-foreground"><p className="text-3xl mb-1">🖥</p><p className="text-xs">执行步骤后显示截图</p></div>}
              </div>
            </div>

            {/* 日志 */}
            <div className="flex-1 mx-3 mb-3 bg-card border border-border rounded-xl overflow-hidden flex flex-col min-h-0">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-border flex-shrink-0">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">执行日志</p>
                <button onClick={() => setLogs([])} className="text-[10px] text-muted-foreground hover:text-foreground">清空</button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] space-y-0.5">
                {logs.length === 0 && <p className="text-muted-foreground">等待执行...</p>}
                {logs.map((l, i) => (
                  <div key={i} className={`flex gap-2 ${l.text.includes('❌') ? 'text-red-400' : l.text.includes('✅') || l.text.includes('🎉') ? 'text-green-400' : 'text-foreground/80'}`}>
                    <span className="text-muted-foreground shrink-0">{l.ts}</span>
                    <span className="whitespace-pre-wrap break-all">{l.text}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── 添加节点 Modal ── */}
      {addNodeAfterIdx !== null && (
        <AddNodeModal
          onSelect={type => { insertNode(addNodeAfterIdx, type); setAddNodeAfterIdx(null); }}
          onClose={() => setAddNodeAfterIdx(null)}
        />
      )}

      {/* ── 右键菜单 ── */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y}
          onEdit={() => setEditingIdx(contextMenu.nodeIdx)}
          onCopy={() => copyNode(contextMenu.nodeIdx)}
          onDelete={() => deleteNode(contextMenu.nodeIdx)}
          onInsertBefore={() => setAddNodeAfterIdx(contextMenu.nodeIdx - 1)}
          onInsertAfter={() => setAddNodeAfterIdx(contextMenu.nodeIdx)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* ── 二维码 ── */}
      {qrcode && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-card rounded-2xl p-6 shadow-xl text-center">
            <p className="font-semibold mb-3">请扫描二维码登录</p>
            <img src={qrcode} alt="QR" className="w-48 h-48 object-contain mx-auto rounded-xl" />
            <button onClick={() => setQrcode(null)} className="mt-4 px-4 py-2 text-sm bg-muted rounded-lg hover:bg-muted/70 w-full">关闭</button>
          </div>
        </div>
      )}

      {isDebugScreenshotFullscreen && screenshot && (
        <ScreenshotPreviewModal
          screenshot={screenshot}
          title="工作流调试截图"
          onClose={() => setIsDebugScreenshotFullscreen(false)}
        />
      )}
    </div>
  );
}
