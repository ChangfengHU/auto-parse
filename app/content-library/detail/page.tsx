'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface SavedXhsPost {
  id: string;
  note_id: string;
  title: string;
  content?: string;
  author_name?: string;
  author_id?: string;
  author_avatar?: string;
  tags?: string[];
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  collect_count?: number;
  original_url?: string;
  location?: string;
  publish_time?: string;
  saved_at?: string;
  images?: { id?: string; original_url: string; oss_url?: string }[];
}

function proxyImg(url: string) {
  if (!url) return url;
  if (!url.includes('xhscdn.com') && !url.includes('xiaohongshu.com')) return url;
  return `/api/proxy/image?url=${encodeURIComponent(url)}`;
}

function formatPublishTime(t?: string | number | null) {
  if (!t) return null;
  const n = Number(t);
  const d = isNaN(n) ? new Date(t) : new Date(n);
  if (isNaN(d.getTime())) return String(t);
  return d.toLocaleString('zh-CN');
}

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

function Lightbox({ src, onClose, onPrev, onNext }: {
  src: string; onClose: () => void; onPrev?: () => void; onNext?: () => void;
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
      <img src={src} alt="" onClick={e => e.stopPropagation()}
        className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl" />
    </div>
  );
}

function DetailPageContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');

  const [post, setPost] = useState<SavedXhsPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [copiedKey, setCopiedKey] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) { setError('缺少作品ID'); setLoading(false); return; }
    fetch(`/api/content/list/xhs?id=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) setPost(d.data);
        else setError('作品不存在或已被删除');
      })
      .catch(e => setError('加载失败：' + e.message))
      .finally(() => setLoading(false));
  }, [id]);

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(''), 1500);
    });
  }

  async function handleDelete() {
    if (!post?.id || !confirm('确定要删除这个作品吗？')) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/content/delete/xhs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: post.id }),
      });
      const d = await res.json();
      if (d.success) window.history.back();
      else alert('删除失败：' + d.error);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-2">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <p className="text-red-500">{error ?? '作品不存在'}</p>
          <Link href="/content-library" className="text-sm text-primary hover:underline">返回素材库</Link>
        </div>
      </div>
    );
  }

  const images = post.images ?? [];
  const lightboxSrc = lightboxIdx !== null ? (images[lightboxIdx].oss_url || proxyImg(images[lightboxIdx].original_url)) : '';

  return (
    <div className="flex flex-col gap-5 p-6 max-w-6xl mx-auto">
      {/* 顶栏 */}
      <div className="flex items-center justify-between">
        <Link href="/content-library" className="text-sm text-primary hover:underline">← 返回素材库</Link>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors disabled:opacity-50"
        >
          {deleting ? '删除中...' : '🗑 删除'}
        </button>
      </div>

      {/* 主体：左右布局（与解析页一致） */}
      <div className="grid grid-cols-[290px_1fr] gap-5 items-start">

        {/* 左栏：帖子信息 */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4 sticky top-6">
          <div className="flex items-center gap-3">
            {post.author_avatar && (
              <img src={proxyImg(post.author_avatar)} alt={post.author_name ?? ''}
                className="w-10 h-10 rounded-full object-cover border border-border" />
            )}
            <div>
              <div className="text-sm font-medium">{post.author_name || '未知用户'}</div>
              {post.author_id && (
                <a href={`https://www.xiaohongshu.com/user/profile/${post.author_id}`}
                  target="_blank" rel="noreferrer"
                  className="text-xs text-primary hover:underline">查看主页</a>
              )}
            </div>
          </div>

          <div className="flex justify-around py-2.5 border-y border-border">
            <StatBadge icon="❤️" value={post.like_count ?? 0} label="点赞" />
            <StatBadge icon="⭐" value={post.collect_count ?? 0} label="收藏" />
            <StatBadge icon="💬" value={post.comment_count ?? 0} label="评论" />
            <StatBadge icon="📤" value={post.share_count ?? 0} label="分享" />
          </div>

          {post.title && (
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">标题</div>
              <div className="text-sm leading-relaxed">{post.title}</div>
              <button onClick={() => copy(post.title, 'title')}
                className="px-2.5 py-1 text-xs rounded border border-border hover:bg-muted transition-colors">
                {copiedKey === 'title' ? '✓ 已复制' : '复制标题'}
              </button>
            </div>
          )}

          {post.content && (
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">正文</div>
              <div className="text-sm leading-relaxed line-clamp-6 whitespace-pre-line">{post.content}</div>
              <button onClick={() => copy(post.content!, 'content')}
                className="px-2.5 py-1 text-xs rounded border border-border hover:bg-muted transition-colors">
                {copiedKey === 'content' ? '✓ 已复制' : '复制正文'}
              </button>
            </div>
          )}

          {post.tags && post.tags.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">话题标签</div>
              <div className="flex flex-wrap gap-1">
                {post.tags.map(t => {
                  const tag = typeof t === 'string' ? t : (t as any)?.name || String(t);
                  return (
                    <span key={tag} className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full">#{tag}</span>
                  );
                })}
              </div>
              <button onClick={() => copy(post.tags!.map(t => `#${typeof t === 'string' ? t : (t as any)?.name || t}`).join(' '), 'tags')}
                className="px-2.5 py-1 text-xs rounded border border-border hover:bg-muted transition-colors">
                {copiedKey === 'tags' ? '✓ 已复制' : '复制标签'}
              </button>
            </div>
          )}

          {post.publish_time && (
            <div className="text-xs text-muted-foreground">
              发布：{formatPublishTime(post.publish_time)}
            </div>
          )}

          {post.original_url && (
            <a href={post.original_url} target="_blank" rel="noreferrer"
              className="block text-xs text-primary hover:underline">查看原帖 ↗</a>
          )}
        </div>

        {/* 右栏：图片网格 */}
        <div className="space-y-4">
          <span className="px-2.5 py-1 text-xs font-medium rounded-full border bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-300">
            🖼️ 图文 · {images.length} 张
          </span>

          {images.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {images.map((img, idx) => (
                <div key={idx} onClick={() => setLightboxIdx(idx)}
                  className="relative group cursor-pointer rounded-lg overflow-hidden border border-border bg-muted aspect-square">
                  <img
                    src={img.oss_url || proxyImg(img.original_url)}
                    alt={`图片 ${idx + 1}`}
                    loading="lazy"
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-end justify-between p-2 opacity-0 group-hover:opacity-100">
                    <span className="text-white text-xs bg-black/50 rounded px-1.5 py-0.5">{idx + 1}</span>
                    {img.oss_url && <span className="text-white text-xs bg-green-600/80 rounded px-1.5 py-0.5">OSS</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-48 rounded-xl border border-border text-muted-foreground text-sm">
              暂无图片
            </div>
          )}
        </div>
      </div>

      {lightboxIdx !== null && (
        <Lightbox
          src={lightboxSrc}
          onClose={() => setLightboxIdx(null)}
          onPrev={lightboxIdx > 0 ? () => setLightboxIdx(i => i! - 1) : undefined}
          onNext={lightboxIdx < images.length - 1 ? () => setLightboxIdx(i => i! + 1) : undefined}
        />
      )}
    </div>
  );
}

export default function DetailPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <DetailPageContent />
    </Suspense>
  );
}
