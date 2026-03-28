'use client';

import { useState, useEffect, useCallback } from 'react';
import type { XhsPostData, XhsImage } from '@/lib/analysis/xhs-fetch';

type DownloadMode = 'local' | 'oss';

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

  // 书签脚本（插件模式：一键把 web_session 发到本服务）
  const bookmarklet = `javascript:(function(){var all=document.cookie.split(';').map(s=>s.trim());var ws=all.find(s=>s.startsWith('web_session='));if(!ws){alert('未找到 web_session Cookie，请确认已登录小红书');return;}fetch('${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:1007'}/api/analysis/xhs/cookie',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cookie:ws})}).then(r=>r.json()).then(d=>alert(d.ok?'✅ Cookie 已导入到解析工具':'❌ 导入失败: '+(d.error||'')));})();`;

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

      {/* 书签插件入口 */}
      <div className="border-t border-border pt-3">
        <p className="text-xs text-muted-foreground mb-2">
          或者使用书签脚本（将下方按钮拖到浏览器书签栏，在小红书页面点击即可自动导入）：
        </p>
        <a
          href={bookmarklet}
          draggable
          className="inline-block px-3 py-1.5 bg-rose-500 text-white text-xs rounded-lg cursor-grab select-none hover:bg-rose-600"
          onClick={e => e.preventDefault()}
        >
          📕 拖我到书签栏 → 在小红书点击导入 Cookie
        </a>
        <p className="text-xs text-muted-foreground mt-1.5">
          注：若 web_session 为 HttpOnly 则书签脚本无法读取，请改用手动复制方式。
        </p>
      </div>
    </div>
  );
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
      <img src={image.previewUrl} alt="" onClick={e => e.stopPropagation()}
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

  const [downloadMode, setDownloadMode] = useState<DownloadMode>('oss');
  const [ossPrefix, setOssPrefix] = useState('xhs');
  const [downloading, setDownloading] = useState(false);
  const [ossUrls, setOssUrls] = useState<string[]>([]);
  const [dlErrors, setDlErrors] = useState<string[]>([]);

  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [copiedKey, setCopiedKey] = useState('');
  const [savingToDb, setSavingToDb] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(''), 1500);
    });
  };

  const analyze = async () => {
    if (!url.trim()) return;
    setLoading(true); setError(''); setPost(null); setOssUrls([]); setDlErrors([]);
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
      } else {
        setSaveMessage('❌ ' + (result.error || '保存失败'));
      }
      
      // 清除消息
      setTimeout(() => setSaveMessage(''), 5000);
      
    } catch (error) {
      setSaveMessage('❌ 保存失败: ' + (error instanceof Error ? error.message : '未知错误'));
      setTimeout(() => setSaveMessage(''), 5000);
    } finally {
      setSavingToDb(false);
    }
  };

  const download = async () => {
    if (!post) return;
    const urls = post.images.map(i => i.originalUrl);
    if (post.video?.url) urls.push(post.video.url);
    if (!urls.length) return;

    setDownloading(true); setOssUrls([]); setDlErrors([]);
    try {
      if (downloadMode === 'oss') {
        const res = await fetch('/api/analysis/xhs/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls, mode: 'oss', ossPrefix }),
        });
        const d = await res.json();
        setOssUrls(d.ossUrls ?? []);
        setDlErrors(d.errors ?? []);
      } else {
        // 本地：通过代理端点逐个触发浏览器下载
        for (const imgUrl of urls) {
          const a = document.createElement('a');
          a.href = `/api/analysis/xhs/download?url=${encodeURIComponent(imgUrl)}`;
          a.download = '';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          await new Promise(r => setTimeout(r, 400));
        }
      }
    } catch (e) {
      setDlErrors([e instanceof Error ? e.message : String(e)]);
    } finally {
      setDownloading(false);
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
        <h1 className="text-xl font-semibold">小红书解析</h1>
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
                <img src={post.author.avatar} alt={post.author.name}
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
                    <img src={img.previewUrl} alt={`图片 ${img.index}`} loading="lazy"
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
              <div className="text-sm font-medium">下载</div>
              <div className="flex gap-5 text-sm">
                {(['local', 'oss'] as DownloadMode[]).map(m => (
                  <label key={m} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" value={m} checked={downloadMode === m}
                      onChange={() => setDownloadMode(m)} className="accent-primary" />
                    <span>{m === 'local' ? '💾 下载到本地' : '☁️ 上传 OSS'}</span>
                  </label>
                ))}
              </div>

              {downloadMode === 'oss' && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground shrink-0">OSS 路径前缀</span>
                  <input value={ossPrefix} onChange={e => setOssPrefix(e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    placeholder="xhs" />
                </div>
              )}

              <button onClick={download} disabled={downloading}
                className="w-full py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50 hover:opacity-90">
                {downloading ? '处理中...'
                  : downloadMode === 'oss'
                  ? `☁️ 上传全部到 OSS（${post.images.length + (post.video ? 1 : 0)} 个）`
                  : `💾 下载全部到本地（${post.images.length + (post.video ? 1 : 0)} 个）`}
              </button>
              
              <button onClick={() => saveToDatabase(post)} disabled={savingToDb}
                className="w-full py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50">
                {savingToDb ? '保存中...' : '💾 保存到数据库（用于AI训练）'}
              </button>
              
              {saveMessage && (
                <div className={`text-xs px-3 py-2 rounded-lg text-center ${
                  saveMessage.startsWith('✅') 
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                }`}>
                  {saveMessage}
                </div>
              )}

              {ossUrls.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">上传成功 {ossUrls.length} 个</span>
                    <button onClick={() => copy(ossUrls.join('\n'), 'oss-all')}
                      className="text-xs text-primary hover:underline">
                      {copiedKey === 'oss-all' ? '✓ 已复制' : '复制全部'}
                    </button>
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {ossUrls.map((u, i) => (
                      <div key={i} className="flex items-center gap-2 bg-muted rounded px-3 py-1.5">
                        <span className="text-xs truncate flex-1 font-mono">{u}</span>
                        <button onClick={() => copy(u, `oss-${i}`)} className="text-xs text-primary shrink-0">
                          {copiedKey === `oss-${i}` ? '✓' : '复制'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {dlErrors.length > 0 && (
                <div className="text-xs text-red-600 dark:text-red-400 space-y-0.5">
                  {dlErrors.map((e, i) => <div key={i}>{e}</div>)}
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
