'use client';

import { useState, useEffect, useCallback } from 'react';
import type { XhsPostData, XhsImage } from '@/lib/analysis/xhs-fetch';
import XhsSearchTab from '@/components/xhs/XhsSearchTab';
import XhsSpyTab from '@/components/xhs/XhsSpyTab';
import XhsFeedTab from '@/components/xhs/XhsFeedTab';

interface CookieStatus {
  set: boolean;
  preview?: string;
}

let initialCookieStatusCache: CookieStatus | null = null;
let initialCookieStatusPromise: Promise<CookieStatus> | null = null;

async function requestCookieStatus(): Promise<CookieStatus> {
  const res = await fetch('/api/analysis/xhs/cookie');
  return res.json();
}

// ── Cookie 管理区 ──────────────────────────────────────────────────────────────
function CookiePanel({ onStatusChange }: { onStatusChange: (set: boolean) => void }) {
  const [status, setStatus] = useState<CookieStatus | null>(null);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [showInput, setShowInput] = useState(false);

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

    setStatus(d);
    onStatusChange(d.set);
    if (d.set) setShowInput(false);
  }, [onStatusChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    if (!input.trim()) return;
    setSaving(true);
    setMsg('');
    try {
      const res = await fetch('/api/analysis/xhs/cookie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie: input.trim() }),
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
    if (!confirm('确定要清除已保存的 Cookie 吗？')) return;
    await fetch('/api/analysis/xhs/cookie', { method: 'DELETE' });
    setMsg('');
    await refresh({ force: true });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">Cookie 设置</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
            status?.set
              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
          }`}>
            {status === null ? '检查中...' : status.set ? `✅ 已设置` : '⚠️ 未设置'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {status?.set && (
            <button 
              onClick={() => setShowInput(!showInput)} 
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
        </div>
      )}

      {/* 手动输入区：未设置时，或手动点击重新设置时显示 */}
      {(!status?.set || showInput) && (
        <div className="space-y-2 pt-1 animate-in fade-in slide-in-from-top-1 duration-200">
          <p className="text-xs text-muted-foreground">
            在小红书网页版登录后，打开 Chrome 开发者工具 → Application → Cookies → www.xiaohongshu.com，
            复制 <code className="bg-muted px-1 rounded">web_session</code> 的值粘贴到下方：
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && save()}
              placeholder="粘贴 web_session 值或完整 Cookie 字符串"
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
          {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
        </div>
      )}
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
function StatBadge({ icon, value, label }: { icon: string; value: number; label: string }) {
  const fmt = (n: number) => n >= 10000 ? `${(n / 10000).toFixed(1)}w` : String(n);
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-base">{icon}</span>
      <span className="text-sm font-semibold">{fmt(value)}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
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
      
      {/* 抽屉内容 (从左边弹出) */}
      <div className="relative w-full max-w-md bg-background border-r border-border shadow-2xl flex flex-col h-full animate-in slide-in-from-left duration-300">
        <div className="flex items-center justify-between p-4 border-b border-border bg-card/50 backdrop-blur-md sticky top-0 z-10">
          <h2 className="font-bold text-base flex items-center gap-2">🚀 笔记深度解析</h2>
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
              ⚠️ {error}
            </div>
          )}

          {post && !loading && (
            <div className="space-y-6 animate-in fade-in duration-500">
              {/* 作者 */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/50">
                <img src={proxyImg(post.author.avatar)} className="w-12 h-12 rounded-full object-cover border-2 border-background" />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm truncate">{post.author.name}</div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-tight">Author</div>
                </div>
                <a href={`https://www.xiaohongshu.com/user/profile/${post.author.id}`} target="_blank" rel="noreferrer" className="text-xs px-3 py-1 bg-primary/10 text-primary rounded-full hover:bg-primary/20 transition">主页</a>
              </div>

              {/* 统计 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-card border border-border p-3 rounded-xl shadow-sm">
                <StatBadge icon="❤️" value={post.stats.likes} label="点赞" />
                <StatBadge icon="⭐" value={post.stats.collects} label="收藏" />
                <StatBadge icon="💬" value={post.stats.comments} label="评论" />
                <StatBadge icon="📤" value={post.stats.shares} label="分享" />
              </div>

              {/* 内容明细 */}
              <div className="space-y-4 text-sm">
                {post.title && (
                  <div className="group">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Title</span>
                      {renderCopyBtn(post.title, 'drawer-title', '复制')}
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg font-medium leading-relaxed">{post.title}</div>
                  </div>
                )}

                <div className="group">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Description</span>
                    {renderCopyBtn(post.desc, 'drawer-desc', '复制正文')}
                  </div>
                  <div className="p-3 bg-muted/30 rounded-lg text-muted-foreground leading-relaxed whitespace-pre-line text-xs max-h-[300px] overflow-y-auto">
                    {post.desc}
                  </div>
                </div>

                {post.tags.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 text-right">Topics</div>
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
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Media Assets</div>
                {post.images.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {post.images.map((img, idx) => (
                      <div key={idx} className="relative group rounded-lg overflow-hidden aspect-square bg-muted">
                        <img src={proxyImg(img.previewUrl)} className="w-full h-full object-cover" loading="lazy" />
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
                  <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Comments</div>
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
                                👍 {comment.likeCount}
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
                  {testingOss ? '🧪 测试中...' : '🧪 测试OSS'}
                </button>
                <button onClick={() => onSaveToDb(post)} disabled={savingToDb || testingOss}
                  className="flex-1 py-3 bg-rose-500 text-white rounded-xl text-xs font-bold hover:bg-rose-600 transition-all shadow-md shadow-rose-500/20 disabled:opacity-50">
                  {savingToDb ? '💾 保存中...' : '💾 保存到库'}
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
  const [activeTab, setActiveTab] = useState<'feed' | 'search' | 'spy' | 'parse'>('feed');
  const [cookieSet, setCookieSet] = useState(false);
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

  const debugAnalyze = async () => {
    if (!url.trim()) return;
    setLoading(true); setError(''); 
    try {
      const res = await fetch('/api/analysis/xhs/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error ?? '调试失败');
      console.log('=== 小红书调试信息 ===', d.debug);
      alert(`调试详细信息请查看浏览器控制台（F12）`);
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
    } catch (error) {
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

      <div className="flex flex-col gap-5 p-4 sm:p-6 max-w-6xl mx-auto pb-20">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">小红书内容中枢 <span className="text-sm font-normal text-muted-foreground ml-2 opacity-60">XHS Matrix</span></h1>
            <p className="text-sm text-muted-foreground mt-1">全网爆款扫描器 · 竞品博主雷达 · 极速无头解析</p>
          </div>
           <div className="flex items-center gap-1 bg-muted p-1 rounded-xl overflow-x-auto">
            <button onClick={() => setActiveTab('feed')} className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${activeTab === 'feed' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>发现热门</button>
            <button onClick={() => setActiveTab('search')} className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${activeTab === 'search' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>🚀 搜爆款</button>
            <button onClick={() => setActiveTab('spy')} className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${activeTab === 'spy' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>🔍 刺探博主</button>
            <button onClick={() => setActiveTab('parse')} className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${activeTab === 'parse' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>手工解析</button>
          </div>
        </div>

        {/* Cookie 管理层 */}
        <CookiePanel onStatusChange={setCookieSet} />

        {/* 主内容区域 */}
        <div className="min-h-[400px]">
          {activeTab === 'parse' && (
            <div className="max-w-2xl mx-auto mt-10 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
               <div className="text-center space-y-2 mb-8">
                 <div className="text-4xl">🔗</div>
                 <h2 className="text-lg font-bold">粘贴链接即刻开始</h2>
                 <p className="text-sm text-muted-foreground">支持解析视频、图文、直播及短链接</p>
               </div>
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
              {!cookieSet && <p className="text-xs text-rose-500 text-center">⚠️ 请先配置下方 Cookie 才能进行解析</p>}
              
              {/* 如果是手动解析模式，且已拿到结果，也在抽屉外显示一份简略预览或直接开抽屉 */}
              {post && !drawerOpen && (
                <div className="p-4 border border-primary/20 bg-primary/5 rounded-xl flex items-center justify-between">
                   <div className="text-sm font-medium">已完成解析：{post.title || '无标题'}</div>
                   <button onClick={() => setDrawerOpen(true)} className="text-xs text-primary font-bold hover:underline">重新打开抽屉</button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'feed' && (
            cookieSet ? <XhsFeedTab onSelectNote={handleSelectNote} onSpyUser={handleSpyUser} /> : <div className="py-20 text-center text-muted-foreground">请先设置 Cookie</div>
          )}

          {activeTab === 'search' && (
            cookieSet ? <XhsSearchTab onSelectNote={handleSelectNote} onSpyUser={handleSpyUser} /> : <div className="py-20 text-center text-muted-foreground">请先设置 Cookie</div>
          )}

          {activeTab === 'spy' && (
            cookieSet ? <XhsSpyTab onSelectNote={handleSelectNote} userId={spyUserId} /> : <div className="py-20 text-center text-muted-foreground">请先设置 Cookie</div>
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
