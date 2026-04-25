'use client';

import { useState, useEffect } from 'react';

interface XhsAuthor {
  id: string;
  name: string;
  avatar: string;
  profileUrl?: string;
}

interface XhsImageResult {
  index: number;
  previewUrl: string;
  originalUrl: string;
  ossUrl?: string;
  liveUrl?: string;
  urlDefault?: string;
  urlPre?: string;
  width?: number;
  height?: number;
}

interface XhsNoteData {
  noteId: string;
  postUrl: string;
  resolvedUrl?: string;
  xsecToken?: string;
  title: string;
  desc: string;
  type: 'image' | 'video' | 'unknown';
  author: XhsAuthor;
  stats: {
    likes: number;
    comments: number;
    shares: number;
    collects: number;
  };
  tags: string[];
  publishTime: string;
  lastUpdateTime?: string;
  ipLocation?: string;
  coverUrl?: string;
  shareInfo?: unknown;
  images: XhsImageResult[];
  video?: {
    url: string;
    coverUrl?: string;
  };
}

interface Result {
  platform: string;
  mediaType?: 'video' | 'image';
  videoId: string;
  title: string;
  desc?: string;
  videoUrl: string;
  ossUrl: string;
  coverUrl?: string;
  images?: XhsImageResult[];
  imageCount?: number;
  liveCount?: number;
  ossPending?: boolean;
  savePending?: boolean;
  watermark?: boolean;
  noteData?: XhsNoteData;
}

type ContentSaveProgress = {
  type: 'progress' | 'done' | 'error';
  phase?: string;
  current?: number;
  total?: number;
  percent?: number;
  message?: string;
  error?: string;
  data?: {
    post?: { id?: string };
    message?: string;
  };
};

const STEPS = ['解析链接', '提取作品数据', '整理媒体资源', '生成预览'];

function detectPlatform(input: string): 'douyin' | 'xiaohongshu' | 'tiktok' | null {
  if (input.includes('douyin.com') || input.includes('v.douyin.com')) return 'douyin';
  if (input.includes('xiaohongshu.com') || input.includes('xhslink.com')) return 'xiaohongshu';
  if (input.includes('tiktok.com') || input.includes('vm.tiktok.com')) return 'tiktok';
  return null;
}

function proxyXhsImage(url?: string) {
  if (!url) return '';
  const normalized = url.startsWith('//') ? `https:${url}` : url.startsWith('http://') ? `https://${url.slice(7)}` : url;
  if (!normalized.includes('xhscdn.com') && !normalized.includes('xiaohongshu.com')) return normalized;
  return `/api/proxy/image?url=${encodeURIComponent(normalized)}`;
}

function formatStat(value: number | undefined) {
  const num = Number(value ?? 0);
  if (Math.abs(num) >= 10000) return `${(num / 10000).toFixed(1)}w`;
  return String(num);
}

function extractShareFlag(shareInfo: unknown) {
  if (!shareInfo || typeof shareInfo !== 'object') return '';
  const rec = shareInfo as Record<string, unknown>;
  if ('unShare' in rec) return `unShare=${String(rec.unShare)}`;
  return '';
}

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2 text-center">
      <div className="text-base font-bold text-foreground">{formatStat(value)}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

