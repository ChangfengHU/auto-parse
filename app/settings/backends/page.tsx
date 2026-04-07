'use client';

import { useEffect, useState } from 'react';

type BackendConfig = {
  xhs: {
    source: 'cli' | 'http';
    httpBaseUrl: string;
    timeoutMs: number;
  };
};

export default function BackendSettingsPage() {
  const [config, setConfig] = useState<BackendConfig | null>(null);
  const [configPath, setConfigPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function loadConfig() {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/api/system/backend-config', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || '加载配置失败');
      setConfig(data.data);
      setConfigPath(data.meta?.path || '');
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
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
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
            统一管理平台接口调用源。当前先支持小红书在内置 Python 和 `1030` HTTP 服务之间切换。
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
