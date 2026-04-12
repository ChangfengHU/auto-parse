'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

type Platform = 'douyin' | 'xiaohongshu';

// ── Cookie 状态类型 ────────────────────────────────────────
interface CookieStatus {
  set: boolean;
  preview?: string;
  valid?: boolean;
  updatedAt?: number;
}

// ── 抖音 Cookie 管理组件 ───────────────────────────────────
function DouyinCookiePanel({ onStatusChange }: { onStatusChange: (valid: boolean) => void }) {
  const [status, setStatus] = useState<CookieStatus | null>(null);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [showInput, setShowInput] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/cookie');
      const d = await res.json();
      setStatus({ set: d.valid, valid: d.valid, updatedAt: d.updatedAt });
      onStatusChange(d.valid);
      if (d.valid) setShowInput(false);
    } catch {
      setStatus({ set: false, valid: false });
      onStatusChange(false);
    }
  }, [onStatusChange]);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    if (!input.trim()) return;
    setSaving(true);
    setMsg('');
    try {
      const res = await fetch('/api/cookie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie: input.trim() }),
      });
      const d = await res.json();
      if (d.success) {
        setMsg('✅ 已保存');
        setInput('');
        await refresh();
      } else {
        setMsg('❌ ' + (d.error ?? '保存失败'));
      }
    } catch (e) {
      setMsg('❌ 保存失败: ' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setSaving(false);
    }
  };

  const formatTime = (ts?: number) => {
    if (!ts) return '从未';
    const d = new Date(ts);
    const now = Date.now();
    const diff = Math.floor((now - ts) / 60000);
    if (diff < 1) return '刚刚';
    if (diff < 60) return `${diff}分钟前`;
    if (diff < 1440) return `${Math.floor(diff / 60)}小时前`;
    return `${Math.floor(diff / 1440)}天前`;
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-base font-semibold text-foreground">抖音 Cookie 设置</span>
          {status?.valid && status.updatedAt && (
            <p className="text-xs text-muted-foreground mt-1">
              上次同步：{formatTime(status.updatedAt)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {status?.valid && (
            <button 
              onClick={() => setShowInput(!showInput)} 
              className="text-xs text-primary hover:underline font-medium"
            >
              {showInput ? '取消修改' : '重新设置'}
            </button>
          )}
          <span className={`text-xs px-3 py-1 rounded-full font-medium ${
            status?.valid
              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
          }`}>
            {status === null ? '检查中...' : status.valid ? '✅ 已设置' : '⚠️ 未设置'}
          </span>
        </div>
      </div>

      {(!status?.valid || showInput) && (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
          {/* 使用插件引导 */}
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl flex-shrink-0">🔌</span>
              <div className="flex-1 space-y-2">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
                  推荐：使用浏览器插件自动获取 Cookie
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                  1. 安装浏览器插件 "vyibc-auto-parse"<br />
                  2. 登录抖音网页版（www.douyin.com）<br />
                  3. 点击插件图标，选择"一键读取抖音登录信息"<br />
                  4. 点击"复制"后粘贴到下方输入框，或直接点击插件中的"同步"按钮
                </p>
              </div>
            </div>
          </div>

          {/* 手动输入 */}
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              或手动获取：在抖音网页版登录后，打开 Chrome 开发者工具 → Application → Cookies → www.douyin.com，
              复制所有 cookie 内容（至少包含 <code className="bg-muted px-1 rounded text-xs">sessionid</code>）粘贴到下方：
            </p>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && save()}
                placeholder="粘贴 Cookie 字符串（如：sessionid=xxx; uid_tt=xxx; ...）"
                className="flex-1 px-3 py-2.5 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono"
                autoFocus={showInput}
              />
              <button
                onClick={save}
                disabled={saving || !input.trim()}
                className="px-5 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg disabled:opacity-50 hover:opacity-90 transition-opacity"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
            {msg && (
              <p className={`text-xs ${msg.startsWith('✅') ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {msg}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 小红书 Cookie 管理组件 ─────────────────────────────────
function XiaohongshuCookiePanel({ onStatusChange }: { onStatusChange: (set: boolean) => void }) {
  const [status, setStatus] = useState<CookieStatus | null>(null);
  const [mode, setMode] = useState<'credential' | 'cookie'>('credential');
  const [input, setInput] = useState('');
  const [pluginClientId, setPluginClientId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState('');
  const [showInput, setShowInput] = useState(false);
  const autoLoginTriedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/analysis/xhs/cookie');
      const d = await res.json();
      setStatus(d);
      onStatusChange(d.set);
      if (d.set) setShowInput(false);
    } catch {
      setStatus({ set: false });
      onStatusChange(false);
    }
  }, [onStatusChange]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.data?.type !== 'PLATFORM_CLIENT_ID' || event.data?.platform !== 'xhs') return;
      const id = typeof event.data?.clientId === 'string' ? event.data.clientId.trim() : '';
      if (!id) return;
      setPluginClientId(id);
      setInput(prev => prev || id);
    };
    window.addEventListener('message', handler);
    window.postMessage({ type: 'PLATFORM_GET_CLIENT_ID', platform: 'xhs' }, '*');
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', handler);
    }, 2000);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', handler);
    };
  }, []);

  useEffect(() => {
    if (!pluginClientId || autoLoginTriedRef.current || status?.set) return;
    autoLoginTriedRef.current = true;
    const run = async () => {
      setSaving(true);
      setMsg('');
      try {
        const res = await fetch('/api/analysis/xhs/cookie', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: pluginClientId }),
        });
        const d = await res.json();
        if (d.ok) {
          setMode('credential');
          setInput('');
          setShowInput(false);
          setMsg('✅ 已自动读取插件凭证并登录');
          await refresh();
        } else {
          setMsg('⚠️ 检测到插件凭证，但自动登录失败：' + (d.error ?? '未知错误'));
        }
      } catch (e) {
        setMsg('⚠️ 检测到插件凭证，但自动登录请求失败：' + (e instanceof Error ? e.message : '未知错误'));
      } finally {
        setSaving(false);
      }
    };
    void run();
  }, [pluginClientId, refresh, status?.set]);

  const save = async () => {
    if (!input.trim()) return;
    setSaving(true);
    setMsg('');
    try {
      const res = await fetch('/api/analysis/xhs/cookie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'credential' ? { clientId: input.trim() } : { cookie: input.trim() }),
      });
      const d = await res.json();
      if (d.ok) {
        setMsg('✅ 已保存');
        setInput('');
        await refresh();
      } else {
        setMsg('❌ ' + (d.error ?? '保存失败'));
      }
    } catch (e) {
      setMsg('❌ 保存失败: ' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    try {
      await fetch('/api/analysis/xhs/cookie', { method: 'DELETE' });
      setMsg('');
      await refresh();
    } catch {
      setMsg('❌ 清除失败');
    }
  };

  const testLogin = async () => {
    setTesting(true);
    setMsg('');
    try {
      const res = await fetch('/api/analysis/xhs/cookie/test', { cache: 'no-store' });
      const d = await res.json();
      if (res.ok && d.valid) {
        setMsg('✅ 当前登录信息有效');
      } else {
        setMsg('❌ ' + (d.error ?? '登录信息无效'));
      }
    } catch (e) {
      setMsg('❌ 测试失败: ' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold text-foreground">小红书登录设置</span>
        <div className="flex items-center gap-3">
          {status?.set && (
            <button 
              onClick={() => setShowInput(!showInput)} 
              className="text-xs text-primary hover:underline font-medium"
            >
              {showInput ? '取消修改' : '重新设置'}
            </button>
          )}
          <span className={`text-xs px-3 py-1 rounded-full font-medium ${
            status?.set
              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
          }`}>
            {status === null ? '检查中...' : status.set ? '✅ 已设置' : '⚠️ 未设置'}
          </span>
        </div>
      </div>

      {status?.set && status.preview && !showInput && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground p-2 bg-muted/30 rounded-lg border border-dashed border-border">
          <span className="font-mono flex-1 truncate opacity-70 italic">{status.preview}</span>
          <button
            onClick={testLogin}
            disabled={testing}
            className="text-primary hover:text-primary/80 shrink-0 font-medium disabled:opacity-50"
          >
            {testing ? '测试中...' : '测试登录'}
          </button>
          <button onClick={clear} className="text-red-500 hover:text-red-600 shrink-0 font-medium">
            清除
          </button>
        </div>
      )}

      {(!status?.set || showInput) && (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
          {/* 使用插件引导 */}
          <div className="rounded-lg bg-pink-50 dark:bg-pink-950/30 border border-pink-200 dark:border-pink-800 p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl flex-shrink-0">🔌</span>
              <div className="flex-1 space-y-2">
                <p className="text-sm font-medium text-pink-900 dark:text-pink-200">
                  推荐：先用插件同步，再在这里输入凭证 ID 或 Cookie
                </p>
                <p className="text-xs text-pink-700 dark:text-pink-300 leading-relaxed">
                  1. 安装浏览器插件 "vyibc-auto-parse"<br />
                  2. 登录小红书网页版（www.xiaohongshu.com）<br />
                  3. 点击插件图标，选择"小红书"标签页<br />
                  4. 在插件里复制凭证 ID（xhs_ 开头）或 Cookie<br />
                  5. 粘贴到下方输入框并登录
                </p>
              </div>
            </div>
          </div>

          {/* 手动输入 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMode('credential')}
                className={`px-3 py-1.5 text-xs rounded-md border ${
                  mode === 'credential'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border'
                }`}
              >
                使用凭证
              </button>
              <button
                type="button"
                onClick={() => setMode('cookie')}
                className={`px-3 py-1.5 text-xs rounded-md border ${
                  mode === 'cookie'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border'
                }`}
              >
                使用 Cookie
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {mode === 'credential' ? (
                <>
                  输入凭证 ID（示例：
                  <code className="bg-muted px-1 rounded text-xs ml-1">xhs_4cbc57e24e94447a912c0f8acc2ed2b9</code>）
                </>
              ) : (
                <>粘贴完整 Cookie 字符串（如包含 web_session、a1 等字段）</>
              )}
            </p>
            {pluginClientId && mode === 'credential' && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                已从插件检测到凭证：<span className="font-mono">{pluginClientId}</span>
              </p>
            )}
            <div className="flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && save()}
                placeholder={mode === 'credential' ? '输入 xhs_ 开头凭证 ID' : '粘贴完整 Cookie 字符串'}
                className="flex-1 px-3 py-2.5 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono"
                autoFocus={showInput}
              />
              <button
                onClick={save}
                disabled={saving || !input.trim()}
                className="px-5 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg disabled:opacity-50 hover:opacity-90 transition-opacity"
              >
                {saving ? '登录中...' : '保存/登录'}
              </button>
              <button
                onClick={testLogin}
                disabled={testing}
                className="px-5 py-2.5 bg-muted border border-border text-foreground text-sm font-medium rounded-lg disabled:opacity-50 hover:bg-border/50 transition-opacity"
              >
                {testing ? '测试中...' : '测试登录'}
              </button>
            </div>
          </div>
        </div>
      )}
      {msg && (
        <p className={`text-xs ${msg.startsWith('✅') ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {msg}
        </p>
      )}
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────
export default function AnalysisPage() {
  const router = useRouter();
  const [platform, setPlatform] = useState<Platform>('douyin');
  const [douyinReady, setDouyinReady] = useState(false);
  const [xhsReady, setXhsReady] = useState(false);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      {/* 页面标题 */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">平台解析配置</h1>
        <p className="text-sm text-muted-foreground mt-1">
          配置抖音 Cookie 与小红书凭证登录，用于内容解析和数据采集
        </p>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-3 border-b border-border">
        <button
          onClick={() => setPlatform('douyin')}
          className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
            platform === 'douyin'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <span className="flex items-center gap-2">
            <span>抖音</span>
            {douyinReady && <span className="w-2 h-2 bg-green-500 rounded-full"></span>}
          </span>
        </button>
        <button
          onClick={() => setPlatform('xiaohongshu')}
          className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
            platform === 'xiaohongshu'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <span className="flex items-center gap-2">
            <span>小红书</span>
            {xhsReady && <span className="w-2 h-2 bg-green-500 rounded-full"></span>}
          </span>
        </button>
      </div>

      {/* 内容区域 */}
      {platform === 'douyin' ? (
        <div className="space-y-5">
          <DouyinCookiePanel onStatusChange={setDouyinReady} />
          
          {douyinReady && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground mb-3">快速跳转</h3>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => router.push('/parse')}
                  className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
                >
                  视频解析
                </button>
                <button
                  onClick={() => router.push('/publish')}
                  className="px-4 py-2 bg-muted border border-border text-foreground text-sm font-medium rounded-lg hover:bg-border/50 transition-colors"
                >
                  发布管理
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <XiaohongshuCookiePanel onStatusChange={setXhsReady} />
          
          {xhsReady && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground mb-3">快速跳转</h3>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => router.push('/analysis/xhs')}
                  className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
                >
                  小红书解析
                </button>
                <button
                  onClick={() => router.push('/parse')}
                  className="px-4 py-2 bg-muted border border-border text-foreground text-sm font-medium rounded-lg hover:bg-border/50 transition-colors"
                >
                  视频解析
                </button>
                <button
                  onClick={() => router.push('/content-library')}
                  className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
                >
                  📚 内容素材库
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 提示信息 */}
      <div className="rounded-lg bg-muted/50 border border-border p-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          💡 <strong>提示：</strong>Cookie 用于授权访问平台数据，请妥善保管。
          插件会自动读取浏览器登录状态，无需手动复制 Cookie。
          如遇到解析失败，请尝试重新登录平台并更新 Cookie。
        </p>
      </div>
    </div>
  );
}
