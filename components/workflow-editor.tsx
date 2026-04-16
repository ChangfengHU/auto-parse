'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowDef, NodeDef, NodeType, NavigateParams, VertexAIParams, WaitAfterConfig } from '@/lib/workflow/types';
import type { HumanOptions } from '@/lib/workflow/human-options';
import { DEFAULT_HUMAN_OPTIONS } from '@/lib/workflow/human-options';
import { NODE_CATALOG, getCatalogItem, WORKFLOW_VARS_META, NODE_LEVEL_PARAM_META } from '@/lib/workflow/node-catalog';
import { VERTEX_CAPABILITY_META, getDefaultVertexPrompt, getVertexModelMeta, getVertexModelsForCapability, isBuiltInVertexPrompt } from '@/lib/workflow/vertex-ai-meta';
import { resolveParams } from '@/lib/workflow/resolver';

// ── 类型 ──────────────────────────────────────────────────────────────────────

type StepStatus = 'pending' | 'running' | 'success' | 'warn' | 'error' | 'skip';
interface LogEntry { ts: string; text: string; }
interface DebugCtx { videoUrl: string; title: string; tags: string; clientId: string; }
interface MaterialItem { id: string; platform?: string; title: string; ossUrl: string; }
interface ContentImageAsset {
  id: string;
  url: string;
  title: string;
  postId: string;
  noteId?: string;
  sourceLabel: string;
}
interface SessionStepDonePayload {
  result?: { success: boolean; error?: string };
  vars?: Record<string, string>;
  executedStep: number;
  nextStep: number;
  done: boolean;
  failed: boolean;
  skipped?: boolean;
  relay: boolean;
}

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
const DEBUG_VNC_URL = process.env.NEXT_PUBLIC_DEBUG_VNC_URL?.trim() ?? '';
const DEFAULT_ADS_BROWSER_INSTANCE_ID = 'k1b908rw';
const DEFAULT_TOPIC_GOAL =
  '给我当前最具价值的 3 个选题，目标是提升曝光量、播放量和粉丝增长；优先抖音语境，可直接执行落地';
const DEFAULT_TOPIC_SOURCES = 'douyin,bilibili,baidu,toutiao,thepaper';
const DEFAULT_SOURCE_IMAGE_URL =
  'https://images.vyibc.com/f6a7035ab2814a9b9eb3029063a903a4.png';
const DEFAULT_SOURCE_IMAGE_URLS = JSON.stringify([
  DEFAULT_SOURCE_IMAGE_URL,
  'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Fronalpstock_big.jpg/640px-Fronalpstock_big.jpg',
]);
const DEFAULT_GEMINI_CHARACTER_PROMPT =
  '以参考图中的同一位女生为唯一人物主体，保持五官、发型、脸型、肤色、年龄感、身材比例一致，不要改变人物身份。场景在海边日落时分，女生站在沙滩上微微侧身看向镜头，长发被海风轻轻吹起，脸上是自然放松的甜美微笑，一只手轻轻整理头发，另一只手自然下垂，背景是柔和海浪和金色夕阳，整体像高级感朋友圈打卡照片，真实摄影感，清透肤色，干净构图，生活方式大片，只输出一张静态图片，不要拼图，不要多人物，不要卡通。';
const DEFAULT_WORKFLOW_DEBUG_PRESETS: Record<string, Record<string, unknown>> = {
  '4a163587-6e5e-4176-8178-0915f0429ee0': {
    browserInstanceId: DEFAULT_ADS_BROWSER_INSTANCE_ID,
    noteUrl: DEFAULT_GEMINI_CHARACTER_PROMPT,
    sourceImageUrl: DEFAULT_SOURCE_IMAGE_URL,
    sourceImageUrls: [DEFAULT_SOURCE_IMAGE_URL],
  },
  'a8d3b8e1-427c-4b78-b896-afbe35ed026c': {
    browserInstanceId: DEFAULT_ADS_BROWSER_INSTANCE_ID,
    noteUrl: DEFAULT_GEMINI_CHARACTER_PROMPT,
    sourceImageUrl: DEFAULT_SOURCE_IMAGE_URL,
    sourceImageUrls: [DEFAULT_SOURCE_IMAGE_URL],
  },
};
const STANDARD_CONTEXT_KEYS = ['videoUrl', 'title', 'tags', 'clientId'] as const;
const STANDARD_CONTEXT_KEY_SET = new Set<string>(STANDARD_CONTEXT_KEYS);
function ts() { return new Date().toLocaleTimeString('zh-CN', { hour12: false }); }

function shouldSeedDefaultAdsBrowserInstance(workflow: WorkflowDef): boolean {
  if (!(workflow.vars ?? []).includes('browserInstanceId')) return false;
  return workflow.nodes.some((node) => {
    if (node.type !== 'navigate') return false;
    const params = (node.params ?? {}) as Partial<NavigateParams>;
    return Boolean(params.useAdsPower);
  });
}

function hasAdsNavigateNode(nodes: NodeDef[]): boolean {
  return nodes.some((node) => {
    if (node.type !== 'navigate') return false;
    const params = (node.params ?? {}) as Partial<NavigateParams>;
    return Boolean(params.useAdsPower);
  });
}

function collectTemplateVars(input: unknown, target: Set<string>) {
  if (typeof input === 'string') {
    const matches = input.match(/\{\{(\w+)\}\}/g) ?? [];
    matches.forEach((match) => target.add(match.replace(/[{}]/g, '')));
    return;
  }
  if (Array.isArray(input)) {
    input.forEach((item) => collectTemplateVars(item, target));
    return;
  }
  if (input && typeof input === 'object') {
    Object.values(input as Record<string, unknown>).forEach((value) => collectTemplateVars(value, target));
  }
}

function getNodeReferencedVars(node: NodeDef): string[] {
  const keys = new Set<string>();
  collectTemplateVars(node.params, keys);
  collectTemplateVars(node.url, keys);
  collectTemplateVars(node.waitAfter, keys);
  return Array.from(keys);
}

function fieldHint(key: string) {
  return WORKFLOW_VARS_META[key] || (
    key === 'videoUrl' ? '当前素材视频地址' :
    key === 'title' ? '当前标题内容' :
    key === 'tags' ? '当前标签内容' :
    key === 'clientId' ? '当前业务侧标识' :
    '运行时变量'
  );
}

function fieldPlaceholder(key: string) {
  return (
    key === 'goal' ? DEFAULT_TOPIC_GOAL :
    key === 'count' ? '3' :
    key === 'sources' ? DEFAULT_TOPIC_SOURCES :
    key === 'sourceImageUrl' ? DEFAULT_SOURCE_IMAGE_URL :
    key === 'sourceImageUrls' ? DEFAULT_SOURCE_IMAGE_URLS :
    `请输入 ${key}`
  );
}

function displayPreviewValue(value: unknown) {
  if (value == null || value === '') return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

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

function tokenizeCommaOrNewline(raw: string): string[] {
  const text = String(raw || '').trim();
  if (!text) return [];

  // 支持 JSON 数组字符串（推荐存储格式）
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((s) => String(s || '').trim()).filter(Boolean);
      }
    } catch {
      // ignore
    }
  }

  // 兼容旧格式：逗号/换行分隔
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function reviveStructuredString(raw: string): unknown {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (!text.startsWith('[') && !text.startsWith('{')) return raw;
  try {
    return JSON.parse(text);
  } catch {
    return raw;
  }
}

function serializeRuntimeVarsAsJson(values: Record<string, string>): string {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const trimmed = String(value || '').trim();
    if (!trimmed) continue;
    payload[key] = reviveStructuredString(trimmed);
  }
  return JSON.stringify(payload, null, 2);
}

function normalizeJsonValueToString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function extractRuntimeVarsFromJson(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const root = input as Record<string, unknown>;
  const nestedVars = root.vars;
  if (nestedVars && typeof nestedVars === 'object' && !Array.isArray(nestedVars)) {
    return {
      ...(nestedVars as Record<string, unknown>),
      ...Object.fromEntries(
        STANDARD_CONTEXT_KEYS
          .filter((key) => Object.prototype.hasOwnProperty.call(root, key))
          .map((key) => [key, root[key]])
      ),
    };
  }
  return root;
}

function getBuiltInWorkflowDebugInput(workflowId: string): string | null {
  const preset = DEFAULT_WORKFLOW_DEBUG_PRESETS[workflowId];
  if (!preset) return null;
  return JSON.stringify(preset, null, 2);
}

