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
  };
  browser: {
    headless: boolean;
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

export default function BackendSettingsPage() {
  const [config, setConfig] = useState<BackendConfig | null>(null);
  const [configPath, setConfigPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applyingBrowser, setApplyingBrowser] = useState(false);
  const [message, setMessage] = useState('');
  const [browserStatus, setBrowserStatus] = useState<BrowserStatus | null>(null);

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
      setConfig(data.data);
      setConfigPath(data.meta?.path || '');
      await loadBrowserStatus();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadConfig();
  }, []);

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
      setConfig(data.data);
      setConfigPath(data.meta?.path || '');
      setMessage('配置已保存');
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

      setMessage('浏览器已重启并应用配置');
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
      setConfig(data.data);
      setConfigPath(data.meta?.path || '');
      setMessage('已恢复默认配置');
      await loadBrowserStatus();
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-foreground">后端配置</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            统一管理平台运行时配置：小红书解析后端、Ads Dispatcher 队列上限、以及浏览器无头/有头模式。
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-3xl rounded-2xl border border-border bg-card p-6 shadow-sm">
          {loading || !config ? (
            <div className="text-sm text-muted-foreground">加载配置中...</div>
          ) : (
            <div className="space-y-6">
              <section className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">小红书解析后端</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    `cli` 表示使用项目内置 Python；`http` 表示转发到外部服务，比如 `http://127.0.0.1:1030`。
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, xhs: { ...config.xhs, source: 'cli' } })}
                    className={`rounded-xl border p-4 text-left transition ${
                      config.xhs.source === 'cli'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/30'
                    }`}
                  >
                    <div className="text-sm font-semibold text-foreground">内置 Python</div>
                    <div className="mt-1 text-xs text-muted-foreground">默认模式，走 `python/.venv` 和 vendored `xiaohongshu_cli`</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, xhs: { ...config.xhs, source: 'http' } })}
                    className={`rounded-xl border p-4 text-left transition ${
                      config.xhs.source === 'http'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/30'
                    }`}
                  >
                    <div className="text-sm font-semibold text-foreground">HTTP 服务</div>
                    <div className="mt-1 text-xs text-muted-foreground">兼容旧 `1030` 服务，也支持后面替换成远端域名</div>
                  </button>
                </div>

                <div className="grid gap-4 md:grid-cols-[1fr_180px]">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-foreground">HTTP Base URL</span>
                    <input
                      value={config.xhs.httpBaseUrl}
                      onChange={(e) => setConfig({ ...config, xhs: { ...config.xhs, httpBaseUrl: e.target.value } })}
                      placeholder="http://127.0.0.1:1030"
                      className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="text-sm font-medium text-foreground">超时(ms)</span>
                    <input
                      type="number"
                      min={1000}
                      step={1000}
                      value={config.xhs.timeoutMs}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          xhs: {
                            ...config.xhs,
                            timeoutMs: Number.parseInt(e.target.value || '45000', 10) || 45000,
                          },
                        })
                      }
                      className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                    />
                  </label>
                </div>
              </section>

              <section className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Ads Dispatcher 队列</h2>
                  <p className="mt-1 text-sm text-muted-foreground">控制同时提交的任务数量上限（FIFO 队列长度）。保存后立即生效，无需重启浏览器。</p>
                </div>

                <label className="space-y-2">
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
                    className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                  />
                </label>
              </section>

              <section className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">浏览器模式</h2>
                  <p className="mt-1 text-sm text-muted-foreground">无头/有头是 Playwright 启动参数，保存后需要重启浏览器才能生效。</p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, browser: { ...config.browser, headless: true } })}
                    className={`rounded-xl border p-4 text-left transition ${
                      config.browser.headless ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                    }`}
                  >
                    <div className="text-sm font-semibold text-foreground">无头（Headless）</div>
                    <div className="mt-1 text-xs text-muted-foreground">稳定运行推荐。适合部署与无人值守。</div>
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

                <div className="rounded-xl bg-muted/40 p-4 text-xs text-muted-foreground">
                  <div>配置值：headless={String(config.browser.headless)}</div>
                  <div className="mt-1">
                    当前运行：
                    {browserStatus
                      ? `alive=${String(browserStatus.alive)} runningHeadless=${String(browserStatus.runningHeadless)}`
                      : '未知（无法读取 /api/browser/status）'}
                  </div>
                  {browserStatus && browserStatus.alive && browserStatus.runningHeadless !== config.browser.headless ? (
                    <div className="mt-2 text-amber-600">提示：配置与运行不一致，需要重启浏览器应用变更。</div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void applyBrowserConfig()}
                    disabled={applyingBrowser || saving}
                    className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
                  >
                    {applyingBrowser ? '应用中...' : '重启浏览器并应用'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void loadBrowserStatus()}
                    disabled={applyingBrowser || saving}
                    className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
                  >
                    刷新浏览器状态
                  </button>
                </div>
              </section>

              <section className="rounded-xl bg-muted/40 p-4 text-xs text-muted-foreground">
                <div>配置文件：{configPath || '未生成，保存后写入本地 .runtime/backend-config.json'}</div>
                <div className="mt-1">这份配置只影响当前机器的本地运行，不会提交进 git。</div>
              </section>

              <div className="flex flex-wrap items-center gap-3">
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
                  className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
                >
                  恢复默认
                </button>
                <button
                  type="button"
                  onClick={() => void loadConfig()}
                  disabled={saving}
                  className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
                >
                  重新读取
                </button>
                {message ? <span className="text-sm text-muted-foreground">{message}</span> : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
