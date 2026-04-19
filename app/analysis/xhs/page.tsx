'use client';

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type { XhsPostData, XhsImage } from '@/lib/analysis/xhs-fetch';
import XhsSearchTab from '@/components/xhs/XhsSearchTab';
import XhsSpyTab from '@/components/xhs/XhsSpyTab';

interface CookieStatus {
  set: boolean;
  preview?: string;
  valid?: boolean;
}

let initialCookieStatusCache: CookieStatus | null = null;
let initialCookieStatusPromise: Promise<CookieStatus> | null = null;

async function requestCookieStatus(): Promise<CookieStatus> {
  const res = await fetch('/api/analysis/xhs/cookie');
  return res.json();
}

async function requestLoginValidity(): Promise<boolean> {
  const res = await fetch('/api/analysis/xhs/cookie/test', { cache: 'no-store' });
  const data = await res.json() as { valid?: boolean };
  return Boolean(res.ok && data.valid);
}

// ── Cookie 管理区 ──────────────────────────────────────────────────────────────
function CookiePanel({ onStatusChange }: { onStatusChange: (valid: boolean) => void }) {
  const [status, setStatus] = useState<CookieStatus | null>(null);
  const [mode, setMode] = useState<'credential' | 'cookie'>('credential');
  const [input, setInput] = useState('');
  const [pluginClientId, setPluginClientId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [qrState, setQrState] = useState<{
    loading: boolean;
    qrUrl: string | null;
    qrId: string | null;
    code: string | null;
    a1: string | null;
    webid: string | null;
    initialCookies: any;
    statusText: string;
  }>({
    loading: false,
    qrUrl: null,
    qrId: null,
    code: null,
    a1: null,
    webid: null,
    initialCookies: null,
    statusText: '',
  });

  const autoLoginTriedRef = useRef(false);

  const refresh = useCallback(async (options?: { force?: boolean }) => {
    const d = await (async () => {
      if (options?.force) {
        const nextStatus = await requestCookieStatus();
        initialCookieStatusCache = nextStatus;
        return nextStatus;
      }

      if (initialCookieStatusCache) return initialCookieStatusCache;

      if (!initialCookieStatusPromise) {
        initialCookieStatusPromise = requestCookieStatus()
          .then((nextStatus) => {
            initialCookieStatusCache = nextStatus;
            return nextStatus;
          })
          .finally(() => {
            initialCookieStatusPromise = null;
          });
      }

      return initialCookieStatusPromise;
    })();

    const valid = d.set ? await requestLoginValidity().catch(() => false) : false;
    const nextStatus: CookieStatus = { ...d, valid };
    setStatus(nextStatus);
    onStatusChange(valid);
    if (valid) setShowInput(false);
  }, [onStatusChange]);

  useEffect(() => { void refresh(); }, [refresh]);

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

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const startQrLogin = async () => {
    setQrState(prev => ({ ...prev, loading: true, statusText: '正在生成二维码...' }));
    setMsg('');
    try {
      const res = await fetch('/api/analysis/xhs/login/qr');
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || '生成二维码失败');

      setQrState({
        loading: false,
        qrUrl: d.url,
        qrId: d.qr_id,
        code: d.code,
        a1: d.a1,
        webid: d.webid,
        initialCookies: d.cookies,
        statusText: '请使用小红书 App 扫码',
      });

      // 开始轮询
      stopPolling();
      pollTimerRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch('/api/analysis/xhs/login/poll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              qr_id: d.qr_id,
              code: d.code,
              a1: d.a1,
              webid: d.webid,
              cookies: d.cookies,
              clientId: input.trim() || pluginClientId
            }),
          });
          const pollData = await pollRes.json();
          if (pollData.ok) {
            if (pollData.status_text === 'scanned') {
              setQrState(prev => ({ ...prev, statusText: '📲 已扫码，请在手机上点击确认...' }));
            } else if (pollData.status_text === 'success') {
              setQrState(prev => ({ ...prev, statusText: '✅ 登录成功！正在同步...' }));
              stopPolling();
              setMsg('✅ 登录成功，正在刷新页面...');
              setTimeout(() => {
                setQrState(prev => ({ ...prev, qrUrl: null }));
                void refresh({ force: true });
              }, 1500);
            }
          }
        } catch (e) {
          console.error('Polling error:', e);
        }
      }, 3000);

    } catch (e) {
      setMsg('❌ ' + (e instanceof Error ? e.message : String(e)));
      setQrState(prev => ({ ...prev, loading: false, statusText: '' }));
    }
  };

  const cancelQrLogin = () => {
    stopPolling();
    setQrState({
      loading: false,
      qrUrl: null,
      qrId: null,
      code: null,
      a1: null,
      webid: null,
      initialCookies: null,
      statusText: '',
    });
  };

  useEffect(() => {
    if (!pluginClientId || autoLoginTriedRef.current || status?.valid) return;
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
          await refresh({ force: true });
        } else {
          setMsg('⚠️ 检测到插件凭证，但自动登录失败：' + (d.error ?? '未知错误'));
        }
      } catch (e) {
        setMsg('⚠️ 检测到插件凭证，但自动登录请求失败：' + (e instanceof Error ? e.message : String(e)));
      } finally {
        setSaving(false);
      }
    };
    void run();
  }, [pluginClientId, refresh, status?.valid]);

  const save = async () => {
    if (!input.trim()) return;
    setSaving(true);
    setMsg('');
    try {
      const value = input.trim();
      const res = await fetch('/api/analysis/xhs/cookie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'credential' ? { clientId: value } : { cookie: value }),
      });
      const d = await res.json();
      if (d.ok) { 
        setMsg('✅ 已保存'); 
        setInput(''); 
        setShowInput(false);
        await refresh({ force: true }); 
      }
      else setMsg('❌ ' + (d.error ?? '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!confirm('确定要清除当前登录状态吗？')) return;
    await fetch('/api/analysis/xhs/cookie', { method: 'DELETE' });
    setMsg('');
    await refresh({ force: true });
  };

  const testLogin = async () => {
    setMsg('');
    setTesting(true);
    try {
      const res = await fetch('/api/analysis/xhs/cookie/test', { cache: 'no-store' });
      const d = await res.json();
      if (res.ok && d.valid) {
        setMsg('✅ 当前登录信息有效');
      } else {
        setMsg('❌ ' + (d.error ?? '登录信息无效'));
      }
      await refresh({ force: true });
    } catch (e) {
      setMsg('❌ 测试失败: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">登录设置</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
            status?.valid
              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
          }`}>
            {status === null ? '检查中...' : status.valid ? '已登录' : status.set ? '已设置未校验' : '未设置'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {status?.set && (
            <button 
              onClick={() => { setShowInput(!showInput); cancelQrLogin(); }} 
              className="text-xs text-primary hover:underline font-medium"
            >
              {showInput ? '取消修改' : '重新设置'}
            </button>
          )}
          {status?.set && !showInput && (
            <button onClick={clear} className="text-xs text-red-500 hover:underline font-medium">清除</button>
          )}
        </div>
      </div>

      {(status?.set && !showInput) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground p-2 bg-muted/30 rounded-lg border border-dashed border-border">
          <span className="font-mono flex-1 truncate opacity-70 italic">{status.preview}</span>
          <button
            onClick={testLogin}
            disabled={testing}
            className="text-xs text-primary hover:underline font-medium disabled:opacity-50"
          >
            {testing ? '测试中...' : '测试登录'}
          </button>
        </div>
      )}
      
      {status?.set && !status.valid && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          已检测到登录信息，但当前未通过有效性校验，请点击“测试登录”或尝试扫码重新登录。
        </p>
      )}

      {/* 手动输入区 / 扫码入口 */}
      {(!status?.set || showInput) && !qrState.qrUrl && (
        <div className="space-y-3 pt-1 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center gap-2">
            <button
              onClick={startQrLogin}
              disabled={qrState.loading}
              className="flex-1 py-2.5 bg-rose-500 text-white text-xs font-bold rounded-lg hover:bg-rose-600 transition-all shadow-md shadow-rose-500/10 flex items-center justify-center gap-2"
            >
              {qrState.loading ? (
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : '📕 一键扫码登录'}
            </button>
          </div>
          
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
            <div className="relative flex justify-center text-[10px] uppercase">
              <span className="bg-card px-2 text-muted-foreground font-medium">其他方式</span>
            </div>
          </div>

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
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && save()}
              placeholder={mode === 'credential' ? '输入 xhs_ 开头凭证 ID' : '粘贴完整 Cookie 字符串'}
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono"
              autoFocus={showInput}
            />
            <button
              onClick={save}
              disabled={saving || !input.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg disabled:opacity-50 hover:opacity-90 transition-all shadow-sm"
            >
              {saving ? '...' : '保存'}
            </button>
          </div>
        </div>
      )}

      {/* 二维码展示区 */}
      {qrState.qrUrl && (
        <div className="flex flex-col items-center gap-3 p-4 bg-muted/20 rounded-xl border border-border animate-in zoom-in-95 duration-200">
          <div className="text-sm font-semibold text-foreground">扫码安全登录</div>
          <div className="bg-white p-2 rounded-lg shadow-inner border border-zinc-100">
            <img 
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrState.qrUrl)}`}
              alt="小红书登录二维码"
              className="w-48 h-48"
            />
          </div>
          <div className="text-center space-y-1">
            <p className="text-xs font-medium text-primary animate-pulse">{qrState.statusText}</p>
            <p className="text-[10px] text-muted-foreground">该二维码仅用于登录验证，不记录您的账号密码</p>
          </div>
          <button 
            onClick={cancelQrLogin}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            取消扫码
          </button>
        </div>
      )}

      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}