function SourceImageUrlsTagInput({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const tokens = useMemo(() => tokenizeCommaOrNewline(value), [value]);
  const [draft, setDraft] = useState('');

  const commitDraft = useCallback(() => {
    const next = draft.trim();
    if (!next) return;
    const merged = Array.from(new Set(tokens.concat(tokenizeCommaOrNewline(next))));
    onChange(JSON.stringify(merged));
    setDraft('');
  }, [draft, onChange, tokens]);

  const removeToken = useCallback((t: string) => {
    const next = tokens.filter((x) => x !== t);
    onChange(JSON.stringify(next));
  }, [onChange, tokens]);

  return (
    <div className="mt-2 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[11px] outline-none focus-within:border-primary">
      <div className="flex flex-wrap items-center gap-1.5">
        {tokens.map((t) => (
          <span
            key={t}
            title={t}
            className="group max-w-full inline-flex items-center gap-1 rounded-full border border-border bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300"
          >
            <span className="max-w-[220px] truncate font-mono">{t}</span>
            <button
              type="button"
              onClick={() => removeToken(t)}
              className="opacity-70 hover:opacity-100 text-emerald-200"
              aria-label="remove"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitDraft();
              return;
            }
            if (e.key === 'Backspace' && !draft && tokens.length > 0) {
              e.preventDefault();
              const next = tokens.slice(0, -1);
              onChange(JSON.stringify(next));
            }
          }}
          onBlur={() => commitDraft()}
          onPaste={(e) => {
            const text = e.clipboardData?.getData('text') ?? '';
            const pasted = tokenizeCommaOrNewline(text);
            if (pasted.length <= 1) return;
            e.preventDefault();
            const merged = Array.from(new Set(tokens.concat(pasted)));
            onChange(JSON.stringify(merged));
          }}
          placeholder={tokens.length === 0 ? placeholder : '输入 URL 回车添加…'}
          className="min-w-[180px] flex-1 bg-transparent font-mono outline-none"
        />
      </div>
      <div className="mt-1 text-[9px] text-muted-foreground">
        回车添加；支持粘贴多条（逗号/换行分隔）；Backspace 可删除最后一个。
      </div>
    </div>
  );
}

function RuntimeContextPanel({
  fieldKeys,
  values,
  adsEnabled,
  sessionId,
  currentStep,
  totalSteps,
  modeLabel,
  onChange,
  onResetAdsDefault,
  jsonValue,
  jsonError,
  onJsonChange,
  onApplyJson,
  onResetJsonFromCurrent,
  onLoadJsonDefault,
  onSaveJsonDefault,
}: {
  fieldKeys: string[];
  values: Record<string, string>;
  adsEnabled: boolean;
  sessionId: string | null;
  currentStep: number;
  totalSteps: number;
  modeLabel: string;
  onChange: (key: string, value: string) => void;
  onResetAdsDefault: () => void;
  jsonValue: string;
  jsonError: string | null;
  onJsonChange: (value: string) => void;
  onApplyJson: () => void;
  onResetJsonFromCurrent: () => void;
  onLoadJsonDefault: () => void;
  onSaveJsonDefault: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [showJsonEditor, setShowJsonEditor] = useState(true);
  const autoCollapsedForSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      autoCollapsedForSessionRef.current = null;
      setCollapsed(false);
      return;
    }
    if (autoCollapsedForSessionRef.current === sessionId) return;
    autoCollapsedForSessionRef.current = sessionId;
    setCollapsed(true);
    setShowJsonEditor(false);
  }, [sessionId]);

  const previewPairs = fieldKeys
    .map((key) => [key, values[key] ?? ''] as const)
    .filter(([, value]) => String(value).trim())
    .slice(0, 4);

  return (
    <div className="border-b border-border bg-card/95 px-4 py-3 flex-shrink-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold">运行上下文</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{modeLabel}</span>
            {adsEnabled && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">Ads 导航已启用</span>
            )}
            {sessionId && (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400 font-mono">
                #{sessionId.slice(-8)} · {Math.min(currentStep + 1, totalSteps)}/{totalSteps}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            这里统一编辑本次调试的运行时变量。修改只影响后续执行，不会直接改写工作流定义。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {adsEnabled && fieldKeys.includes('browserInstanceId') && !collapsed && (
            <button
              type="button"
              onClick={onResetAdsDefault}
              className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted"
            >
              恢复默认实例
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted"
          >
            {collapsed ? '展开上下文' : '收起上下文'}
          </button>
        </div>
      </div>

      {collapsed ? (
        <div className="mt-3 rounded-xl border border-border bg-background px-3 py-2.5">
          {previewPairs.length === 0 ? (
            <div className="text-[11px] text-muted-foreground">
              当前没有可展示的运行时变量，点击“展开上下文”可继续编辑。
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {previewPairs.map(([key, value]) => (
                <div key={key} className="max-w-full rounded-full border border-border bg-muted/30 px-3 py-1 text-[11px]">
                  <span className="text-muted-foreground">{key}</span>
                  <span className="mx-1 text-muted-foreground">=</span>
                  <span className="font-mono text-foreground/85">
                    {String(value).length > 48 ? `${String(value).slice(0, 48)}...` : String(value)}
                  </span>
                </div>
              ))}
              {fieldKeys.length > previewPairs.length && (
                <div className="rounded-full border border-dashed border-border px-3 py-1 text-[11px] text-muted-foreground">
                  还有 {fieldKeys.length - previewPairs.length} 个变量
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {fieldKeys.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-3 py-4 text-[11px] text-muted-foreground">
                当前工作流没有声明运行时变量。
              </div>
            ) : (
              fieldKeys.map((key) => (
                <div key={key} className="rounded-xl border border-border bg-background px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[11px] font-medium text-foreground">{key}</label>
                    <span className="text-[10px] text-muted-foreground">{fieldHint(key)}</span>
                  </div>
                  {key === 'sourceImageUrls' ? (
                    <SourceImageUrlsTagInput
                      value={values[key] ?? ''}
                      placeholder={fieldPlaceholder(key)}
                      onChange={(v) => onChange(key, v)}
                    />
                  ) : (
                    <input
                      value={values[key] ?? ''}
                      onChange={(e) => onChange(key, e.target.value)}
                      placeholder={fieldPlaceholder(key)}
                      className="mt-2 w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] font-mono outline-none focus:border-primary"
                    />
                  )}
                </div>
              ))
            )}
          </div>

          <div className="mt-3 rounded-xl border border-border bg-background">
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div>
                <p className="text-[11px] font-semibold text-foreground">JSON 入参</p>
                <p className="text-[10px] text-muted-foreground">
                  调试前可直接粘贴整包对象；支持数组/对象字段，也兼容 <code className="font-mono">{'{"vars": {...}}'}</code> 结构。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowJsonEditor((prev) => !prev)}
                className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted"
              >
                {showJsonEditor ? '收起 JSON' : '展开 JSON'}
              </button>
            </div>

            {showJsonEditor && (
              <div className="border-t border-border px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] text-muted-foreground">
                    应用时会覆盖当前运行时变量；`sourceImageUrls` 这类数组会自动转成工作流可用格式。
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onLoadJsonDefault}
                      className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted"
                    >
                      恢复默认
                    </button>
                    <button
                      type="button"
                      onClick={onResetJsonFromCurrent}
                      className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted"
                    >
                      从当前生成
                    </button>
                    <button
                      type="button"
                      onClick={onSaveJsonDefault}
                      className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted"
                    >
                      保存默认
                    </button>
                    <button
                      type="button"
                      onClick={onApplyJson}
                      className="rounded-lg bg-primary px-2.5 py-1.5 text-[11px] text-primary-foreground hover:bg-primary/90"
                    >
                      应用 JSON
                    </button>
                  </div>
                </div>

                <textarea
                  value={jsonValue}
                  onChange={(e) => onJsonChange(e.target.value)}
                  spellCheck={false}
                  rows={9}
                  placeholder={`{\n  "prompt": "你的提示词",\n  "browserInstanceId": "k1b908rw",\n  "sourceImageUrls": ["https://example.com/a.png"]\n}`}
                  className="mt-3 w-full rounded-xl border border-border bg-card px-3 py-2 text-[11px] font-mono outline-none focus:border-primary"
                />

                {jsonError && (
                  <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
                    {jsonError}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
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

  function ElementsEditor({
    value = [],
    onChange: onElementsChange
  }: {
    value: Array<{ text?: string, selector?: string, useSelector?: boolean }>;
    onChange: (v: Array<{ text?: string, selector?: string, useSelector?: boolean }>) => void;
  }) {
    const list = Array.isArray(value) ? value : [];
    
    const addElement = () => {
      onElementsChange([...list, { text: '', selector: '', useSelector: false }]);
    };
    
    const removeElement = (index: number) => {
      onElementsChange(list.filter((_, i) => i !== index));
    };
    
    const updateElement = (index: number, updates: Partial<{ text: string, selector: string, useSelector: boolean }>) => {
      onElementsChange(list.map((el, i) => i === index ? { ...el, ...updates } : el));
    };

    return (
      <div className="space-y-3 p-3 rounded-xl border border-dashed border-border bg-muted/5">
        {list.map((el, i) => (
          <div key={i} className="relative space-y-2 p-3 rounded-lg border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] font-bold text-primary/60 uppercase">候选目标 {i + 1}</span>
              <button onClick={() => removeElement(i)} className="text-[9px] text-muted-foreground hover:text-red-400">删除</button>
            </div>
            
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div
                  className={`w-7 h-3.5 rounded-full transition-colors relative flex-shrink-0 ${el.useSelector ? 'bg-orange-500' : 'bg-muted'}`}
                  onClick={() => updateElement(i, { useSelector: !el.useSelector })}
                >
                  <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow-sm transition-transform ${el.useSelector ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
                <span className="text-[10px] text-muted-foreground">选择器模式</span>
              </label>

              {el.useSelector ? (
                <input
                  value={el.selector || ''}
                  onChange={e => updateElement(i, { selector: e.target.value })}
                  placeholder="input[type='file'] 或 //button..."
                  className="w-full bg-background border border-orange-400/20 rounded-lg px-2 py-1 text-[10px] font-mono outline-none focus:border-orange-400"
                />
              ) : (
                <input
                  value={el.text || ''}
                  onChange={e => updateElement(i, { text: e.target.value })}
                  placeholder="按钮文字，如：Create image"
                  className="w-full bg-background border border-border rounded-lg px-2 py-1 text-[10px] outline-none focus:border-primary"
                />
              )}
            </div>
          </div>
        ))}
        <button
          onClick={addElement}
          className="w-full py-2 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-[10px] text-muted-foreground hover:bg-muted hover:text-primary transition-all"
        >
          <span>+</span>
          <span>添加候选目标</span>
        </button>
      </div>
    );
  }
  
  // 将数据库中已有的参数名与该类型节点最新的所有的默认参数名进行全集并合，以此确保老节点在引入新特性时依然能显示在面板上
  const defaultKeys = Object.keys(catalog?.defaultParams ?? {});
  const currentKeys = Object.keys(params);
  const displayKeys = Array.from(new Set([...currentKeys, ...defaultKeys]));

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
      {displayKeys.map((k) => {
        const v = params[k] ?? catalog?.defaultParams?.[k] ?? '';
        const meta = catalog?.paramMeta[k];
        const isSelector = meta?.type === 'selector' || k.toLowerCase().includes('selector');
        const isTemplate = meta?.type === 'template';
        const isSelect = meta?.type === 'select' && Array.isArray(meta.options) && meta.options.length > 0;
        const isHotkey = meta?.type === 'hotkey';
        // 当 meta.type 是 boolean，或者当前值就是 boolean 时，渲染为开关
        const isBoolean = meta?.type === 'boolean' || typeof v === 'boolean';
        const isElements = meta?.type === 'elements';
        return (
          <div key={k} className="space-y-0.5">
            <div className="flex items-center gap-1">
              <span className={`text-[10px] font-semibold ${isElements ? 'text-primary' : isSelector ? 'text-orange-400' : isTemplate ? 'text-purple-400' : 'text-muted-foreground'}`}>
                {meta?.label ?? k}
              </span>
              {!compact && meta && (
                <span className="text-[9px] text-muted-foreground font-mono">({k})</span>
              )}
              {meta && <ParamTooltip text={`${meta.desc}${meta.example ? `\n\n示例：${meta.example}` : ''}`} />}
              {meta?.required && <span className="text-[9px] text-red-400">*</span>}
              <div className="flex-1" />
              {/* boolean 类型不显示删除按钮，避免丢失默认配置 */}
              {!isBoolean && (
                <button onClick={() => removeKey(k)} className="text-[9px] text-muted-foreground hover:text-red-400 transition-colors">✕</button>
              )}
            </div>
            {isElements ? (
              <ElementsEditor
                value={v as any}
                onChange={next => onChange({ ...params, [k]: next })}
              />
            ) : isBoolean ? (
              /* boolean 参数渲染为 Toggle 开关 */
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div
                  className={`w-8 h-4 rounded-full transition-colors relative flex-shrink-0 ${v ? 'bg-primary' : 'bg-muted'}`}
                  onClick={() => onChange({ ...params, [k]: !v })}
                >
                  <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${v ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
                <span className={`text-[10px] font-medium ${v ? 'text-primary' : 'text-muted-foreground'}`}>
                  {v ? '已开启' : '已关闭'}
                </span>
              </label>
            ) : isSelect ? (
              <select
                value={displayVal(v)}
                onChange={e => setVal(k, e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-[11px] outline-none focus:border-primary transition-colors"
              >
                {meta.options?.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : isHotkey ? (
              <input
                value={displayVal(v)}
                readOnly
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text/plain').trim();
                  if (text) setVal(k, text);
                }}
                onKeyDown={(e) => {
                  // Esc=auto, Backspace/Delete=清空
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setVal(k, 'auto');
                    return;
                  }
                  if (e.key === 'Backspace' || e.key === 'Delete') {
                    e.preventDefault();
                    setVal(k, '');
                    return;
                  }

                  // 纯修饰键不录入
                  if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return;

                  e.preventDefault();

                  const parts: string[] = [];
                  const hasCtrl = e.ctrlKey;
                  const hasMeta = e.metaKey;

                  // 录入时优先归一化为跨平台写法：ControlOrMeta
                  // - mac 按 ⌘V 会记录成 ControlOrMeta+V
                  // - Windows/Linux 按 Ctrl+V 也会记录成 ControlOrMeta+V
                  // 这样同一份工作流在不同系统更稳。
                  const useControlOrMeta = (hasCtrl || hasMeta) && !(hasCtrl && hasMeta);
                  if (useControlOrMeta) {
                    parts.push('ControlOrMeta');
                  } else {
                    if (hasCtrl) parts.push('Control');
                    if (hasMeta) parts.push('Meta');
                  }

                  if (e.altKey) parts.push('Alt');
                  if (e.shiftKey) parts.push('Shift');

                  let main = e.key;
                  if (main === ' ') main = 'Space';
                  if (main.length === 1) main = main.toUpperCase();

                  parts.push(main);
                  setVal(k, parts.join('+'));
                }}
                className={`w-full bg-background border rounded-lg px-2.5 py-1.5 text-[11px] font-mono outline-none focus:border-primary transition-colors ${
                  'border-primary/40 focus:border-primary'
                }`}
                placeholder={meta?.example ?? '点击后按下组合键录入（Esc=auto）'}
              />
            ) : (
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
            )}
          </div>
        );
      })}
      <button onClick={addKey} className="text-[10px] text-primary hover:underline">+ 添加参数</button>
    </div>
  );
}

function MaterialNodeParamEditor({
  params,
  onChange,
  materials,
}: {
  params: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
  materials: MaterialItem[];
}) {
  const [showPicker, setShowPicker] = useState(false);
  const materialId = String(params.materialId ?? '');
  const selectedMaterial = materials.find(m => m.id === materialId) ?? null;

  function setVal(key: 'outputVideoVar' | 'outputTitleVar', value: string) {
    onChange({ ...params, [key]: value });
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center gap-1 mb-1.5">
          <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">选择素材</h3>
          <ParamTooltip text="素材节点执行时会从素材库读取所选素材，并把视频地址和标题写入后续节点可用的模板变量。" />
        </div>
        <button
          onClick={() => setShowPicker(v => !v)}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-[11px] transition-colors ${
            selectedMaterial
              ? 'border-primary/50 bg-primary/5 text-primary'
              : 'border-dashed border-border bg-muted/20 text-muted-foreground hover:border-primary/40'
          }`}
        >
          <span className="truncate">
            {selectedMaterial
              ? `📦 ${selectedMaterial.title || '（无标题）'}`
              : `📦 选择素材${materials.length > 0 ? ` (${materials.length})` : ''}`}
          </span>
          <span className="shrink-0 ml-1">{showPicker ? '▲' : '▼'}</span>
        </button>
        {showPicker && (
          <div className="mt-1 border border-border rounded-xl overflow-hidden bg-card max-h-56 overflow-y-auto shadow-lg">
            {materials.length === 0 ? (
              <p className="text-center text-[10px] text-muted-foreground py-4">素材库为空</p>
            ) : (
              materials.map(m => (
                <button
                  key={m.id}
                  onClick={() => {
                    onChange({ ...params, materialId: m.id });
                    setShowPicker(false);
                  }}
                  className={`w-full text-left px-3 py-2.5 hover:bg-muted flex items-center gap-2 text-[11px] transition-colors ${
                    selectedMaterial?.id === m.id ? 'bg-primary/10' : ''
                  }`}
                >
                  <span>▶</span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{m.title || '（无标题）'}</p>
                    <p className="truncate text-muted-foreground text-[9px]">{m.ossUrl}</p>
                  </div>
                  {selectedMaterial?.id === m.id && <span className="text-primary ml-auto shrink-0">✓</span>}
                </button>
              ))
            )}
          </div>
        )}
        {selectedMaterial && (
          <div className="mt-2 rounded-lg border border-border bg-muted/20 p-2 space-y-1">
            <p className="text-[10px] font-medium text-foreground">{selectedMaterial.title || '（无标题）'}</p>
            <p className="text-[10px] font-mono text-muted-foreground break-all">{selectedMaterial.ossUrl}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-0.5">
          <label className="text-[10px] text-muted-foreground">视频输出变量</label>
          <input
            value={String(params.outputVideoVar ?? 'videoUrl')}
            onChange={e => setVal('outputVideoVar', e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-[11px] font-mono outline-none focus:border-primary"
            placeholder="videoUrl"
          />
        </div>
        <div className="space-y-0.5">
          <label className="text-[10px] text-muted-foreground">标题输出变量</label>
          <input
            value={String(params.outputTitleVar ?? 'title')}
            onChange={e => setVal('outputTitleVar', e.target.value)}
            className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-[11px] font-mono outline-none focus:border-primary"
            placeholder="title"
          />
        </div>
      </div>

      <div className="bg-primary/5 border border-primary/20 rounded-lg px-2.5 py-2">
        <p className="text-[9px] text-primary font-semibold mb-1">执行后会输出</p>
        <div className="space-y-0.5 text-[9px]">
          <div>
            <span className="font-mono text-primary">{`{{${String(params.outputVideoVar ?? 'videoUrl')}}}`}</span>
            <span className="text-muted-foreground ml-1">视频 OSS 地址</span>
          </div>
          <div>
            <span className="font-mono text-primary">{`{{${String(params.outputTitleVar ?? 'title')}}}`}</span>
            <span className="text-muted-foreground ml-1">素材标题</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function parseReferenceImageUrls(raw: unknown): string[] {
  const text = String(raw ?? '').trim();
  if (!text) return [];

  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map(item => String(item).trim()).filter(Boolean);
      }
    } catch {
      // fallback below
    }
  }

  return text
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function stringifyReferenceImageUrls(urls: string[]): string {
  if (urls.length === 0) return '';
  return JSON.stringify(urls, null, 2);
}

function flattenContentImageAssets(posts: Array<Record<string, unknown>>): ContentImageAsset[] {
  const assets: ContentImageAsset[] = [];

  for (const post of posts) {
    const postId = String(post.id ?? '');
    const title = String(post.title ?? '未命名作品');
    const noteId = post.note_id ? String(post.note_id) : undefined;
    const images = Array.isArray(post.images) ? post.images : [];

    images.forEach((image, index) => {
      if (!image || typeof image !== 'object') return;
      const row = image as Record<string, unknown>;
      const url = String(row.oss_url ?? row.original_url ?? '').trim();
      if (!url) return;
      assets.push({
        id: String(row.id ?? `${postId}-${index}`),
        url,
        title,
        postId,
        noteId,
        sourceLabel: `${title}${images.length > 1 ? ` · 图 ${index + 1}` : ''}`,
      });
    });
  }

  return assets;
}

function VertexNodeParamEditor({
  params,
  onChange,
}: {
  params: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
}) {
  const vertexParams = params as unknown as VertexAIParams;
  const capability = (vertexParams.capability ?? 'image_generate') as VertexAIParams['capability'];
  const capabilityMeta = VERTEX_CAPABILITY_META[capability];
  const availableModels = getVertexModelsForCapability(capability);
  const currentModel = String(vertexParams.model ?? capabilityMeta.defaultModel);
  const currentModelMeta = getVertexModelMeta(currentModel) ?? availableModels[0];
  const selectedReferenceUrls = parseReferenceImageUrls(vertexParams.referenceImageUrls);

  const [showReferencePicker, setShowReferencePicker] = useState(false);
  const [assetQuery, setAssetQuery] = useState('');
  const [contentAssets, setContentAssets] = useState<ContentImageAsset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [assetsError, setAssetsError] = useState('');

  useEffect(() => {
    if (capability !== 'image_edit') return;
    if (contentAssets.length > 0) return;
    let alive = true;

    async function loadAssets() {
      setLoadingAssets(true);
      setAssetsError('');
      try {
        const res = await fetch('/api/content/list/xhs?limit=100');
        const data = await res.json() as { success?: boolean; data?: Array<Record<string, unknown>>; error?: string };
        if (!alive) return;
        if (!res.ok || !data.success || !Array.isArray(data.data)) {
          throw new Error(data.error || '加载作品素材失败');
        }
        setContentAssets(flattenContentImageAssets(data.data));
      } catch (error) {
        if (!alive) return;
        setAssetsError(error instanceof Error ? error.message : '加载作品素材失败');
      } finally {
        if (alive) setLoadingAssets(false);
      }
    }

    void loadAssets();
    return () => { alive = false; };
  }, [capability, contentAssets.length]);

  useEffect(() => {
    const patch: Partial<VertexAIParams> = {};
    if (!String(vertexParams.model ?? '').trim() || !availableModels.some(item => item.id === currentModel)) {
      patch.model = capabilityMeta.defaultModel;
    }
    if (!String(vertexParams.prompt ?? '').trim()) {
      patch.prompt = getDefaultVertexPrompt(capability);
    }
    if (!String(vertexParams.outputVar ?? '').trim()) {
      patch.outputVar = capabilityMeta.defaultOutputVar;
    }
    if (!String(vertexParams.outputListVar ?? '').trim()) {
      patch.outputListVar = capabilityMeta.defaultOutputListVar;
    }
    if (Object.keys(patch).length > 0) {
      onChange({ ...params, ...patch });
    }
  }, [
    availableModels,
    capability,
    capabilityMeta.defaultModel,
    capabilityMeta.defaultOutputListVar,
    capabilityMeta.defaultOutputVar,
    currentModel,
    onChange,
    params,
    vertexParams.model,
    vertexParams.outputListVar,
    vertexParams.outputVar,
    vertexParams.prompt,
  ]);

  function patchParams(patch: Partial<VertexAIParams>) {
    onChange({ ...params, ...patch });
  }

  function updateCapability(nextCapability: VertexAIParams['capability']) {
    if (nextCapability === capability) return;

    const nextMeta = VERTEX_CAPABILITY_META[nextCapability];
    const nextModels = getVertexModelsForCapability(nextCapability);
    const outputVar = String(vertexParams.outputVar ?? '');
    const outputListVar = String(vertexParams.outputListVar ?? '');
    const prompt = String(vertexParams.prompt ?? '');
    const currentPromptIsBuiltIn = !prompt || isBuiltInVertexPrompt(prompt);

    patchParams({
      capability: nextCapability,
      model: nextModels.some(item => item.id === currentModel) ? currentModel : nextMeta.defaultModel,
      prompt: currentPromptIsBuiltIn ? getDefaultVertexPrompt(nextCapability) : prompt,
      outputVar: !outputVar || ['imageUrl', 'videoUrl'].includes(outputVar) ? nextMeta.defaultOutputVar : outputVar,
      outputListVar: !outputListVar || ['imageUrls', 'videoUrls'].includes(outputListVar) ? nextMeta.defaultOutputListVar : outputListVar,
    });
  }

  function updatePromptFromTemplate() {
    patchParams({ prompt: getDefaultVertexPrompt(capability) });
  }

  function resetCapabilityDefaults() {
    patchParams({
      model: capabilityMeta.defaultModel,
      prompt: getDefaultVertexPrompt(capability),
      outputVar: capabilityMeta.defaultOutputVar,
      outputListVar: capabilityMeta.defaultOutputListVar,
      ...(capability === 'video_generate'
        ? { durationSeconds: 8, generateAudio: true }
        : { count: 1, aspectRatio: '1:1', personGeneration: 'allow_adult' }),
    });
  }

  function toggleReferenceUrl(url: string) {
    const next = selectedReferenceUrls.includes(url)
      ? selectedReferenceUrls.filter(item => item !== url)
      : [...selectedReferenceUrls, url];
    patchParams({ referenceImageUrls: stringifyReferenceImageUrls(next) });
  }

  const filteredAssets = contentAssets.filter(asset => {
    if (!assetQuery.trim()) return true;
    const q = assetQuery.trim().toLowerCase();
    return asset.title.toLowerCase().includes(q)
      || asset.sourceLabel.toLowerCase().includes(q)
      || asset.noteId?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold text-primary">{capabilityMeta.label}</p>
            <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">{capabilityMeta.desc}</p>
          </div>
          <span className="text-[9px] rounded-full bg-background/80 border border-primary/20 px-2 py-0.5 text-primary">
            高级节点
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(Object.entries(VERTEX_CAPABILITY_META) as Array<[VertexAIParams['capability'], typeof capabilityMeta]>).map(([key, meta]) => (
            <button
              key={key}
              onClick={() => updateCapability(key)}
              className={`rounded-xl border px-2.5 py-2 text-left transition-colors ${
                capability === key
                  ? 'border-primary bg-primary text-white'
                  : 'border-border bg-background hover:border-primary/40'
              }`}
            >
              <p className="text-[11px] font-semibold">{meta.label}</p>
              <p className={`text-[9px] mt-1 leading-relaxed ${capability === key ? 'text-white/80' : 'text-muted-foreground'}`}>
                {meta.desc}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-semibold text-muted-foreground">生成提示词</span>
          <span className="text-[9px] text-muted-foreground font-mono">(prompt)</span>
          <ParamTooltip text="每种能力都内置了不同的提示词骨架。先用默认模板起稿，再按你的业务加细节会更稳。" />
          <div className="flex-1" />
          <button
            onClick={updatePromptFromTemplate}
            className="rounded-lg border border-primary/20 bg-primary/5 px-2 py-1 text-[10px] text-primary hover:bg-primary/10"
          >
            刷新建议
          </button>
          <button
            onClick={resetCapabilityDefaults}
            className="rounded-lg border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            恢复默认
          </button>
        </div>
        <textarea
          value={String(vertexParams.prompt ?? '')}
          onChange={e => patchParams({ prompt: e.target.value })}
          rows={5}
          className="w-full resize-y bg-background border border-purple-400/40 rounded-xl px-3 py-2 text-[11px] leading-relaxed outline-none focus:border-purple-400"
          placeholder={getDefaultVertexPrompt(capability)}
        />
        <div className="flex flex-wrap gap-1.5">
          {capabilityMeta.promptScaffold.map(item => (
            <span key={item} className="rounded-full bg-muted px-2 py-0.5 text-[9px] text-muted-foreground">
              {item}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-3 items-start">
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-semibold text-muted-foreground">模型</span>
            <span className="text-[9px] text-muted-foreground font-mono">(model)</span>
            <ParamTooltip text="模型列表会随能力切换自动过滤。文生图不会再看到 Veo，生视频也不会再看到 Imagen。" />
          </div>
          <select
            value={availableModels.some(item => item.id === currentModel) ? currentModel : capabilityMeta.defaultModel}
            onChange={e => patchParams({ model: e.target.value })}
            className="w-full bg-background border border-border rounded-xl px-3 py-2 text-[11px] outline-none focus:border-primary"
          >
            {availableModels.map(model => (
              <option key={model.id} value={model.id}>
                {model.label} · {model.summary}
              </option>
            ))}
          </select>
        </div>
        {currentModelMeta && (
          <div className="rounded-xl border border-border bg-card p-3 space-y-2">
            <div>
              <p className="text-[11px] font-semibold text-foreground">{currentModelMeta.label}</p>
              <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">{currentModelMeta.summary}</p>
            </div>
            <div className="grid grid-cols-3 gap-1 text-[9px]">
              <div className="rounded-lg bg-muted/40 px-2 py-1">
                <p className="text-muted-foreground">成本档位</p>
                <p className="font-semibold text-foreground">{currentModelMeta.costTier}</p>
              </div>
              <div className="rounded-lg bg-muted/40 px-2 py-1">
                <p className="text-muted-foreground">速度</p>
                <p className="font-semibold text-foreground">{currentModelMeta.speed}</p>
              </div>
              <div className="rounded-lg bg-muted/40 px-2 py-1">
                <p className="text-muted-foreground">质量</p>
                <p className="font-semibold text-foreground">{currentModelMeta.quality}</p>
              </div>
            </div>
            <div className="space-y-1">
              {currentModelMeta.strengths.map(item => (
                <p key={item} className="text-[9px] text-muted-foreground">• {item}</p>
              ))}
            </div>
            {currentModelMeta.note && (
              <p className="text-[9px] text-amber-500">{currentModelMeta.note}</p>
            )}
          </div>
        )}
      </div>

      {capability !== 'video_generate' && (
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">生成数量</label>
            <input
              type="number"
              min={1}
              max={4}
              value={String(vertexParams.count ?? 1)}
              onChange={e => patchParams({ count: Math.min(4, Math.max(1, Number(e.target.value) || 1)) })}
              className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-[11px] outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">长宽比</label>
            <select
              value={String(vertexParams.aspectRatio ?? '1:1')}
              onChange={e => patchParams({ aspectRatio: e.target.value })}
              className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-[11px] outline-none focus:border-primary"
            >
              {['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', '4:5', '5:4', '21:9'].map(ratio => (
                <option key={ratio} value={ratio}>{ratio}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">人物生成策略</label>
            <select
              value={String(vertexParams.personGeneration ?? 'allow_adult')}
              onChange={e => patchParams({ personGeneration: e.target.value })}
              className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-[11px] outline-none focus:border-primary"
            >
              {[
                { label: 'allow_adult', value: 'allow_adult' },
                { label: 'allow_all', value: 'allow_all' },
                { label: 'dont_allow', value: 'dont_allow' },
              ].map(item => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {capability === 'image_edit' && (
        <div className="space-y-2 rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">参考图素材</p>
            <ParamTooltip text="这里优先从作品素材库里选图，内部会自动写入 referenceImageUrls。你也可以在下面直接编辑原始 URL 列表。" />
            <div className="flex-1" />
            <button
              onClick={() => setShowReferencePicker(v => !v)}
              className="rounded-lg border border-primary/20 bg-primary/5 px-2 py-1 text-[10px] text-primary hover:bg-primary/10"
            >
              {showReferencePicker ? '收起素材库' : `选择参考图${selectedReferenceUrls.length ? ` (${selectedReferenceUrls.length})` : ''}`}
            </button>
          </div>

          {showReferencePicker && (
            <div className="space-y-2 rounded-xl border border-border bg-background p-2">
              <div className="flex items-center gap-2">
                <input
                  value={assetQuery}
                  onChange={e => setAssetQuery(e.target.value)}
                  placeholder="搜索标题 / note_id"
                  className="flex-1 bg-background border border-border rounded-lg px-2.5 py-1.5 text-[11px] outline-none focus:border-primary"
                />
                <span className="text-[10px] text-muted-foreground">{filteredAssets.length} 张</span>
              </div>

              {loadingAssets && <p className="text-[10px] text-muted-foreground">加载作品素材中...</p>}
              {!loadingAssets && assetsError && <p className="text-[10px] text-red-400">{assetsError}</p>}

              {!loadingAssets && !assetsError && (
                <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                  {filteredAssets.length === 0 && (
                    <p className="text-[10px] text-muted-foreground col-span-2 text-center py-8">没有匹配到可用图片</p>
                  )}
                  {filteredAssets.map(asset => {
                    const selected = selectedReferenceUrls.includes(asset.url);
                    return (
                      <button
                        key={`${asset.postId}-${asset.id}`}
                        onClick={() => toggleReferenceUrl(asset.url)}
                        className={`rounded-xl border overflow-hidden text-left transition-colors ${
                          selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                        }`}
                      >
                        <div className="aspect-[4/3] bg-muted/30">
                          <img src={asset.url} alt={asset.title} className="w-full h-full object-cover" />
                        </div>
                        <div className="p-2 space-y-1">
                          <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-medium text-foreground truncate">{asset.sourceLabel}</p>
                              <p className="text-[9px] text-muted-foreground font-mono truncate">#{asset.postId.slice(-6)}</p>
                            </div>
                            {selected && <span className="text-[10px] text-primary">✓</span>}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {selectedReferenceUrls.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {selectedReferenceUrls.map(url => (
                <div key={url} className="rounded-xl border border-border overflow-hidden bg-background">
                  <div className="aspect-[4/3] bg-muted/30">
                    <img src={url} alt="reference" className="w-full h-full object-cover" />
                  </div>
                  <div className="p-2 flex items-start gap-2">
                    <p className="flex-1 text-[9px] text-muted-foreground font-mono truncate">{url}</p>
                    <button
                      onClick={() => toggleReferenceUrl(url)}
                      className="text-[9px] text-red-400 hover:underline"
                    >
                      移除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">原始参考图 URL 列表</label>
            <textarea
              value={String(vertexParams.referenceImageUrls ?? '')}
              onChange={e => patchParams({ referenceImageUrls: e.target.value })}
              rows={4}
              className="w-full resize-y bg-background border border-border rounded-xl px-3 py-2 text-[11px] font-mono outline-none focus:border-primary"
              placeholder='["https://.../1.png", "https://.../2.png"]'
            />
          </div>
        </div>
      )}

      {capability === 'video_generate' && (
        <div className="rounded-xl border border-border bg-card p-3 space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">视频参数</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">视频时长（秒）</label>
              <select
                value={String(vertexParams.durationSeconds ?? 8)}
                onChange={e => patchParams({ durationSeconds: Number(e.target.value) })}
                className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-[11px] outline-none focus:border-primary"
              >
                {[4, 5, 6, 7, 8].map(value => (
                  <option key={value} value={value}>{value}s</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">生成音频</label>
              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <div
                  className={`w-8 h-4 rounded-full transition-colors relative flex-shrink-0 ${vertexParams.generateAudio !== false ? 'bg-primary' : 'bg-muted'}`}
                  onClick={() => patchParams({ generateAudio: !(vertexParams.generateAudio !== false) })}
                >
                  <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${vertexParams.generateAudio !== false ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
                <span className={`text-[10px] font-medium ${vertexParams.generateAudio !== false ? 'text-primary' : 'text-muted-foreground'}`}>
                  {vertexParams.generateAudio !== false ? '已开启' : '已关闭'}
                </span>
              </label>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">源图 GCS URI</label>
            <input
              value={String(vertexParams.sourceImageGcsUri ?? '')}
              onChange={e => patchParams({ sourceImageGcsUri: e.target.value })}
              className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-[11px] font-mono outline-none focus:border-primary"
              placeholder="gs://bucket/path/to/frame.png"
            />
            <p className="text-[9px] text-muted-foreground">做图生视频时填写。纯文生视频可以留空。</p>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-3 space-y-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">输出与存储</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">首个结果变量</label>
            <input
              value={String(vertexParams.outputVar ?? capabilityMeta.defaultOutputVar)}
              onChange={e => patchParams({ outputVar: e.target.value })}
              className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-[11px] font-mono outline-none focus:border-primary"
              placeholder={capabilityMeta.defaultOutputVar}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">结果数组变量</label>
            <input
              value={String(vertexParams.outputListVar ?? capabilityMeta.defaultOutputListVar)}
              onChange={e => patchParams({ outputListVar: e.target.value })}
              className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-[11px] font-mono outline-none focus:border-primary"
              placeholder={capabilityMeta.defaultOutputListVar}
            />
          </div>
        </div>
        <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2 items-start">
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">上传到 OSS</label>
            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <div
                className={`w-8 h-4 rounded-full transition-colors relative flex-shrink-0 ${vertexParams.uploadToOSS !== false ? 'bg-primary' : 'bg-muted'}`}
                onClick={() => patchParams({ uploadToOSS: !(vertexParams.uploadToOSS !== false) })}
              >
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${vertexParams.uploadToOSS !== false ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </div>
              <span className={`text-[10px] font-medium ${vertexParams.uploadToOSS !== false ? 'text-primary' : 'text-muted-foreground'}`}>
                {vertexParams.uploadToOSS !== false ? '已开启' : '已关闭'}
              </span>
            </label>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground">OSS 存储路径</label>
            <input
              value={String(vertexParams.ossPath ?? 'vertex-assets/{{timestamp}}-{{index}}')}
              onChange={e => patchParams({ ossPath: e.target.value })}
              className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-[11px] font-mono outline-none focus:border-primary"
              placeholder="vertex-assets/{{timestamp}}-{{index}}"
            />
          </div>
        </div>
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-2 text-[9px] space-y-0.5">
          <p className="font-semibold text-primary">当前输出</p>
          <p><span className="font-mono text-primary">{`{{${String(vertexParams.outputVar ?? capabilityMeta.defaultOutputVar)}}}`}</span><span className="ml-1 text-muted-foreground">首个结果地址</span></p>
          <p><span className="font-mono text-primary">{`{{${String(vertexParams.outputListVar ?? capabilityMeta.defaultOutputListVar)}}}`}</span><span className="ml-1 text-muted-foreground">全部结果 JSON 数组</span></p>
        </div>
      </div>
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
          <div className="space-y-0.5">
            <label className="text-[10px] text-muted-foreground">延迟判断 (秒)</label>
            <input
              type="number"
              min={0}
              value={wa.delaySeconds ?? 0}
              onChange={e => set({ delaySeconds: Math.max(0, Number(e.target.value) || 0) })}
              className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-[11px] outline-none focus:border-primary"
            />
          </div>
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
  materials,
  humanOptions,
  onVarsChange,
  onStepStatusChange,
}: {
  node: NodeDef;
  idx: number;
  total: number;
  onChange: (patch: Partial<NodeDef>) => void;
  onClose: () => void;
  sessionId: string | null;
  vars: Record<string, string>;
  materials: MaterialItem[];
  humanOptions: HumanOptions;
  onVarsChange?: (vars: Record<string, string>) => void;
  onStepStatusChange?: (idx: number, status: 'success' | 'error' | 'running') => void;
}) {
  const catalog = getCatalogItem(node.type);
  const referencedVars = useMemo(() => getNodeReferencedVars(node), [node]);
  const resolvedParams = useMemo(
    () => resolveParams({ ...(node.params ?? {}) }, vars),
    [node, vars]
  );
  const resolvedNodeUrl = useMemo(() => {
    if (!node.url) return '';
    return String(resolveParams({ url: node.url }, vars).url || '').trim();
  }, [node, vars]);
  const adsPreview = node.type === 'navigate'
    ? (resolvedParams as Partial<NavigateParams>)
    : null;
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
        // 通过 session 执行（接力浏览器状态），并带上当前面板的完整节点配置以实现实时覆盖
        res = await fetch(`/api/workflow/session/${sessionId}/step`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stepIndex: idx, node, vars }),
        });
      } else {
        // 无 session：用 node-debug 开临时页面执行
        res = await fetch('/api/workflow/node-debug', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ node, vars, humanOptions }),
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
              const d = JSON.parse(evt.payload) as {
                success?: boolean;
                vars?: Record<string, string>;
                result?: { success: boolean };
              };
              if (d.vars) onVarsChange?.(d.vars);
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
          {node.type !== 'material' && node.type !== 'navigate' && (
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
          )}

          {/* 节点参数 */}
          <section>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">执行预览</h3>
            <div className="rounded-xl border border-border bg-card p-3 space-y-3">
              <div className="flex flex-wrap gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[10px] ${sessionId ? 'bg-emerald-500/10 text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                  {sessionId ? 'session 接力' : '独立执行'}
                </span>
                {node.type === 'navigate' && adsPreview?.useAdsPower && (
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] text-primary">
                    Ads 实例 {adsPreview.adsProfileId || '未解析'}
                  </span>
                )}
                {resolvedNodeUrl && (
                  <span className="rounded-full bg-sky-500/10 px-2.5 py-1 text-[10px] text-sky-400">
                    URL 已解析
                  </span>
                )}
              </div>

              {referencedVars.length > 0 ? (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">变量引用</p>
                  <div className="grid gap-2 md:grid-cols-2">
                    {referencedVars.map((key) => {
                      const value = vars[key] ?? '';
                      const missing = !value.trim();
                      return (
                        <div key={key} className={`rounded-lg border px-2.5 py-2 ${missing ? 'border-amber-500/30 bg-amber-500/5' : 'border-border bg-background'}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-medium text-foreground">{key}</span>
                            <span className={`text-[10px] ${missing ? 'text-amber-400' : 'text-muted-foreground'}`}>
                              {missing ? '缺失' : '已解析'}
                            </span>
                          </div>
                          <div className="mt-1 break-all rounded bg-muted/30 px-2 py-1 text-[10px] font-mono text-foreground/80">
                            {value || '—'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
                  本节点当前没有引用模板变量。
                </div>
              )}

              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">实际执行参数</p>
                <div className="rounded-lg bg-background px-3 py-2 text-[10px] font-mono text-foreground/80 overflow-auto max-h-56 whitespace-pre-wrap break-all">
                  {displayPreviewValue(
                    resolvedNodeUrl
                      ? { url: resolvedNodeUrl, ...(resolvedParams as Record<string, unknown>) }
                      : resolvedParams
                  )}
                </div>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">节点参数</h3>
            {node.type === 'material' ? (
              <MaterialNodeParamEditor
                params={node.params as Record<string, unknown>}
                onChange={p => onChange({ params: p })}
                materials={materials}
              />
            ) : node.type === 'vertex_ai' ? (
              <VertexNodeParamEditor
                params={node.params as Record<string, unknown>}
                onChange={p => onChange({ params: p })}
              />
            ) : (
              <ParamEditor
                params={node.params as Record<string, unknown>}
                onChange={p => onChange({ params: p })}
                nodeType={node.type}
                showVarsHint={node.type === 'text_input' || node.type === 'file_upload'}
              />
            )}
          </section>

          {/* 后置等待 */}
          {node.type !== 'material' && (
          <section>
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">后置等待</h3>
            <WaitAfterEditor
              value={node.waitAfter}
              onChange={wa => onChange({ waitAfter: wa })}
            />
          </section>
          )}

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
  const MAX_AUTO_RETRY = 2;
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
  const [humanOptions, setHumanOptions] = useState<HumanOptions>(() => {
    if (typeof window === 'undefined') return { ...DEFAULT_HUMAN_OPTIONS };
    try {
      const saved = window.localStorage.getItem('workflow.humanOptions');
      if (!saved) return { ...DEFAULT_HUMAN_OPTIONS };
      const parsed = JSON.parse(saved) as Partial<HumanOptions>;
      return { ...DEFAULT_HUMAN_OPTIONS, ...parsed };
    } catch {
      return { ...DEFAULT_HUMAN_OPTIONS };
    }
  });
  const [keepBrowserPage, setKeepBrowserPage] = useState(true);
  const [autoRetryOnFailure, setAutoRetryOnFailure] = useState(true);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [isDebugScreenshotFullscreen, setIsDebugScreenshotFullscreen] = useState(false);

  // ── 素材 ───────────────────────────────────────────────────────────────────
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [ctx, setCtx] = useState<DebugCtx>({
    videoUrl: initialContext?.videoUrl ?? '',
    title:    initialContext?.title ?? '',
    tags:     initialContext?.tags ?? '',
    clientId: initialContext?.clientId ?? '',
  });
  const [runtimeVars, setRuntimeVars] = useState<Record<string, string>>(() => {
    const seeded: Record<string, string> = {};
    const contextMap = (initialContext ?? {}) as Record<string, string>;
    const useDefaultAdsBrowserInstance = shouldSeedDefaultAdsBrowserInstance(initialWorkflow);
    for (const key of initialWorkflow.vars ?? []) {
      const value = contextMap[key];
      if (typeof value === 'string' && value.trim()) {
        seeded[key] = value;
        continue;
      }
      if (key === 'browserInstanceId' && useDefaultAdsBrowserInstance) {
        seeded[key] = DEFAULT_ADS_BROWSER_INSTANCE_ID;
        continue;
      }
      if (key === 'goal') {
        seeded[key] = DEFAULT_TOPIC_GOAL;
        continue;
      }
      if (key === 'count') {
        seeded[key] = '3';
        continue;
      }
      if (key === 'sources') {
        seeded[key] = DEFAULT_TOPIC_SOURCES;
        continue;
      }
      if (key === 'sourceImageUrl') {
        seeded[key] = DEFAULT_SOURCE_IMAGE_URL;
        continue;
      }
      if (key === 'sourceImageUrls') {
        seeded[key] = DEFAULT_SOURCE_IMAGE_URLS;
      }
    }
    return seeded;
  });
  const runtimeJsonStorageKey = useMemo(() => `workflow.runtimeJson.default.${initialWorkflow.id}`, [initialWorkflow.id]);
  const [runtimeJsonDraft, setRuntimeJsonDraft] = useState('');
  const [runtimeJsonError, setRuntimeJsonError] = useState<string | null>(null);
  const [, setRuntimeJsonDirty] = useState(false);
  const workflowVarKeys = useMemo(() => initialWorkflow.vars ?? [], [initialWorkflow.vars]);
  const adsWorkflowEnabled = useMemo(() => hasAdsNavigateNode(nodes), [nodes]);
  const runtimeContextKeys = useMemo(() => {
    const ordered = new Set<string>();
    workflowVarKeys.forEach((key) => ordered.add(key));
    Object.keys(runtimeVars).forEach((key) => ordered.add(key));
    STANDARD_CONTEXT_KEYS.forEach((key) => {
      if (ctx[key]) ordered.add(key);
    });
    return Array.from(ordered);
  }, [ctx, runtimeVars, workflowVarKeys]);

  const collectSessionVars = useCallback((): Record<string, string> => {
    const merged: Record<string, string> = { ...runtimeVars };
    if (ctx.videoUrl) merged.videoUrl = ctx.videoUrl;
    if (ctx.title) merged.title = ctx.title;
    if (ctx.tags) merged.tags = ctx.tags;
    if (ctx.clientId) merged.clientId = ctx.clientId;
    return Object.fromEntries(
      Object.entries(merged).filter(([, v]) => typeof v === 'string' && v.trim().length > 0)
    );
  }, [ctx, runtimeVars]);
  const currentSessionVars = useMemo(() => collectSessionVars(), [collectSessionVars]);

  const logEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  useEffect(() => {
    fetch('/api/materials').then(r => r.json()).then(d => { if (Array.isArray(d)) setMaterials(d); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem('workflow.keepBrowserPage');
    if (saved === '0') setKeepBrowserPage(false);
    const retrySaved = window.localStorage.getItem('workflow.autoRetryOnFailure');
    if (retrySaved === '0') setAutoRetryOnFailure(false);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('workflow.keepBrowserPage', keepBrowserPage ? '1' : '0');
  }, [keepBrowserPage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('workflow.autoRetryOnFailure', autoRetryOnFailure ? '1' : '0');
  }, [autoRetryOnFailure]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('workflow.humanOptions', JSON.stringify(humanOptions));
    } catch {
      // ignore
    }
  }, [humanOptions]);

  const appendLog = useCallback((text: string) => {
    setLogs(prev => [...prev, { ts: ts(), text }]);
  }, []);

  function setContextFieldValue(key: string, value: string) {
    if ((STANDARD_CONTEXT_KEYS as readonly string[]).includes(key)) {
      setCtx(prev => ({ ...prev, [key]: value }));
      return;
    }
    setRuntimeVars(prev => ({ ...prev, [key]: value }));
  }

  const applyExtractedRuntimeVars = useCallback((extracted: Record<string, unknown>) => {
    const nextCtx: DebugCtx = {
      videoUrl: '',
      title: '',
      tags: '',
      clientId: '',
    };
    const nextRuntimeVars: Record<string, string> = {};

    for (const [key, rawValue] of Object.entries(extracted)) {
      const value = normalizeJsonValueToString(rawValue).trim();
      if (STANDARD_CONTEXT_KEY_SET.has(key)) {
        nextCtx[key as keyof DebugCtx] = value;
        continue;
      }
      if (!value) continue;
      nextRuntimeVars[key] = value;
    }

    setCtx(nextCtx);
    setRuntimeVars(nextRuntimeVars);

    const mergedForPreview: Record<string, string> = { ...nextRuntimeVars };
    if (nextCtx.videoUrl) mergedForPreview.videoUrl = nextCtx.videoUrl;
    if (nextCtx.title) mergedForPreview.title = nextCtx.title;
    if (nextCtx.tags) mergedForPreview.tags = nextCtx.tags;
    if (nextCtx.clientId) mergedForPreview.clientId = nextCtx.clientId;
    return mergedForPreview;
  }, []);

  const loadRuntimeJsonDefault = useCallback(() => {
    const fallback = getBuiltInWorkflowDebugInput(initialWorkflow.id) ?? serializeRuntimeVarsAsJson(currentSessionVars);
    let next = fallback;
    if (typeof window !== 'undefined') {
      try {
        const saved = window.localStorage.getItem(runtimeJsonStorageKey);
        if (saved?.trim()) next = saved;
      } catch {
        // ignore
      }
    }

    setRuntimeJsonDraft(next);
    setRuntimeJsonDirty(false);
    setRuntimeJsonError(null);

    try {
      const parsed = next.trim() ? JSON.parse(next) : {};
      const extracted = extractRuntimeVarsFromJson(parsed);
      if (extracted) {
        applyExtractedRuntimeVars(extracted);
      }
    } catch {
      // ignore invalid saved draft and keep current vars
    }
  }, [applyExtractedRuntimeVars, currentSessionVars, initialWorkflow.id, runtimeJsonStorageKey]);

  useEffect(() => {
    const fallback = getBuiltInWorkflowDebugInput(initialWorkflow.id) ?? serializeRuntimeVarsAsJson(currentSessionVars);
    let next = fallback;
    if (typeof window !== 'undefined') {
      try {
        const saved = window.localStorage.getItem(runtimeJsonStorageKey);
        if (saved?.trim()) next = saved;
      } catch {
        // ignore
      }
    }

    setRuntimeJsonDraft(next);
    setRuntimeJsonDirty(false);
    setRuntimeJsonError(null);

    try {
      const parsed = next.trim() ? JSON.parse(next) : {};
      const extracted = extractRuntimeVarsFromJson(parsed);
      if (extracted) {
        applyExtractedRuntimeVars(extracted);
      }
    } catch {
      // ignore invalid saved draft and keep current vars
    }
    // 这里只在切换工作流时初始化默认入参，避免运行中修改字段后被 effect 回滚。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialWorkflow.id, runtimeJsonStorageKey]);

  const resetRuntimeJsonFromCurrent = useCallback(() => {
    setRuntimeJsonDraft(serializeRuntimeVarsAsJson(currentSessionVars));
    setRuntimeJsonDirty(false);
    setRuntimeJsonError(null);
  }, [currentSessionVars]);

  const saveRuntimeJsonAsDefault = useCallback(() => {
    try {
      const raw = runtimeJsonDraft.trim();
      const parsed = raw ? JSON.parse(raw) : {};
      const extracted = extractRuntimeVarsFromJson(parsed);
      if (!extracted) throw new Error('JSON 顶层必须是对象');
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(runtimeJsonStorageKey, JSON.stringify(parsed, null, 2));
      }
      setRuntimeJsonDraft(JSON.stringify(parsed, null, 2));
      setRuntimeJsonDirty(false);
      setRuntimeJsonError(null);
      appendLog('💾 已保存为该工作流的默认入参');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeJsonError(`默认入参保存失败：${message}`);
    }
  }, [appendLog, runtimeJsonDraft, runtimeJsonStorageKey]);

  const applyRuntimeJson = useCallback(() => {
    try {
      const raw = runtimeJsonDraft.trim();
      const parsed = raw ? JSON.parse(raw) : {};
      const extracted = extractRuntimeVarsFromJson(parsed);
      if (!extracted) throw new Error('JSON 顶层必须是对象');
      const mergedForPreview = applyExtractedRuntimeVars(extracted);

      setRuntimeJsonDraft(serializeRuntimeVarsAsJson(mergedForPreview));
      setRuntimeJsonDirty(false);
      setRuntimeJsonError(null);
      appendLog(`🧩 已应用 JSON 入参（${Object.keys(mergedForPreview).length} 个字段）`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeJsonError(`JSON 解析失败：${message}`);
    }
  }, [appendLog, applyExtractedRuntimeVars, runtimeJsonDraft]);

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
  async function executeSessionStep(
    activeSessionId: string,
    idx: number,
    options?: { skip?: boolean; manageRunning?: boolean; reset?: boolean }
  ) {
    const manageRunning = options?.manageRunning ?? true;
    if (manageRunning) setRunning(true);
    setCurrentStep(idx);
    setStepStatus(prev => { const n = [...prev]; n[idx] = 'running'; return n; });

    try {
      const base = options?.skip ? { skip: true, stepIndex: idx } : { stepIndex: idx };
      const requestBody = {
        ...base,
        ...(options?.reset ? { reset: true } : {}),
        // 同步最新 vars（允许用户在创建 session 后再改运行时变量）
        vars: collectSessionVars(),
      };
      const res = await fetch(`/api/workflow/session/${activeSessionId}/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      if (!res.body) throw new Error('No body');

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let donePayload: SessionStepDonePayload | null = null;

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
            if (evt.type === 'qrcode') {
              setQrcode(evt.payload);
              appendLog('📱 二维码已显示');
            }
            if (evt.type === 'done') {
              donePayload = JSON.parse(evt.payload) as SessionStepDonePayload;
              if (donePayload.vars) {
                setCtx(prev => ({ ...prev, ...donePayload!.vars }));
                setRuntimeVars(prev => ({ ...prev, ...donePayload!.vars }));
              }
              const st: StepStatus = donePayload.skipped
                ? 'skip'
                : donePayload.failed
                ? 'error'
                : donePayload.result?.success
                ? 'success'
                : 'warn';
              setStepStatus(prev => { const n = [...prev]; n[idx] = st; return n; });
              setLastExecutedStep(donePayload.executedStep ?? idx);
              if (donePayload.done) {
                setCurrentStep(nodes.length);
                appendLog('\n🎉 工作流完成！');
              } else {
                setCurrentStep(donePayload.nextStep);
              }
              if (donePayload.result?.error) appendLog(`❌ ${donePayload.result.error}`);
            }
            if (evt.type === 'error') {
              appendLog(`❌ ${evt.payload}`);
              setStepStatus(prev => { const n = [...prev]; n[idx] = 'error'; return n; });
            }
          } catch {
            /* ignore */
          }
        }
      }

      return donePayload;
    } catch (e) {
      appendLog(`❌ ${e}`);
      setStepStatus(prev => { const n = [...prev]; n[idx] = 'error'; return n; });
      return null;
    } finally {
      if (manageRunning) setRunning(false);
    }
  }

  async function runSessionSequentially(activeSessionId: string, startIndex = 0) {
    setRunning(true);
    try {
      const maxRetries = autoRetryOnFailure ? MAX_AUTO_RETRY : 0;
      let attempt = 0;
      while (attempt <= maxRetries) {
        if (attempt > 0) {
          appendLog(`⚠️ 工作流执行不稳定，触发自动重试（第 ${attempt}/${maxRetries} 次），从第 1 步重新开始`);
          setStepStatus(nodes.map(() => 'pending'));
          setCurrentStep(0);
          setLastExecutedStep(null);
        }

        let nextIndex = attempt === 0 ? startIndex : 0;
        let shouldRetry = false;
        while (nextIndex < nodes.length) {
          const payload = await executeSessionStep(activeSessionId, nextIndex, {
            manageRunning: false,
            reset: attempt > 0 && nextIndex === 0,
          });
          if (!payload) {
            shouldRetry = false;
            nextIndex = nodes.length;
            break;
          }
          if (payload.done) {
            return;
          }
          if (payload.failed) {
            if (attempt < maxRetries) {
              appendLog(`⚠️ 第 ${nextIndex + 1} 步失败，准备整体重试`);
              shouldRetry = true;
            } else {
              appendLog(`❌ 第 ${nextIndex + 1} 步失败，已达到最大重试次数（${maxRetries}）`);
              shouldRetry = false;
            }
            break;
          }
          nextIndex = payload.nextStep;
        }

        if (!shouldRetry) break;
        attempt += 1;
      }
    } finally {
      setRunning(false);
    }
  }

  async function createSession(autoRun = false) {
    try {
      appendLog('🚀 创建 Debug 会话...');
      const vars = collectSessionVars();
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
      appendLog(autoRun
        ? `✅ 会话已创建（${data.totalSteps} 步）— 开始顺序执行`
        : `✅ 会话已创建（${data.totalSteps} 步）— 点击任意节点 ▶ 执行`
      );
      if (autoRun) {
        await runSessionSequentially(data.sessionId, 0);
      }
    } catch (e) { appendLog(`❌ ${e}`); }
  }

  async function closeSession() {
    if (!sessionId) return;
    const qs = keepBrowserPage ? '?keepPage=1' : '';
    await fetch(`/api/workflow/session/${sessionId}${qs}`, { method: 'DELETE' }).catch(() => {});
    setSessionId(null);
    setRunning(false);
    setLastExecutedStep(null);
    appendLog('🗑️ 会话已关闭');
  }

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
                  onDoubleClick={() => setEditingIdx(isSelected ? null : i)}
                  onClick={() => setEditingIdx(isSelected ? null : i)}
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
                <div className="px-1 text-[9px] text-muted-foreground leading-tight">
                  仅影响调试执行（单节点 debug / 新建 session），会自动保存到浏览器本地（无需点保存）。会话执行中不可切换。
                </div>
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

          <label className="flex items-center justify-between rounded px-1 py-1 text-[10px] text-muted-foreground hover:bg-muted/40">
            <span>🧷 关闭会话时保留浏览器页面（推荐）</span>
            <input
              type="checkbox"
              checked={keepBrowserPage}
              onChange={e => setKeepBrowserPage(e.target.checked)}
              className="accent-primary"
            />
          </label>

          <label className="flex items-center justify-between rounded px-1 py-1 text-[10px] text-muted-foreground hover:bg-muted/40">
            <span>🔁 失败自动重试（最多 {MAX_AUTO_RETRY} 次，从第 1 步开始）</span>
            <input
              type="checkbox"
              checked={autoRetryOnFailure}
              onChange={e => setAutoRetryOnFailure(e.target.checked)}
              className="accent-primary"
            />
          </label>

          {/* Session 按钮 */}
          {!sessionId ? (
            <div className="space-y-1.5">
              {DEBUG_VNC_URL && (
                <a
                  href={DEBUG_VNC_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="block w-full py-1.5 text-center text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-400"
                  title="打开实时远程浏览器（noVNC）"
                >
                  🖥 打开实时浏览器
                </a>
              )}
              <button
                onClick={() => void createSession(true)}
                disabled={running}
                className="w-full py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                🚀 开始 Debug 执行
              </button>
              <button
                onClick={() => void createSession(false)}
                disabled={running}
                className="w-full py-1.5 text-xs bg-muted text-foreground rounded-lg hover:bg-muted/70 disabled:opacity-50"
              >
                仅创建会话
              </button>
            </div>
          ) : (
            <div className="flex gap-1.5">
              <div className="flex-1 flex flex-col gap-1">
                <p className="text-[9px] text-muted-foreground text-center">点击左侧节点查看参数并执行</p>
                {DEBUG_VNC_URL && (
                  <a
                    href={DEBUG_VNC_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-1.5 text-xs text-center bg-blue-500 text-white rounded-lg hover:bg-blue-400"
                    title="打开实时远程浏览器（noVNC）"
                  >
                    🖥 打开实时浏览器
                  </a>
                )}
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

        <RuntimeContextPanel
          fieldKeys={runtimeContextKeys}
          values={currentSessionVars}
          adsEnabled={adsWorkflowEnabled}
          sessionId={sessionId}
          currentStep={currentStep}
          totalSteps={nodes.length}
          modeLabel={sessionId ? 'session 接力' : '独立执行'}
          onChange={setContextFieldValue}
          onResetAdsDefault={() => setRuntimeVars(prev => ({ ...prev, browserInstanceId: DEFAULT_ADS_BROWSER_INSTANCE_ID }))}
          jsonValue={runtimeJsonDraft}
          jsonError={runtimeJsonError}
          onJsonChange={(value) => {
            setRuntimeJsonDraft(value);
            setRuntimeJsonDirty(true);
            if (runtimeJsonError) setRuntimeJsonError(null);
          }}
          onApplyJson={applyRuntimeJson}
          onResetJsonFromCurrent={resetRuntimeJsonFromCurrent}
          onLoadJsonDefault={loadRuntimeJsonDefault}
          onSaveJsonDefault={saveRuntimeJsonAsDefault}
        />

        {/* ── 节点详情 + 执行面板（选中节点时始终显示）── */}
        {rightPanelMode === 'node' && editingIdx !== null && (
            <NodeDetailPanel
            node={nodes[editingIdx]}
            idx={editingIdx}
            total={nodes.length}
            onChange={patch => updateNode(editingIdx, patch)}
            onClose={() => setEditingIdx(null)}
            sessionId={sessionId}
            vars={collectSessionVars()}
            materials={materials}
            humanOptions={humanOptions}
            onVarsChange={(nextVars) => {
              setCtx(prev => ({
                ...prev,
                videoUrl: nextVars.videoUrl ?? prev.videoUrl,
                title: nextVars.title ?? prev.title,
                tags: nextVars.tags ?? prev.tags,
                clientId: nextVars.clientId ?? prev.clientId,
              }));
              setRuntimeVars(prev => ({ ...prev, ...nextVars }));
            }}
            onStepStatusChange={(i, status) => {
              setRunning(status === 'running');
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
            <div className="max-w-lg space-y-4">
              <div>
                <p className="text-sm font-semibold mb-1">工作流参数</p>
                <p className="text-[11px] text-muted-foreground">
                  素材选择已经做成正式节点。先点左侧第 1 个“素材节点”选择素材，执行后会输出 `videoUrl` 和 `title`，后面的上传和标题节点会直接复用。
                </p>
              </div>

              <div className="rounded-xl border border-border bg-card p-3">
                {workflowVarKeys.length > 0 && (
                  <>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">工作流运行时变量（测试前可修改）</p>
                    <p className="mb-2 text-[10px] text-muted-foreground">顶部“运行上下文”与这里实时同步，修改任一处都会影响后续执行。</p>
                    <div className="space-y-1.5 mb-3">
                      {workflowVarKeys.map((key) => (
                        <div key={key}>
                          <label className="text-[9px] text-muted-foreground block mb-0.5">
                            {key}
                            {WORKFLOW_VARS_META[key] ? ` · ${WORKFLOW_VARS_META[key]}` : ''}
                          </label>
                          <input
                            value={runtimeVars[key] ?? ''}
                            onChange={e => setRuntimeVars(prev => ({ ...prev, [key]: e.target.value }))}
                            placeholder={fieldPlaceholder(key)}
                            className="w-full bg-background border border-border rounded px-2 py-1 text-[11px] font-mono outline-none focus:border-primary"
                          />
                        </div>
                      ))}
                    </div>
                  </>
                )}
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">当前运行时变量</p>
                <div className="space-y-1.5">
                  {Object.entries(collectSessionVars()).length === 0 && (
                    <p className="text-[11px] text-muted-foreground">—</p>
                  )}
                  {Object.entries(collectSessionVars()).map(([key, value]) => (
                    <div key={key}>
                      <label className="text-[9px] text-muted-foreground block mb-0.5">{key}</label>
                      <p className="text-[11px] font-mono text-foreground/80 break-all bg-muted/30 rounded px-2 py-1 min-h-7">
                        {value || '—'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-muted/30 rounded-xl border border-dashed border-border">
                <p className="text-[10px] text-muted-foreground">💡 点击左侧节点可查看和编辑参数，双击也可编辑。开始 Debug 后，建议先执行素材节点。</p>
              </div>
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
                  {Object.entries(collectSessionVars()).length === 0 && (
                    <p className="text-[11px] text-muted-foreground">—</p>
                  )}
                  {Object.entries(collectSessionVars()).map(([key, value]) => (
                    <div key={key}>
                      <label className="text-[9px] text-muted-foreground block mb-0.5">{key}</label>
                      <p className="text-[11px] font-mono text-foreground/80 truncate bg-muted/30 rounded px-2 py-0.5">{value || '—'}</p>
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