export default function ParsePage() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(-1);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [detectedPlatform, setDetectedPlatform] = useState<string | null>(null);
  const [materialSaving, setMaterialSaving] = useState(false);
  const [contentSaving, setContentSaving] = useState(false);
  const [contentSaveProgress, setContentSaveProgress] = useState<ContentSaveProgress | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  const [savedContentId, setSavedContentId] = useState('');

  useEffect(() => { setDetectedPlatform(detectPlatform(input)); }, [input]);

  async function handleParse() {
    if (!input.trim() || loading) return;
    const platform = detectPlatform(input);
    if (!platform) { setError('请输入有效的抖音、小红书或TikTok分享链接'); return; }
    setLoading(true); setError(''); setResult(null); setStep(0); setSaveMessage(''); setSavedContentId(''); setContentSaveProgress(null);
    const t1 = setTimeout(() => setStep(1), 800);
    const t2 = setTimeout(() => setStep(2), 2000);
    const t3 = setTimeout(() => setStep(3), 4000);
    try {
      const apiEndpoint = platform === 'tiktok' ? '/api/parse-tiktok' : '/api/parse';
      const res = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: input }),
      });
      const data = await res.json();
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      if (!res.ok || !data.success) {
        setError(data.error ?? '解析失败，请检查链接是否有效'); setStep(-1);
      } else {
        setStep(4); setResult(data);
      }
    } catch {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
      setError('网络请求失败，请检查网络连接'); setStep(-1);
    } finally {
      setLoading(false);
    }
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key); setTimeout(() => setCopied(null), 2000);
    });
  }

  async function saveXhsCoverToMaterials() {
    if (!result?.noteData || materialSaving) return;
    const note = result.noteData;
    const coverUrl = note.coverUrl || note.images?.[0]?.previewUrl || note.images?.[0]?.originalUrl || '';
    if (!coverUrl) {
      setSaveMessage('未找到可入库的封面/首图');
      return;
    }

    setMaterialSaving(true);
    setSaveMessage('');
    try {
      const res = await fetch('/api/materials/xhs-feed-covers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{
            id: note.noteId,
            xsec_token: note.xsecToken,
            note_card: {
              display_title: note.title,
              cover: {
                url_default: coverUrl,
                url: coverUrl,
              },
            },
          }],
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || '入库失败');
      setSaveMessage(`入库完成：新增 ${data.savedCount ?? 0}，已存在 ${data.skippedCount ?? 0}`);
    } catch (e) {
      setSaveMessage('入库失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setMaterialSaving(false);
    }
  }

  async function saveXhsToContentLibrary() {
    if (!result?.noteData || contentSaving) return;
    const note = result.noteData;
    setContentSaving(true);
    setSaveMessage('');
    setSavedContentId('');
    setContentSaveProgress({
      type: 'progress',
      phase: 'prepare',
      current: 0,
      total: Math.max(1, note.images.length + note.images.filter((image) => image.liveUrl).length + 1),
      percent: 0,
      message: '准备保存到作品素材库',
    });
    try {
      const res = await fetch('/api/content/save/xhs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteData: note,
          originalUrl: note.resolvedUrl || note.postUrl || input.trim(),
          comments: [],
          streamProgress: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '保存失败');
      }

      if (!res.body) {
        const data = await res.json();
        if (!data.success) throw new Error(data.error || '保存失败');
        setSavedContentId(String(data.data?.post?.id || ''));
        setSaveMessage(data.data?.message || '已保存到作品素材库');
        setContentSaveProgress({ type: 'done', percent: 100, message: data.data?.message || '保存完成' });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamError: Error | null = null;

      const handleLine = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as ContentSaveProgress;
        if (event.type === 'error') {
          streamError = new Error(event.error || '保存失败');
          setContentSaveProgress(event);
          return;
        }
        setContentSaveProgress(event);
        if (event.type === 'done') {
          setSavedContentId(String(event.data?.post?.id || ''));
          setSaveMessage(event.data?.message || event.message || '已保存到作品素材库');
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) handleLine(line);
          if (streamError) throw streamError;
        }
        if (done) break;
      }
      if (buffer.trim()) handleLine(buffer);
      if (streamError) throw streamError;
    } catch (e) {
      setSaveMessage('保存到素材库失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setContentSaving(false);
    }
  }

  const renderXhsResult = (data: Result) => {
    const note = data.noteData;
    if (!note) return null;
    const videoUrl = note.video?.url || data.videoUrl;
    const coverUrl = note.coverUrl || note.images?.[0]?.previewUrl || note.images?.[0]?.originalUrl || '';
    const shareFlag = extractShareFlag(note.shareInfo);
    const liveUrls = note.images.map((image) => image.liveUrl).filter((url): url is string => Boolean(url));

    return (
      <div className="mt-5 bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-border flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">小红书笔记详情</div>
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 text-[10px] font-semibold">
            已解析，待保存
          </span>
        </div>

        <div className="p-4 space-y-5">
          <div className="flex items-center gap-3 rounded-xl bg-muted/40 p-3">
            {note.author.avatar && (
              <img src={proxyXhsImage(note.author.avatar)} alt={note.author.name} className="h-12 w-12 rounded-full object-cover border border-border" />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-bold text-sm truncate">{note.author.name || '未知作者'}</div>
              <div className="text-[11px] text-muted-foreground truncate">{note.author.id}</div>
            </div>
            {note.author.profileUrl && (
              <a href={note.author.profileUrl} target="_blank" rel="noopener noreferrer" className="px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                主页
              </a>
            )}
          </div>

          <div className="grid grid-cols-4 gap-2">
            <StatCard value={note.stats.likes} label="点赞" />
            <StatCard value={note.stats.collects} label="收藏" />
            <StatCard value={note.stats.comments} label="评论" />
            <StatCard value={note.stats.shares} label="分享" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-muted/30 p-2"><span className="text-muted-foreground">作品ID：</span>{note.noteId}</div>
            <div className="rounded-lg bg-muted/30 p-2"><span className="text-muted-foreground">类型：</span>{note.type === 'video' ? '视频' : note.type === 'image' ? '图文' : '未知'}</div>
            <div className="rounded-lg bg-muted/30 p-2"><span className="text-muted-foreground">发布时间：</span>{note.publishTime || '-'}</div>
            <div className="rounded-lg bg-muted/30 p-2"><span className="text-muted-foreground">最后更新时间：</span>{note.lastUpdateTime || '-'}</div>
            <div className="rounded-lg bg-muted/30 p-2"><span className="text-muted-foreground">IP归属地：</span>{note.ipLocation || '-'}</div>
            <div className="rounded-lg bg-muted/30 p-2"><span className="text-muted-foreground">shareInfo：</span>{shareFlag || '-'}</div>
            <div className="sm:col-span-2 rounded-lg bg-muted/30 p-2 truncate"><span className="text-muted-foreground">xsecToken：</span>{note.xsecToken || '-'}</div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">标题</div>
              <button onClick={() => copy(note.title, 'xhs-title')} className="px-2 py-0.5 rounded border border-border text-[10px]">
                {copied === 'xhs-title' ? '已复制' : '复制'}
              </button>
            </div>
            <div className="rounded-xl bg-muted/30 p-3 text-sm font-medium leading-relaxed">{note.title || '无标题'}</div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">描述</div>
              <button onClick={() => copy(note.desc || '', 'xhs-desc')} className="px-2 py-0.5 rounded border border-border text-[10px]">
                {copied === 'xhs-desc' ? '已复制' : '复制正文'}
              </button>
            </div>
            <div className="rounded-xl bg-muted/30 p-3 text-xs text-muted-foreground leading-relaxed whitespace-pre-line">{note.desc || '无正文'}</div>
          </div>

          {note.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {note.tags.map((tag) => (
                <span key={tag} className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-300 text-[11px]">#{tag}</span>
              ))}
            </div>
          )}

          {coverUrl && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">封面地址</div>
              <div className="flex items-center gap-2 rounded-lg bg-muted p-2">
                <span className="text-xs text-blue-500 font-mono truncate flex-1">{coverUrl}</span>
                <button onClick={() => copy(coverUrl, 'xhs-cover')} className="px-2 py-1 rounded bg-background border border-border text-xs">
                  {copied === 'xhs-cover' ? '已复制' : '复制'}
                </button>
              </div>
            </div>
          )}

          {videoUrl && (
            <div className="space-y-2">
              <div className="rounded-xl overflow-hidden bg-black border border-border">
                <video src={videoUrl} poster={coverUrl ? proxyXhsImage(coverUrl) : undefined} controls playsInline className="w-full max-h-[520px] object-contain" preload="metadata" />
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-muted p-2">
                <span className="text-xs text-blue-500 font-mono truncate flex-1">{videoUrl}</span>
                <button onClick={() => copy(videoUrl, 'xhs-video')} className="px-2 py-1 rounded bg-background border border-border text-xs">
                  {copied === 'xhs-video' ? '已复制' : '复制'}
                </button>
              </div>
            </div>
          )}

          {note.images.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
                  图片资源 · {note.images.length} 张{liveUrls.length ? ` · 动图 ${liveUrls.length} 条` : ''}
                </div>
                <button onClick={() => copy(note.images.map((image) => image.originalUrl || image.previewUrl).join('\n'), 'xhs-images')} className="px-2 py-0.5 rounded border border-border text-[10px]">
                  {copied === 'xhs-images' ? '已复制' : '复制图片'}
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {note.images.map((image) => (
                  <div key={image.index} className="rounded-xl overflow-hidden border border-border bg-muted">
                    <a href={image.originalUrl || image.previewUrl} target="_blank" rel="noopener noreferrer">
                      <img src={proxyXhsImage(image.previewUrl || image.originalUrl)} alt={`xhs-image-${image.index}`} className="w-full aspect-square object-cover" loading="lazy" />
                    </a>
                    <div className="p-2 flex items-center justify-between gap-2 text-[10px]">
                      <span className="text-muted-foreground">#{image.index}</span>
                      {image.liveUrl && (
                        <a href={image.liveUrl} target="_blank" rel="noopener noreferrer" className="text-primary font-semibold">
                          动图 mp4
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {liveUrls.length > 0 && (
                <button onClick={() => copy(liveUrls.join('\n'), 'xhs-live')} className="w-full py-2 rounded-lg border border-border bg-muted/40 text-xs font-semibold">
                  {copied === 'xhs-live' ? '已复制全部动图地址' : '复制全部动图 mp4 地址'}
                </button>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <button onClick={saveXhsCoverToMaterials} disabled={materialSaving || contentSaving} className="flex-1 py-3 rounded-xl border border-border bg-background hover:bg-muted text-sm font-bold disabled:opacity-50">
              {materialSaving ? '入库中...' : '入库'}
            </button>
            <button onClick={saveXhsToContentLibrary} disabled={contentSaving || materialSaving} className="flex-1 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold shadow-md shadow-primary/10 disabled:opacity-50">
              {contentSaving ? `保存中 ${contentSaveProgress?.percent ?? 0}%` : '保存到素材库'}
            </button>
            <button onClick={() => { setResult(null); setError(''); setStep(-1); setSaveMessage(''); setSavedContentId(''); setContentSaveProgress(null); }} className="sm:w-28 py-3 rounded-xl text-muted-foreground hover:text-foreground text-sm">
              重新解析
            </button>
          </div>

          {contentSaveProgress && contentSaveProgress.type !== 'done' && (
            <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-foreground">{contentSaveProgress.message || '保存中'}</span>
                <span className="text-muted-foreground">
                  {contentSaveProgress.current ?? 0}/{contentSaveProgress.total ?? 1} · {contentSaveProgress.percent ?? 0}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-background overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, contentSaveProgress.percent ?? 0))}%` }}
                />
              </div>
            </div>
          )}

          {saveMessage && (
            <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground text-center">
              {saveMessage}
              {savedContentId && (
                <div className="mt-2">
                  <a href={`/content-library/detail?id=${savedContentId}`} className="text-primary font-semibold hover:underline">查看作品素材详情</a>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">视频解析</h1>
        <p className="mt-1 text-muted-foreground text-sm">支持抖音、TikTok、小红书，自动去水印并上传至 OSS</p>
      </div>

      {/* Platform Tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {(['抖音', '小红书', 'TikTok'] as const).map((p) => (
          <div key={p} className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
            (p === '抖音' && detectedPlatform === 'douyin') ||
            (p === '小红书' && detectedPlatform === 'xiaohongshu') ||
            (p === 'TikTok' && detectedPlatform === 'tiktok')
              ? 'bg-primary border-primary text-white shadow-sm shadow-primary/20'
              : 'bg-primary/20 border-primary/30 text-primary'
          }`}>{p}</div>
        ))}
        {['B站', '微博'].map((p) => (
          <div key={p} className="px-3 py-1 rounded-full text-xs font-medium border bg-muted border-border text-muted-foreground/60">
            {p} <span className="opacity-60 text-[10px]">即将支持</span>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="bg-card border border-border rounded-xl p-4 shadow-sm focus-within:ring-1 focus-within:ring-primary/20 transition-all">
        <textarea
          className="w-full bg-transparent resize-none text-sm text-foreground placeholder-muted-foreground outline-none leading-relaxed"
          rows={4}
          placeholder="粘贴抖音/小红书/TikTok 分享链接或文本..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
        />
        <div className="flex justify-between items-center mt-3">
          <button onClick={() => { setInput(''); setResult(null); setError(''); setStep(-1); }} disabled={loading}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors">清空</button>
          <button onClick={handleParse} disabled={loading || !input.trim()}
            className="px-6 py-2 bg-primary text-white hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground/50 disabled:cursor-not-allowed rounded-lg text-sm font-semibold transition-all shadow-lg shadow-primary/20">
            {loading ? '解析中...' : '开始解析'}
          </button>
        </div>
      </div>

      {/* Progress */}
      {loading && step >= 0 && (
        <div className="mt-5 bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-3">处理进度</p>
          <div className="space-y-2">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                  i < step ? 'bg-green-500 text-white' : i === step ? 'bg-primary text-white animate-pulse' : 'bg-muted text-muted-foreground/60'
                }`}>{i < step ? '✓' : i + 1}</div>
                <span className={`text-sm ${i < step ? 'text-green-500' : i === step ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <div className="mt-5 bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-500">{error}</div>}

      {/* Result */}
      {result && (
        result.platform === 'xiaohongshu' && result.noteData ? renderXhsResult(result) : (
        <div className="mt-5 bg-card border border-border rounded-xl p-4 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">ID: {result.videoId}</span>
            <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full uppercase tracking-wider ${
              result.ossPending
                ? 'bg-amber-500/10 text-amber-500'
                : 'bg-green-500/10 text-green-500'
            }`}>
              {result.ossPending ? 'OSS 后台保存中' : '素材库收录'}
            </span>
          </div>
          {result.title && (
            <p className="text-sm text-foreground font-medium border-b border-border pb-3 flex items-center gap-2">
              <span className="truncate">{result.title}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-primary/10 text-primary flex-shrink-0">
                {result.platform === 'tiktok' ? 'TikTok' : result.platform === 'douyin' ? '抖音' : '小红书'}
              </span>
            </p>
          )}
          {result.mediaType === 'image' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {(result.images || []).map((image) => (
                <a
                  key={image.index}
                  href={image.ossUrl || image.originalUrl || image.previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group rounded-xl overflow-hidden border border-border bg-muted"
                >
                  <img
                    src={image.ossUrl || image.previewUrl || image.originalUrl}
                    alt={`xhs-image-${image.index}`}
                    className="w-full aspect-square object-cover group-hover:scale-[1.02] transition-transform"
                  />
                </a>
              ))}
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden bg-black">
              <video src={result.ossUrl} controls playsInline className="w-full max-h-96 object-contain" preload="metadata" />
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground font-medium mb-1.5">
              {result.ossPending
                ? result.mediaType === 'image'
                  ? `预览图片地址（共 ${result.imageCount ?? result.images?.length ?? 1} 张，OSS 后台保存中）`
                  : '预览视频地址（OSS 后台保存中）'
                : result.mediaType === 'image'
                  ? `OSS 图片地址（共 ${result.imageCount ?? result.images?.length ?? 1} 张）`
                  : 'OSS 永久地址'}
            </p>
            <div className="flex items-center gap-2 bg-muted rounded-lg p-2.5">
              <span className="text-xs text-blue-500 flex-1 truncate font-mono">{result.ossUrl}</span>
              <button onClick={() => copy(result.ossUrl, 'oss')}
                className="flex-shrink-0 px-2.5 py-1 bg-background border border-border hover:bg-muted rounded text-xs transition-colors shadow-sm">
                {copied === 'oss' ? '✓ 已复制' : '复制'}
              </button>
            </div>
          </div>
          <div className="flex gap-2 pt-1 flex-wrap">
            <a href={result.ossUrl} download target="_blank" rel="noopener noreferrer"
              className="flex-1 py-2 bg-primary text-white hover:bg-primary/90 rounded-lg text-xs font-semibold text-center transition-all shadow-md shadow-primary/10">
              {result.mediaType === 'image' ? '下载首图' : '下载视频'}
            </a>
            {result.mediaType === 'image' && result.images && result.images.length > 1 && (
              <button
                onClick={() => copy(result.images!.map((image) => image.ossUrl || image.originalUrl || image.previewUrl).join('\n'), 'all-images')}
                className="flex-1 py-2 bg-muted border border-border hover:bg-border/50 rounded-lg text-xs font-semibold text-center text-foreground transition-all"
              >
                {copied === 'all-images' ? '✓ 已复制' : '复制全部图片'}
              </button>
            )}
            <a href="/publish" className="flex-1 py-2 bg-muted border border-border hover:bg-border/50 rounded-lg text-xs font-semibold text-center text-foreground transition-all">
              去发布
            </a>
            <button onClick={() => { setResult(null); setError(''); setStep(-1); }}
              className="flex-1 py-2 text-muted-foreground hover:text-foreground text-xs transition-colors">
              重新解析
            </button>
          </div>
        </div>
        )
      )}
    </div>
  );
}