function SideDrawer({
  title,
  isOpen,
  onClose,
  children,
}: {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative ml-auto w-full max-w-md bg-background border-l border-border shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b border-border bg-card/60 backdrop-blur-md sticky top-0 z-10">
          <div className="text-sm font-semibold">{title}</div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground">
            ✕
          </button>
        </div>
        <div className="p-3 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// XHS CDN 图片走代理（防盗链）
function proxyImg(url: string) {
  if (!url) return url;
  // 已经是 OSS 或本地路径则直接用
  if (!url.includes('xhscdn.com') && !url.includes('xiaohongshu.com')) return url;
  return `/api/proxy/image?url=${encodeURIComponent(url)}`;
}

function extractXsecToken(url: string) {
  try {
    return new URL(url).searchParams.get('xsec_token') ?? '';
  } catch {
    const match = url.match(/[?&]xsec_token=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }
}

interface XhsComment {
  id: string;
  content: string;
  likeCount: number;
  subCommentCount: number;
  nickname: string;
  avatar: string;
}

type OssTestResult = { url: string; ossUrl?: string; error?: string };
type OssCandidateImage = XhsImage & { urlDefault?: string; url?: string };

// ── 统计数字 ──────────────────────────────────────────────────────────────────
function StatBadge({ value, label }: { value: number; label: string }) {
  const fmt = (n: number) => n >= 10000 ? `${(n / 10000).toFixed(1)}w` : String(n);
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg border border-border bg-background/70 py-1.5">
      <span className="text-sm font-semibold">{fmt(value)}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

// ── Lightbox ──────────────────────────────────────────────────────────────────
function Lightbox({ image, onClose, onPrev, onNext }: {
  image: XhsImage; onClose: () => void; onPrev?: () => void; onNext?: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev?.();
      if (e.key === 'ArrowRight') onNext?.();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, onPrev, onNext]);

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center" onClick={onClose}>
      <button className="absolute top-4 right-5 text-white text-3xl opacity-70 hover:opacity-100">✕</button>
      {onPrev && (
        <button className="absolute left-4 text-white text-4xl opacity-70 hover:opacity-100"
          onClick={e => { e.stopPropagation(); onPrev(); }}>‹</button>
      )}
      {onNext && (
        <button className="absolute right-4 text-white text-4xl opacity-70 hover:opacity-100"
          onClick={e => { e.stopPropagation(); onNext(); }}>›</button>
      )}
      <img src={proxyImg(image.previewUrl)} alt="" onClick={e => e.stopPropagation()}
        className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl" />
    </div>
  );
}

// ── 详情抽屉组件 ──────────────────────────────────────────────────────────────
function XhsDetailDrawer({ 
  post, 
  isOpen, 
  onClose, 
  loading,
  error,
  comments,
  commentsLoading,
  commentsError,
  onSaveToDb,
  onTestOss,
  savingToDb,
  testingOss,
  ossTestResults,
  saveMessage,
  savedPostId
}: {
  post: XhsPostData | null;
  isOpen: boolean;
  onClose: () => void;
  loading: boolean;
  error: string;
  comments: XhsComment[];
  commentsLoading: boolean;
  commentsError: string;
  onSaveToDb: (p: XhsPostData) => void;
  onTestOss: (p: XhsPostData) => void;
  savingToDb: boolean;
  testingOss: boolean;
  ossTestResults: OssTestResult[] | null;
  saveMessage: string;
  savedPostId: string | null;
}) {
  const [copiedKey, setCopiedKey] = useState('');
  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(''), 1500);
    });
  };

  const renderCopyBtn = (text: string, key: string, label: string) => (
    <button onClick={() => copy(text, key)}
      className="px-2 py-0.5 text-[10px] rounded border border-border hover:bg-muted transition-colors">
      {copiedKey === key ? '✓' : label}
    </button>
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* 遮罩层 */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity" onClick={onClose} />
      
      {/* 抽屉内容 (从右边弹出) */}
      <div className="relative ml-auto w-full max-w-xl bg-background border-l border-border shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between p-4 border-b border-border bg-card/50 backdrop-blur-md sticky top-0 z-10">
          <h2 className="font-bold text-base">笔记详情</h2>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors text-muted-foreground group">
            <span className="group-hover:rotate-90 transition-transform block">✕</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm">正在请求服务器解析...</p>
            </div>
          )}

          {error && (
              <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl text-red-600 dark:text-red-400 text-xs leading-relaxed">
              {error}
              </div>
            )}

          {post && !loading && (
            <div className="space-y-6 animate-in fade-in duration-500">
              {/* 作者 */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50">
                <img src={proxyImg(post.author.avatar)} alt="" className="w-12 h-12 rounded-full object-cover border-2 border-background" />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm truncate">{post.author.name}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-tight">作者</div>
                </div>
                <a href={`https://www.xiaohongshu.com/user/profile/${post.author.id}`} target="_blank" rel="noreferrer" className="text-xs px-3 py-1 bg-primary/10 text-primary rounded-full hover:bg-primary/20 transition">主页</a>
              </div>

              {/* 统计 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-card border border-border p-3 rounded-xl shadow-sm">
                <StatBadge value={post.stats.likes} label="点赞" />
                <StatBadge value={post.stats.collects} label="收藏" />
                <StatBadge value={post.stats.comments} label="评论" />
                <StatBadge value={post.stats.shares} label="分享" />
              </div>

              {/* 内容明细 */}
              <div className="space-y-4 text-sm">
                {post.title && (
                  <div className="group">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">标题</span>
                      {renderCopyBtn(post.title, 'drawer-title', '复制')}
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg font-medium leading-relaxed">{post.title}</div>
                  </div>
                )}

                <div className="group">
                  <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">正文</span>
                    {renderCopyBtn(post.desc, 'drawer-desc', '复制正文')}
                  </div>
                  <div className="p-3 bg-muted/30 rounded-lg text-muted-foreground leading-relaxed whitespace-pre-line text-xs max-h-[300px] overflow-y-auto">
                    {post.desc}
                  </div>
                </div>

                {post.tags.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 text-right">标签</div>
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      {post.tags.map(t => (
                        <span key={t} className="px-2 py-0.5 bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 text-[10px] rounded-md font-medium">#{t}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 资源预览 */}
              <div className="space-y-3">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">媒体资源</div>
                {post.images.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {post.images.map((img, idx) => (
                      <div key={idx} className="relative group rounded-lg overflow-hidden aspect-square bg-muted">
                        <img src={proxyImg(img.previewUrl)} alt="" className="w-full h-full object-cover" loading="lazy" />
                        <div className="absolute top-1 right-1 px-1.5 py-0.5 bg-black/60 text-white text-[9px] rounded-md backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">#{idx+1}</div>
                      </div>
                    ))}
                  </div>
                )}
                {post.video?.url && (
                  <div className="rounded-xl overflow-hidden border border-border bg-black shadow-lg">
                    <video src={post.video.url} controls className="w-full" preload="metadata" />
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">评论</div>
                  <div className="text-[10px] text-muted-foreground">{comments.length} 条</div>
                </div>

                {commentsLoading && (
                  <div className="p-3 rounded-lg bg-muted/30 text-xs text-muted-foreground">
                    正在加载评论...
                  </div>
                )}

                {!commentsLoading && commentsError && (
                  <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                    {commentsError}
                  </div>
                )}

                {!commentsLoading && !commentsError && comments.length === 0 && (
                  <div className="p-3 rounded-lg bg-muted/30 text-xs text-muted-foreground">
                    暂无评论数据
                  </div>
                )}

                {comments.length > 0 && (
                  <div className="space-y-2">
                    {comments.map((comment, idx) => (
                      <div key={comment.id || `${comment.nickname}-${idx}`} className="rounded-xl border border-border bg-card p-3">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full overflow-hidden bg-muted flex-shrink-0">
                            {comment.avatar ? (
                              <img src={proxyImg(comment.avatar)} alt={comment.nickname} className="w-full h-full object-cover" />
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-semibold truncate">{comment.nickname}</div>
                              <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                                赞 {comment.likeCount}
                                {comment.subCommentCount > 0 ? ` · 回复 ${comment.subCommentCount}` : ''}
                              </div>
                            </div>
                            <div className="text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
                              {comment.content || '（空评论）'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 底部操作页脚 */}
        {post && (
          <div className="p-4 border-t border-border bg-card/50 backdrop-blur-md space-y-3">
             <div className="flex gap-2">
                <button onClick={() => onTestOss(post)} disabled={testingOss || savingToDb}
                  className="flex-1 py-3 bg-zinc-100 dark:bg-zinc-800 text-foreground border border-border rounded-xl text-xs font-bold hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all disabled:opacity-50">
                  {testingOss ? '测试中...' : '测试 OSS'}
                </button>
                <button onClick={() => onSaveToDb(post)} disabled={savingToDb || testingOss}
                  className="flex-1 py-3 bg-rose-500 text-white rounded-xl text-xs font-bold hover:bg-rose-600 transition-all shadow-md shadow-rose-500/20 disabled:opacity-50">
                  {savingToDb ? '保存中...' : '保存到素材库'}
                </button>
              </div>
              
              {(saveMessage || ossTestResults) && (
                 <div className="text-[10px] text-center text-muted-foreground whitespace-pre-wrap px-2">
                   {saveMessage && <div>{saveMessage}</div>}
                   {savedPostId && (
                      <div className="mt-2 flex gap-1 justify-center">
                        <a href={`/content-library/detail?id=${savedPostId}`} className="text-primary hover:underline">查看库详情</a>
                        <span>|</span>
                        <a href="/content-library" className="text-primary hover:underline">去素材库</a>
                      </div>
                   )}
                 </div>
              )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────────
export default function XhsPage() {
  const [activeTab, setActiveTab] = useState<'discover' | 'spy' | 'parse'>('discover');
  const [cookieSet, setCookieSet] = useState(false);
  const [cookieChecking, setCookieChecking] = useState(true);
  const [cookieDrawerOpen, setCookieDrawerOpen] = useState(false);
  const [density, setDensity] = useState<'compact' | 'comfortable'>('compact');
  const [url, setUrl] = useState('');
  const [spyUserId, setSpyUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [post, setPost] = useState<XhsPostData | null>(null);
  const [comments, setComments] = useState<XhsComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState('');

  // 抽屉状态
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [savingToDb, setSavingToDb] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [savedPostId, setSavedPostId] = useState<string | null>(null);
  const [testingOss, setTestingOss] = useState(false);
  const [ossTestResults, setOssTestResults] = useState<OssTestResult[] | null>(null);

  const loadComments = async (postData: XhsPostData) => {
    setComments([]);
    setCommentsError('');

    const xsecToken = extractXsecToken(postData.postUrl);
    if (!xsecToken) {
      setCommentsError('当前链接里没有 xsec_token，评论接口暂时无法稳定拉取');
      return;
    }

    setCommentsLoading(true);
    try {
      const res = await fetch('/api/analysis/xhs/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteId: postData.noteId,
          xsecToken,
        }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error ?? '评论加载失败');
      setComments(d.data?.comments ?? []);
    } catch (e) {
      setCommentsError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommentsLoading(false);
    }
  };

  const analyze = async (targetUrl?: string) => {
    const finalUrl = targetUrl || url;
    if (!finalUrl.trim()) return;
    
    // 如果是从搜索/侦测跳过来的，先开抽屉
    if (targetUrl) {
      setDrawerOpen(true);
    }

    setLoading(true); setError(''); setPost(null); setSaveMessage(''); setSavedPostId(null);
    setComments([]); setCommentsError(''); setCommentsLoading(false);
    try {
      const res = await fetch('/api/analysis/xhs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: finalUrl.trim() }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error ?? '解析失败');
      setPost(d.data);
      loadComments(d.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const saveToDatabase = async (postData: XhsPostData) => {
    if (!postData) return;
    setSavingToDb(true);
    setSaveMessage('');
    setSavedPostId(null);
    try {
      const res = await fetch('/api/content/save/xhs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteData: postData, originalUrl: url.trim() || postData.postUrl, comments }),
      });
      const result = await res.json();
      if (result.success) {
        setSaveMessage('✅ ' + result.data.message);
        setSavedPostId(result.data.post?.id || null);
      } else {
        setSaveMessage('❌ ' + (result.error || '保存失败'));
      }
    } catch {
      setSaveMessage('❌ 保存失败');
    } finally {
      setSavingToDb(false);
    }
  };

  const testOssUpload = async (postData: XhsPostData) => {
    const imageList = (postData as XhsPostData & { imageList?: OssCandidateImage[] }).imageList || postData.images || [];
    if (imageList.length === 0) return;
    setTestingOss(true);
    setOssTestResults(null);
    try {
      const imageUrls = imageList
        .map((img) => {
          const item = img as OssCandidateImage;
          return item.previewUrl || item.originalUrl || item.urlDefault || item.url;
        })
        .filter((url): url is string => Boolean(url));
      const res = await fetch('/api/content/test-oss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrls }),
      });
      const d = await res.json();
      const results: OssTestResult[] = Array.isArray(d.results) ? d.results : [];
      setOssTestResults(results);
      setSaveMessage(`🧪 测试完成：${results.filter((result) => result.ossUrl).length} 成功`);
    } catch {
      setSaveMessage('❌ OSS 测试异常');
    } finally {
      setTestingOss(false);
    }
  };

  const handleSelectNote = (fullUrl: string) => {
    // 核心更改：不再切换 Tab，不更新 URL 输入框，直接执行解析逻辑并开抽屉
    analyze(fullUrl);
  };

  const handleSpyUser = (userId: string) => {
    setSpyUserId(userId);
    setActiveTab('spy');
  };

  // 页面级“自动登录自检/自动打开登录抽屉”，避免每次都手动点“去登录”
  const loginAutoOpenedRef = useRef(false);
  const refreshCookieValidity = useCallback(async () => {
    try {
      const status = await requestCookieStatus().catch(() => ({ set: false } as CookieStatus));
      const valid = status.set ? await requestLoginValidity().catch(() => false) : false;
      setCookieSet(valid);
      return { status, valid };
    } finally {
      setCookieChecking(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await refreshCookieValidity();
      if (!alive) return;

      // 未登录：自动打开一次登录抽屉（本次会话只打开一次，避免打扰）
      if (!result.valid && typeof window !== 'undefined') {
        const key = 'xhs_login_drawer_auto_opened_v1';
        const opened = window.sessionStorage.getItem(key) === '1';
        if (!opened && !loginAutoOpenedRef.current) {
          loginAutoOpenedRef.current = true;
          window.sessionStorage.setItem(key, '1');
          setCookieDrawerOpen(true);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [refreshCookieValidity]);

  // 同时在后台尝试读取浏览器插件凭证并自动注入登录
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let done = false;
    const handler = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.data?.type !== 'PLATFORM_CLIENT_ID' || event.data?.platform !== 'xhs') return;
      const clientId = typeof event.data?.clientId === 'string' ? event.data.clientId.trim() : '';
      if (!clientId || done) return;
      done = true;

      void (async () => {
        try {
          await fetch('/api/analysis/xhs/cookie', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId }),
          });
        } finally {
          await refreshCookieValidity();
        }
      })();
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
  }, [refreshCookieValidity]);

  return (
    <div className="relative min-h-screen">
      {/* 侧边内容详情抽屉 */}
      <XhsDetailDrawer 
        post={post}
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        loading={loading && drawerOpen}
        error={drawerOpen ? error : ''}
        comments={comments}
        commentsLoading={commentsLoading}
        commentsError={commentsError}
        onSaveToDb={saveToDatabase}
        onTestOss={testOssUpload}
        savingToDb={savingToDb}
        testingOss={testingOss}
        ossTestResults={ossTestResults}
        saveMessage={saveMessage}
        savedPostId={savedPostId}
      />

      <div className="flex flex-col gap-3 p-2 sm:p-4 max-w-[1560px] mx-auto pb-14">
        {/* 顶部单行工具条 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg sm:text-xl font-bold tracking-tight">小红书内容分析</h1>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-muted p-1 rounded-xl overflow-x-auto">
              <button onClick={() => setActiveTab('discover')} className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${activeTab === 'discover' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>热门/爆款</button>
              <button onClick={() => setActiveTab('spy')} className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${activeTab === 'spy' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>刺探博主</button>
              <button onClick={() => setActiveTab('parse')} className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${activeTab === 'parse' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>手工解析</button>
            </div>

            {(activeTab === 'discover' || activeTab === 'spy') && (
              <div className="flex items-center gap-1 bg-muted p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setDensity('compact')}
                  className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${density === 'compact' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  紧凑
                </button>
                <button
                  type="button"
                  onClick={() => setDensity('comfortable')}
                  className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${density === 'comfortable' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  舒适
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setCookieDrawerOpen(true)}
              className="px-3 py-2 rounded-xl border border-border bg-card hover:bg-muted transition text-xs font-semibold flex items-center gap-2"
            >
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${cookieChecking
                  ? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300'
                  : cookieSet
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                }`}
              >
                {cookieChecking ? '检查中...' : cookieSet ? '已登录' : '未登录'}
              </span>
              <span>登录设置</span>
            </button>
          </div>
        </div>

        <SideDrawer title="登录设置" isOpen={cookieDrawerOpen} onClose={() => setCookieDrawerOpen(false)}>
          <CookiePanel onStatusChange={(valid) => { setCookieSet(valid); setCookieChecking(false); }} />
        </SideDrawer>

        {/* 主内容区域 */}
        <div className="min-h-[400px]">
          {activeTab === 'parse' && (
            <div className="max-w-3xl mx-auto mt-4 space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
               <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (setDrawerOpen(true), analyze())}
                  placeholder="粘贴小红书帖子链接..."
                  className="flex-1 px-4 py-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 shadow-sm"
                />
                <button
                  onClick={() => { setDrawerOpen(true); analyze(); }}
                  disabled={loading || !url.trim() || !cookieSet}
                   className="px-6 py-3 w-full sm:w-auto bg-primary text-primary-foreground rounded-xl text-sm font-bold disabled:opacity-50 hover:shadow-lg hover:shadow-primary/20 transition-all"
                >
                  解析
                </button>
              </div>
                 {!cookieSet && (
                   <div className="text-xs text-rose-500 text-center">
                     请先完成登录后再进行解析，
                     <button type="button" onClick={() => setCookieDrawerOpen(true)} className="underline underline-offset-2 font-semibold">
                       去登录
                     </button>
                   </div>
                 )}
              
              {/* 如果是手动解析模式，且已拿到结果，也在抽屉外显示一份简略预览或直接开抽屉 */}
              {post && !drawerOpen && (
                <div className="p-4 border border-primary/20 bg-primary/5 rounded-xl flex items-center justify-between">
                   <div className="text-sm font-medium">已完成解析：{post.title || '无标题'}</div>
                    <button onClick={() => setDrawerOpen(true)} className="text-xs text-primary font-bold hover:underline">查看详情</button>
                 </div>
               )}
             </div>
          )}

          {activeTab === 'discover' && (
            cookieSet
              ? <XhsSearchTab onSelectNote={handleSelectNote} onSpyUser={handleSpyUser} density={density} />
              : <div className="py-12 text-center text-muted-foreground rounded-xl border border-dashed border-border bg-card">
                  请先完成登录设置
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setCookieDrawerOpen(true)}
                      className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition"
                    >
                      去登录
                    </button>
                  </div>
                </div>
          )}

          {activeTab === 'spy' && (
            cookieSet
              ? <XhsSpyTab onSelectNote={handleSelectNote} userId={spyUserId} density={density} />
              : <div className="py-12 text-center text-muted-foreground rounded-xl border border-dashed border-border bg-card">
                  请先完成登录设置
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setCookieDrawerOpen(true)}
                      className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition"
                    >
                      去登录
                    </button>
                  </div>
                </div>
          )}
        </div>
      </div>

      {/* Lightbox 浮层保持原有逻辑 */}
      {lightboxIdx !== null && post && (
        <Lightbox
          image={post.images[lightboxIdx]}
          onClose={() => setLightboxIdx(null)}
          onPrev={lightboxIdx > 0 ? () => setLightboxIdx(lightboxIdx - 1) : undefined}
          onNext={lightboxIdx < post.images.length - 1 ? () => setLightboxIdx(lightboxIdx + 1) : undefined}
        />
      )}
    </div>
  );
}
