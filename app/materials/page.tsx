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
          <h1 className="text-2xl font-bold">素材库</h1>
          <p className="mt-1 text-gray-400 text-sm">解析过的视频自动归档，点击可直接发布</p>
        </div>
        <button onClick={load} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">刷新</button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span className="w-4 h-4 border-2 border-gray-600 border-t-pink-500 rounded-full animate-spin" />
          加载中...
        </div>
      )}

      {!loading && materials.length === 0 && (
        <div className="text-center py-20 text-gray-600">
          <p className="text-lg mb-2">暂无素材</p>
          <p className="text-sm">解析视频后会自动保存到这里</p>
          <a href="/parse" className="inline-block mt-4 px-4 py-2 bg-pink-600 hover:bg-pink-500 rounded-lg text-sm text-white transition-colors">
            去解析视频
          </a>
        </div>
      )}

      <div className="space-y-3">
        {materials.map((m) => (
          <div key={m.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex gap-4">
            {/* Video thumbnail */}
            <div className="w-28 h-20 flex-shrink-0 bg-black rounded-lg overflow-hidden">
              <video src={m.ossUrl} className="w-full h-full object-cover" preload="metadata" muted />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-white truncate flex-1">{m.title || '（无标题）'}</p>
                <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs ${
                  m.platform === 'douyin' ? 'bg-pink-900 text-pink-400' :
                  m.platform === 'tiktok' ? 'bg-purple-900 text-purple-400' :
                  'bg-red-900 text-red-400'
                }`}>
                  {m.platform === 'douyin' ? '抖音' : m.platform === 'tiktok' ? 'TikTok' : '小红书'}
                </span>
              </div>

              <p className="text-xs text-gray-500 mt-1 truncate">{m.ossUrl}</p>

              <div className="flex items-center gap-3 mt-2">
                <span className="text-xs text-gray-600">{timeAgo(m.parsedAt)}</span>
                {m.publishedAt && (
                  <span className="text-xs text-green-600">
                    已发布 {timeAgo(m.publishedAt)}
                  </span>
                )}
              </div>

              <div className="flex gap-2 mt-3">
                <button onClick={() => handlePublish(m)}
                  className="px-3 py-1.5 bg-pink-600 hover:bg-pink-500 rounded-lg text-xs font-medium transition-colors">
                  发布到抖音
                </button>
                <a href={m.ossUrl} target="_blank" rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-300 transition-colors">
                  查看
                </a>
                {m.lastTaskId && (
                  <a href={`/publish?taskId=${m.lastTaskId}`}
                    className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs text-gray-400 transition-colors">
                    发布记录
                  </a>
                )}
                <button onClick={() => handleDelete(m.id)} disabled={deletingId === m.id}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-red-900 hover:text-red-400 rounded-lg text-xs text-gray-600 transition-colors disabled:opacity-50">
                  {deletingId === m.id ? '删除中...' : '删除'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
