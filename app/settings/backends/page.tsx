'use client';

import { useEffect, useState } from 'react';

type BackendConfig = {
  xhs: {
    source: 'cli' | 'http';
    httpBaseUrl: string;
    timeoutMs: number;
  };
  adsDispatcher: {
    maxQueueSize: number;
    fastFailStrategy: 'llm_rewrite' | 'direct_retry' | 'skip';
  };
  browser: {
    headless: boolean;
  };
  upload: {
    provider: 'oss' | 'supabase';
    supabaseBucket: string;
  };
};

type BrowserStatus = {
  alive: boolean;
  configuredHeadless: boolean;
  runningHeadless?: boolean;
  dataDir: string;
  openPages: number;
  douyinLoggedIn: boolean;
};

function normalizeConfig(input: BackendConfig): BackendConfig {
  return {
    ...input,
    upload: {
      provider: input.upload?.provider ?? 'oss',
      supabaseBucket: input.upload?.supabaseBucket || 'filestore',
    },
  };
}

type TabKey = 'xhs' | 'upload' | 'ads';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'xhs', label: '小红书解析后端' },
  { key: 'upload', label: '上传配置' },
  { key: 'ads', label: 'Ads Dispatcher' },
];

export default function BackendSettingsPage() {
  const [config, setConfig] = useState<BackendConfig | null>(null);
  const [configPath, setConfigPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applyingBrowser, setApplyingBrowser] = useState(false);
  const [message, setMessage] = useState('');
  const [browserStatus, setBrowserStatus] = useState<BrowserStatus | null>(null);
  const [tab, setTab] = useState<TabKey>('xhs');

  async function loadBrowserStatus() {
    try {
      const res = await fetch('/api/browser/status', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '加载浏览器状态失败');
      setBrowserStatus(data as BrowserStatus);
    } catch {
      setBrowserStatus(null);
    }
  }

  async function loadConfig() {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/system/backend-config', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || '加载配置失败');
      setConfig(normalizeConfig(data.data));
      setConfigPath(data.meta?.path || '');
      await loadBrowserStatus();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadConfig(); }, []);

  async function saveConfig() {
    if (!config) return;
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/system/backend-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || '保存失败');
      setConfig(normalizeConfig(data.data));
      setConfigPath(data.meta?.path || '');
      setMessage('✓ 配置已保存');
      await loadBrowserStatus();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function applyBrowserConfig() {
    setApplyingBrowser(true);
    setMessage('');
    try {
      const closeRes = await fetch('/api/browser/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close' }),
      });
      const closeData = await closeRes.json().catch(() => ({}));
      if (!closeRes.ok) throw new Error(closeData.error || '关闭浏览器失败');

      const startRes = await fetch('/api/browser/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const startData = await startRes.json().catch(() => ({}));
      if (!startRes.ok) throw new Error(startData.error || '启动浏览器失败');

      setMessage('✓ 浏览器已重启并应用配置');
      await loadBrowserStatus();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setApplyingBrowser(false);
    }
  }

  async function resetConfig() {
    setSaving(true);
    setMessage('');
    try {
      const res = await fetch('/api/system/backend-config', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || '重置失败');
      setConfig(normalizeConfig(data.data));
      setConfigPath(data.meta?.path || '');
      setMessage('✓ 已恢复默认配置');
      await loadBrowserStatus();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Page header */}
      <div className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-foreground">后端配置</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            统一管理平台运行时配置，配置保存到本地 .runtime/backend-config.json，不会提交 git。
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-3xl space-y-0">

          {loading || !config ? (
            <div className="rounded-2xl border border-border bg-card p-8 text-sm text-muted-foreground">加载配置中...</div>
          ) : (
            <>
              {/* Tab bar */}
              <div className="flex gap-0 border-b border-border">
                {TABS.map(t => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                      tab === t.key
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Tab panels */}
              <div className="rounded-b-2xl rounded-tr-2xl border border-t-0 border-border bg-card p-6 shadow-sm space-y-6">

                {/* ── Tab: 小红书解析后端 ── */}
                {tab === 'xhs' && (
                  <>
                    <section className="space-y-4">
                      <div>
                        <h2 className="text-base font-semibold text-foreground">解析后端模式</h2>
                        <p className="mt-1 text-xs text-muted-foreground">
                          <code>cli</code> 使用项目内置 Python；<code>http</code> 转发到外部服务（如 http://127.0.0.1:1030）。
                        </p>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => setConfig({ ...config, xhs: { ...config.xhs, source: 'cli' } })}
                          className={`rounded-xl border p-4 text-left transition ${
                            config.xhs.source === 'cli' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                          }`}
                        >
                          <div className="text-sm font-semibold text-foreground">内置 Python</div>
                          <div className="mt-1 text-xs text-muted-foreground">默认模式，走 python/.venv 和 vendored xiaohongshu_cli</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfig({ ...config, xhs: { ...config.xhs, source: 'http' } })}
                          className={`rounded-xl border p-4 text-left transition ${
                            config.xhs.source === 'http' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                          }`}
                        >
                          <div className="text-sm font-semibold text-foreground">HTTP 服务</div>
                          <div className="mt-1 text-xs text-muted-foreground">兼容旧 1030 服务，也支持替换成远端域名</div>
                        </button>
                      </div>

                      <div className="grid gap-4 md:grid-cols-[1fr_180px]">
                        <label className="space-y-1.5">
                          <span className="text-sm font-medium text-foreground">HTTP Base URL</span>
                          <input
                            value={config.xhs.httpBaseUrl}
                            onChange={(e) => setConfig({ ...config, xhs: { ...config.xhs, httpBaseUrl: e.target.value } })}
                            placeholder="http://127.0.0.1:1030"
                            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                          />
                        </label>
                        <label className="space-y-1.5">
                          <span className="text-sm font-medium text-foreground">超时 (ms)</span>
                          <input
                            type="number"
                            min={1000}
                            step={1000}
                            value={config.xhs.timeoutMs}
                            onChange={(e) => setConfig({ ...config, xhs: { ...config.xhs, timeoutMs: Number.parseInt(e.target.value || '45000', 10) || 45000 } })}
                            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                          />
                        </label>
                      </div>
                    </section>

                    <div className="border-t border-border" />

                    <section className="space-y-4">
                      <div>
                        <h2 className="text-base font-semibold text-foreground">浏览器模式</h2>
                        <p className="mt-1 text-xs text-muted-foreground">Playwright 启动参数，保存后需要重启浏览器才能生效。</p>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => setConfig({ ...config, browser: { ...config.browser, headless: true } })}
                          className={`rounded-xl border p-4 text-left transition ${
                            config.browser.headless ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                          }`}
                        >
                          <div className="text-sm font-semibold text-foreground">无头（Headless）</div>
                          <div className="mt-1 text-xs text-muted-foreground">稳定运行推荐，适合部署与无人值守。</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfig({ ...config, browser: { ...config.browser, headless: false } })}
                          className={`rounded-xl border p-4 text-left transition ${
                            !config.browser.headless ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                          }`}
                        >
                          <div className="text-sm font-semibold text-foreground">有头（Headed）</div>
                          <div className="mt-1 text-xs text-muted-foreground">本地调试推荐，可直接看到页面操作。</div>
                        </button>
                      </div>

                      <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
                        <div>配置值：headless = {String(config.browser.headless)}</div>
                        <div>
                          当前运行：{browserStatus
                            ? `alive=${String(browserStatus.alive)}  runningHeadless=${String(browserStatus.runningHeadless)}`
                            : '未知（无法读取 /api/browser/status）'}
                        </div>
                        {browserStatus?.alive && browserStatus.runningHeadless !== config.browser.headless && (
                          <div className="text-amber-500">⚠ 配置与运行不一致，需要重启浏览器应用变更。</div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void applyBrowserConfig()}
                          disabled={applyingBrowser || saving}
                          className="rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
                        >
                          {applyingBrowser ? '应用中...' : '重启浏览器并应用'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void loadBrowserStatus()}
                          disabled={applyingBrowser || saving}
                          className="rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
                        >
                          刷新浏览器状态
                        </button>
                      </div>
                    </section>
                  </>
                )}

                {/* ── Tab: 上传配置 ── */}
                {tab === 'upload' && (
                  <>
                    <section className="space-y-4">
                      <div>
                        <h2 className="text-base font-semibold text-foreground">上传存储</h2>
                        <p className="mt-1 text-xs text-muted-foreground">
                          控制素材上传的默认存储后端。默认使用 OSS；切到 Supabase 后使用 Storage bucket。
                        </p>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => setConfig({ ...config, upload: { ...config.upload, provider: 'oss' } })}
                          className={`rounded-xl border p-4 text-left transition ${
                            config.upload.provider === 'oss' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-foreground">OSS</span>
                            <span className="text-[10px] bg-primary/15 text-primary rounded px-1.5 py-0.5 font-medium">默认</span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            使用当前阿里云 OSS 配置，兼容现有素材上传流程。
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => setConfig({ ...config, upload: { ...config.upload, provider: 'supabase' } })}
                          className={`rounded-xl border p-4 text-left transition ${
                            config.upload.provider === 'supabase' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                          }`}
                        >
                          <div className="text-sm font-semibold text-foreground">Supabase Storage</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            上传到 Supabase Storage，适合统一走当前 Supabase 项目。
                          </div>
                        </button>
                      </div>

                      <label className="block space-y-1.5">
                        <span className="text-sm font-medium text-foreground">Supabase Bucket</span>
                        <input
                          value={config.upload.supabaseBucket}
                          onChange={(e) => setConfig({ ...config, upload: { ...config.upload, supabaseBucket: e.target.value } })}
                          placeholder="filestore"
                          className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                        />
                        <p className="text-xs text-muted-foreground">
                          当前建议 bucket：<code>filestore</code>。切换为 Supabase Storage 时会使用这个 bucket。
                        </p>
                      </label>

                      <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
                        <div>当前上传后端：{config.upload.provider === 'supabase' ? 'Supabase Storage' : 'OSS'}</div>
                        <div>Supabase bucket：{config.upload.supabaseBucket || 'filestore'}</div>
                        <div>配置保存后写入 .runtime/backend-config.json；默认值仍为 OSS。</div>
                      </div>
                    </section>
                  </>
                )}

                {/* ── Tab: Ads Dispatcher ── */}
                {tab === 'ads' && (
                  <>
                    <section className="space-y-4">
                      <div>
                        <h2 className="text-base font-semibold text-foreground">队列设置</h2>
                        <p className="mt-1 text-xs text-muted-foreground">控制同时提交的任务数量上限（FIFO 串行队列）。保存后立即生效，无需重启。</p>
                      </div>

                      <label className="block space-y-1.5">
                        <span className="text-sm font-medium text-foreground">最大队列长度</span>
                        <input
                          type="number"
                          min={1}
                          max={200}
                          step={1}
                          value={config.adsDispatcher.maxQueueSize}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              adsDispatcher: {
                                ...config.adsDispatcher,
                                maxQueueSize: Math.max(1, Math.min(200, Number.parseInt(e.target.value || '20', 10) || 20)),
                              },
                            })
                          }
                          className="w-40 rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                        />
                        <p className="text-xs text-muted-foreground">超过上限后新提交的任务会收到「队列已满」错误。范围 1–200，默认 20。</p>
                      </label>
                    </section>

                    <div className="border-t border-border" />

                    <section className="space-y-4">
                      <div>
                        <h2 className="text-base font-semibold text-foreground">Fast-fail 重试策略</h2>
                        <p className="mt-1 text-xs text-muted-foreground">
                          当工作流检测到「没办法」等快速失败文本（failFastTextIncludes）时，控制 Dispatcher 对该 item 的后续处理方式。
                        </p>
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        {([
                          {
                            value: 'llm_rewrite' as const,
                            label: 'LLM 改写',
                            badge: '推荐',
                            desc: '调用 Gemini 改写 prompt 后重试，避免同样的问题重现。',
                          },
                          {
                            value: 'direct_retry' as const,
                            label: '直接重试',
                            badge: '',
                            desc: '保持原 prompt 直接重试，适合偶发性限额问题。',
                          },
                          {
                            value: 'skip' as const,
                            label: '立即失败',
                            badge: '',
                            desc: '不重试，直接将该 item 标记为失败，节省时间。',
                          },
                        ]).map(opt => {
                          const active = (config.adsDispatcher.fastFailStrategy ?? 'llm_rewrite') === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setConfig({ ...config, adsDispatcher: { ...config.adsDispatcher, fastFailStrategy: opt.value } })}
                              className={`rounded-xl border p-4 text-left transition ${
                                active ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className="text-sm font-semibold text-foreground">{opt.label}</span>
                                {opt.badge && (
                                  <span className="text-[10px] bg-primary/15 text-primary rounded px-1.5 py-0.5 font-medium">{opt.badge}</span>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground leading-relaxed">{opt.desc}</div>
                            </button>
                          );
                        })}
                      </div>

                      <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
                        <div className="font-medium text-foreground/70">关于 LLM 改写</div>
                        <div>改写模型由环境变量 <code>GEMINI_ADS_DISPATCHER_PROMPT_OPTIMIZATION_MODEL</code> 控制（默认 gemini-2.5-flash）。</div>
                        <div>选择「LLM 改写」时，即使任务创建时 <code>optimizePromptOnRetry=false</code>，fast-fail 场景也会强制触发改写。</div>
                      </div>
                    </section>
                  </>
                )}

                {/* ── 底部操作栏（所有 tab 共用） ── */}
                <div className="border-t border-border pt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void saveConfig()}
                    disabled={saving}
                    className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  >
                    {saving ? '保存中...' : '保存配置'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void resetConfig()}
                    disabled={saving}
                    className="rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
                  >
                    恢复默认
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadConfig()}
                    disabled={saving}
                    className="rounded-xl border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
                  >
                    重新读取
                  </button>
                  {message && (
                    <span className={`text-sm ${message.startsWith('✓') ? 'text-green-500' : 'text-red-400'}`}>
                      {message}
                    </span>
                  )}
                </div>

                {/* 配置文件路径提示 */}
                <div className="text-xs text-muted-foreground">
                  配置文件：{configPath || '未生成，保存后写入 .runtime/backend-config.json'}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
