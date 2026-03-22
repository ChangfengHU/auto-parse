'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Material {
  id: string;
  platform: string;
  title: string;
  ossUrl: string;
  videoUrl: string;
  watermark?: boolean;
  parsedAt: number;
  publishedAt?: number;
  lastTaskId?: string;
}

function timeAgo(ts: number) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${Math.floor(diff / 86400)}天前`;
}

export default function MaterialsPage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/materials');
    const data = await res.json();
    setMaterials(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id: string) {
    setDeletingId(id);
    await fetch(`/api/materials?id=${id}`, { method: 'DELETE' });
    setMaterials(prev => prev.filter(m => m.id !== id));
    setDeletingId(null);
  }

  function handlePublish(m: Material) {
    router.push(`/publish?ossUrl=${encodeURIComponent(m.ossUrl)}&title=${encodeURIComponent(m.title)}`);
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">素材库</h1>
          <p className="mt-1 text-muted-foreground text-sm">解析过的视频自动归档，点击可直接发布</p>
        </div>
        <button onClick={load} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
          <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          刷新
        </button>
      </div>

      {loading && materials.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <span className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
          <p className="text-sm">正在加载素材...</p>
        </div>
      )}

      {!loading && materials.length === 0 && (
        <div className="text-center py-20 bg-card border border-dashed border-border rounded-2xl">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">📁</div>
          <p className="text-lg font-medium text-foreground mb-1">暂无素材</p>
          <p className="text-sm text-muted-foreground">解析视频后会自动保存到这里</p>
          <a href="/parse" className="inline-block mt-6 px-6 py-2 bg-primary text-white hover:bg-primary/90 rounded-xl text-sm font-semibold transition-all shadow-lg shadow-primary/20">
            去解析视频
          </a>
        </div>
      )}

      <div className="grid gap-4">
        {materials.map((m) => (
          <div key={m.id} className="group bg-card border border-border rounded-2xl p-4 flex gap-5 transition-all hover:shadow-xl hover:shadow-primary/5 hover:border-primary/20">
            {/* Video thumbnail */}
            <div className="w-32 h-20 flex-shrink-0 bg-black rounded-xl overflow-hidden shadow-inner relative group/thumb">
              <video src={m.ossUrl + '#t=1'} className="w-full h-full object-cover transition-transform group-hover/thumb:scale-105" preload="metadata" muted />
              <div className="absolute inset-0 bg-primary/10 opacity-0 group-hover/thumb:opacity-100 transition-opacity" />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground truncate flex-1">{m.title || '（无标题）'}</p>
                  <span className={`flex-shrink-0 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-tight uppercase ${
                    m.platform === 'douyin' ? 'bg-primary/10 text-primary' :
                    m.platform === 'tiktok' ? 'bg-indigo-500/10 text-indigo-500' :
                    'bg-orange-500/10 text-orange-500'
                  }`}>
                    {m.platform === 'douyin' ? '抖音' : m.platform === 'tiktok' ? 'TikTok' : '小红书'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 font-mono">
                  <span className="truncate flex-1 max-w-[200px]">{m.ossUrl}</span>
                  <span>·</span>
                  <span>{timeAgo(m.parsedAt)}</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 mt-3">
                <div className="flex gap-2">
                  <button onClick={() => handlePublish(m)}
                    className="px-4 py-1.5 bg-primary text-white hover:bg-primary/90 rounded-lg text-xs font-semibold transition-all shadow-md shadow-primary/10">
                    立即发布
                  </button>
                  <a href={m.ossUrl} target="_blank" rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-muted text-foreground hover:bg-border/50 rounded-lg text-xs font-semibold transition-colors">
                    预览
                  </a>
                  {m.lastTaskId && (
                    <a href={`/publish?taskId=${m.lastTaskId}`}
                      className="px-3 py-1.5 bg-muted text-muted-foreground/80 hover:text-foreground hover:bg-border/50 rounded-lg text-xs transition-colors">
                      发布记录
                    </a>
                  )}
                </div>
                <button onClick={() => handleDelete(m.id)} disabled={deletingId === m.id}
                  className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all disabled:opacity-30">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
