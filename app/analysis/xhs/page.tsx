'use client';

import { useState, useEffect, useCallback } from 'react';
import type { XhsPostData, XhsImage } from '@/lib/analysis/xhs-fetch';

// ── Cookie 管理区 ──────────────────────────────────────────────────────────────
function CookiePanel({ onStatusChange }: { onStatusChange: (set: boolean) => void }) {
  const [status, setStatus] = useState<{ set: boolean; preview?: string } | null>(null);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const refresh = useCallback(async () => {
    const res = await fetch('/api/analysis/xhs/cookie');
    const d = await res.json();
    setStatus(d);
    onStatusChange(d.set);
  }, [onStatusChange]);

  useEffect(() => { refresh(); }, [refresh]);

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
      if (d.ok) { setMsg('✅ 已保存'); setInput(''); await refresh(); }
      else setMsg('❌ ' + (d.error ?? '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    await fetch('/api/analysis/xhs/cookie', { method: 'DELETE' });
    setMsg('');
    await refresh();
  };



  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Cookie 设置</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          status?.set
            ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
            : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
        }`}>
          {status === null ? '检查中...' : status.set ? `✅ 已设置` : '⚠️ 未设置'}
        </span>
      </div>

      {status?.set && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono bg-muted px-2 py-1 rounded flex-1 truncate">{status.preview}</span>
          <button onClick={clear} className="text-red-500 hover:text-red-600 shrink-0">清除</button>
        </div>
      )}

      {/* 手动输入 */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          在小红书网页版登录后，打开 Chrome 开发者工具 → Application → Cookies → www.xiaohongshu.com，
          复制 <code className="bg-muted px-1 rounded">web_session</code> 的值粘贴到下方：
        </p>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()}
            placeholder="粘贴 web_session 值或完整 Cookie 字符串"
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono"
          />
          <button
            onClick={save}
            disabled={saving || !input.trim()}
            className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg disabled:opacity-50 hover:opacity-90"
          >
            {saving ? '...' : '保存'}
          </button>
        </div>
        {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
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

// ── 主页面 ────────────────────────────────────────────────────────────────────
export default function XhsPage() {
  const [cookieSet, setCookieSet] = useState(false);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [post, setPost] = useState<XhsPostData | null>(null);

  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [copiedKey, setCopiedKey] = useState('');
  const [savingToDb, setSavingToDb] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [savedPostId, setSavedPostId] = useState<string | null>(null);
  const [testingOss, setTestingOss] = useState(false);
  const [ossTestResults, setOssTestResults] = useState<{ url: string; ossUrl?: string; error?: string }[] | null>(null);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(''), 1500);
    });
  };

  const analyze = async () => {
    if (!url.trim()) return;
    setLoading(true); setError(''); setPost(null);
    try {
      const res = await fetch('/api/analysis/xhs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error ?? '解析失败');
      setPost(d.data);
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
      alert(`调试信息：\n\n` +
        `解析URL: ${d.debug.resolvedUrl}\n` +
        `HTML长度: ${d.debug.htmlLength}\n` +
        `找到脚本: ${d.debug.foundScript}\n` +
        `有初始状态: ${d.debug.hasInitialState}\n` +
        `状态字段: ${d.debug.initialStateKeys?.join(', ')}\n` +
        `noteDetailMap: ${d.debug.noteDetailMap}\n` +
        `noteData: ${d.debug.noteData}\n` +
        `PC Note: ${d.debug.pcNote ? JSON.stringify(d.debug.pcNote) : 'null'}\n` +
        `Mobile Note: ${d.debug.mobileNote ? JSON.stringify(d.debug.mobileNote) : 'null'}\n\n` +
        `详细信息请查看浏览器控制台（F12）`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      console.error('调试错误:', e);
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
        body: JSON.stringify({ 
          noteData: postData,
          originalUrl: url.trim()
        }),
      });
      
      const result = await res.json();
      
      if (result.success) {
        setSaveMessage('✅ ' + result.data.message);
        setSavedPostId(result.data.post?.id || null);
      } else {
        setSaveMessage('❌ ' + (result.error || '保存失败'));
      }
      
      // 清除消息（但保留ID用于跳转按钮）
      setTimeout(() => setSaveMessage(''), 5000);
      
    } catch (error) {
      setSaveMessage('❌ 保存失败: ' + (error instanceof Error ? error.message : '未知错误'));
      setTimeout(() => setSaveMessage(''), 5000);
    } finally {
      setSavingToDb(false);
    }
  };

  const testOssUpload = async (postData: XhsPostData) => {
    const imageList = (postData as any).imageList || postData.images || [];
    if (imageList.length === 0) {
      setOssTestResults([]);
      return;
    }
    setTestingOss(true);
    setOssTestResults(null);
    try {
      const imageUrls = imageList.map((img: any) => img.previewUrl || img.originalUrl || img.urlDefault || img.url).filter(Boolean);
      const res = await fetch('/api/content/test-oss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrls }),
      });
      const d = await res.json();
      setOssTestResults(d.results ?? []);
    } catch (e) {
      setOssTestResults([{ url: '', error: String(e) }]);
    } finally {
      setTestingOss(false);
    }
  };

  const CopyBtn = ({ text, k, label }: { text: string; k: string; label: string }) => (
    <button onClick={() => copy(text, k)}
      className="px-2.5 py-1 text-xs rounded border border-border hover:bg-muted transition-colors">
      {copiedKey === k ? '✓ 已复制' : label}
    </button>
  );

  return (
    <div className="flex flex-col gap-5 p-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">小红书内容解析</h1>
        <p className="text-sm text-muted-foreground mt-0.5">粘贴帖子链接，提取图文/视频及数据，纯 HTTP 无需打开浏览器</p>
      </div>

      {/* Cookie 管理 */}
      <CookiePanel onStatusChange={setCookieSet} />

      {/* 链接输入 */}
      <div className="flex gap-2">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && analyze()}
          placeholder="粘贴小红书帖子链接（支持 explore 直链、xhslink.com 短链）"
          className="flex-1 px-4 py-2.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          onClick={analyze}
          disabled={loading || !url.trim() || !cookieSet}
          className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50 hover:opacity-90 min-w-[80px]"
        >
          {loading ? '解析中...' : '分析'}
        </button>
        <button
          onClick={debugAnalyze}
          disabled={loading || !url.trim() || !cookieSet}
          className="px-4 py-2.5 bg-gray-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:opacity-90"
          title="调试：查看页面数据结构"
        >
          🐛
        </button>
      </div>

      {!cookieSet && (
        <p className="text-xs text-yellow-600 dark:text-yellow-400 -mt-3">请先在上方设置小红书 Cookie 后再解析</p>
      )}

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm dark:bg-red-950/30 dark:border-red-800 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground py-8 justify-center">
          <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          正在通过 HTTP 请求解析帖子...
        </div>
      )}

      {post && !loading && (
        <div className="grid grid-cols-[290px_1fr] gap-5 items-start">

          {/* 左栏：帖子信息 */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4 sticky top-6">
            <div className="flex items-center gap-3">
              {post.author.avatar && (
                <img src={proxyImg(post.author.avatar)} alt={post.author.name}
                  className="w-10 h-10 rounded-full object-cover border border-border" />
              )}
              <div>
                <div className="text-sm font-medium">{post.author.name}</div>
                <a href={`https://www.xiaohongshu.com/user/profile/${post.author.id}`}
                  target="_blank" rel="noreferrer"
                  className="text-xs text-primary hover:underline">查看主页</a>
              </div>
            </div>

            <div className="flex justify-around py-2.5 border-y border-border">
              <StatBadge icon="❤️" value={post.stats.likes} label="点赞" />
              <StatBadge icon="⭐" value={post.stats.collects} label="收藏" />
              <StatBadge icon="💬" value={post.stats.comments} label="评论" />
              <StatBadge icon="📤" value={post.stats.shares} label="分享" />
            </div>

            {post.title && (
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">标题</div>
                <div className="text-sm leading-relaxed">{post.title}</div>
                <CopyBtn text={post.title} k="title" label="复制标题" />
              </div>
            )}

            {post.desc && (
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">正文</div>
                <div className="text-sm leading-relaxed line-clamp-6 whitespace-pre-line">{post.desc}</div>
                <CopyBtn text={post.desc} k="desc" label="复制正文" />
              </div>
            )}

            {post.tags.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">话题标签</div>
                <div className="flex flex-wrap gap-1">
                  {post.tags.map(t => (
                    <span key={t} className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full">#{t}</span>
                  ))}
                </div>
                <CopyBtn text={post.tags.map(t => `#${t}`).join(' ')} k="tags" label="复制标签" />
              </div>
            )}

            {post.publishTime && (
              <div className="text-xs text-muted-foreground">发布：{post.publishTime}</div>
            )}

            <a href={post.postUrl} target="_blank" rel="noreferrer"
              className="block text-xs text-primary hover:underline">查看原帖 ↗</a>
          </div>

          {/* 右栏：图片 + 下载 */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-1 text-xs font-medium rounded-full border ${
                post.type === 'video'
                  ? 'bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-950/30 dark:border-purple-800 dark:text-purple-300'
                  : 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-300'
              }`}>
                {post.type === 'video' ? '🎬 视频' : `🖼️ 图文 · ${post.images.length} 张`}
              </span>
            </div>

            {post.images.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {post.images.map((img, idx) => (
                  <div key={idx} onClick={() => setLightboxIdx(idx)}
                    className="relative group cursor-pointer rounded-lg overflow-hidden border border-border bg-muted aspect-square">
                    <img src={proxyImg(img.previewUrl)} alt={`图片 ${img.index}`} loading="lazy"
                      className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-end justify-between p-2 opacity-0 group-hover:opacity-100">
                      <span className="text-white text-xs bg-black/50 rounded px-1.5 py-0.5">{img.index}</span>
                      {img.liveUrl && <span className="text-white text-xs bg-black/50 rounded px-1.5 py-0.5">Live</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {post.video?.url && (
              <div className="rounded-lg overflow-hidden border border-border bg-black">
                <video src={post.video.url} controls className="w-full max-h-[480px]" preload="metadata" />
              </div>
            )}

            {/* 下载区 */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-4">
              <div className="text-sm font-medium">保存</div>
              
              <div className="flex gap-2">
                <button onClick={() => testOssUpload(post)} disabled={testingOss || savingToDb}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50">
                  {testingOss ? '测试中...' : '🧪 测试OSS'}
                </button>
                <button onClick={() => saveToDatabase(post)} disabled={savingToDb || testingOss}
                  className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50">
                  {savingToDb ? '保存中...' : '💾 保存到素材库'}
                </button>
              </div>

              {ossTestResults && (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-foreground">OSS 测试结果</div>
                  {ossTestResults.length === 0 && (
                    <div className="text-xs text-muted-foreground">无图片</div>
                  )}
                  {ossTestResults.map((r, i) => (
                    <div key={i} className={`text-xs px-2.5 py-2 rounded-lg break-all ${r.ossUrl ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
                      {r.ossUrl ? (
                        <>图{i + 1} ✅ <a href={r.ossUrl} target="_blank" rel="noreferrer" className="underline">{r.ossUrl}</a></>
                      ) : (
                        <>图{i + 1} ❌ {r.error}</>
                      )}
                    </div>
                  ))}
                </div>
              )}
              
              {saveMessage && (
                <div className={`text-xs px-3 py-2 rounded-lg text-center ${
                  saveMessage.startsWith('✅') 
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                }`}>
                  {saveMessage}
                </div>
              )}

              {savedPostId && (
                <div className="flex gap-2">
                  <a 
                    href={`/content-library/detail?id=${savedPostId}`}
                    className="flex-1 py-2 px-3 bg-blue-600 text-white text-xs rounded-lg font-medium hover:bg-blue-700 transition-colors text-center"
                  >
                    📖 查看详情
                  </a>
                  <a 
                    href="/content-library"
                    className="flex-1 py-2 px-3 bg-purple-600 text-white text-xs rounded-lg font-medium hover:bg-purple-700 transition-colors text-center"
                  >
                    📚 作品素材库
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
