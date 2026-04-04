'use client';

import { useState } from 'react';

interface NoteCard {
  id: string;
  xsec_token?: string;
  note_card: {
    display_title: string;
    type: string;
    liked_count: string | number; // JSON 中可能是字符串 "8835"
    cover: { url_default: string; height: number; width: number };
    user: { nickname: string; avatar: string; user_id?: string };
    interact_info?: { liked: boolean; liked_count: string | number };
  };
}

export default function XhsSearchTab({ 
  onSelectNote,
  onSpyUser 
}: { 
  onSelectNote?: (url: string) => void;
  onSpyUser?: (userId: string) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<NoteCard[]>([]);
  const [error, setError] = useState('');

  const handleSearch = async () => {
    if (!keyword.trim()) return;
    setLoading(true);
    setError('');
    setNotes([]);
    try {
      const res = await fetch('/api/analysis/xhs/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim() })
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error);
      
      // 核心修正：由于 Python 会原样返回小红书的响应，结构是 d.data.data.items
      const responseData = d.data?.data || d.data; // 兼容处理
      const items: NoteCard[] = (responseData?.items ?? []).filter((i: any) => i?.note_card);
      
      setNotes(items);
      if (items.length === 0) setError('没有搜到内容，换个关键词试试');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const formatLikes = (val: string | number) => {
    const num = typeof val === 'string' ? parseInt(val, 10) : val;
    if (isNaN(num)) return val;
    if (num >= 10000) return `${(num / 10000).toFixed(1)}w`;
    return num;
  };

  return (
    <div className="space-y-5">
      {/* 搜索栏 */}
      <div className="flex gap-2">
        <input
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="输入行业爆款关键词 (如: 穿搭 / 美食 / 程序员工具)"
          className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
        />
        <button
          onClick={handleSearch}
          disabled={loading || !keyword.trim()}
          className="px-6 py-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition min-w-[110px]"
        >
          {loading ? (
            <span className="flex items-center gap-2 justify-center">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              搜罗中
            </span>
          ) : '🔍 搜爆款'}
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-sm">{error}</div>
      )}

      {notes.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-3">找到 {notes.length} 篇相关笔记</p>
          {/* 瀑布流网格 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {notes.map((item) => {
              const card = item.note_card;
              const isVertical = (card.cover.height || 4) > (card.cover.width || 3);
              const likes = card.interact_info?.liked_count ?? card.liked_count ?? 0;
              return (
                <div
                  key={item.id}
                  className="group relative border border-border rounded-2xl overflow-hidden bg-card hover:shadow-xl transition-all duration-300 flex flex-col cursor-default"
                >
                  <div className="relative overflow-hidden bg-muted" style={{ aspectRatio: `${card.cover.width || 3}/${card.cover.height || 4}` }}>
                    <img
                      src={card.cover.url_default}
                      alt={card.display_title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading="lazy"
                    />
                    {card.type === 'video' && (
                      <span className="absolute top-2 right-2 bg-black/70 text-white text-[10px] font-bold px-2 py-0.5 rounded-full backdrop-blur-sm">🎬 视频</span>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-3 gap-2">
                      <button
                        onClick={() => {
                          const fullUrl = `https://www.xiaohongshu.com/explore/${item.id}?xsec_token=${item.xsec_token}&xsec_source=pc_feed`;
                          onSelectNote?.(fullUrl);
                        }}
                        className="w-full py-2 bg-white text-black rounded-xl text-xs font-bold hover:bg-gray-100 transition"
                      >
                        🚀 解析这篇
                      </button>
                      <button
                        onClick={() => onSpyUser?.(card.user.user_id || '')}
                        className="w-full py-2 bg-black/40 text-white backdrop-blur-md rounded-xl text-xs font-bold hover:bg-black/60 transition border border-white/10"
                      >
                        👁️ 刺探博主
                      </button>
                    </div>
                  </div>

                  <div className="p-2.5 flex flex-col gap-1.5 flex-1">
                    <p className="text-xs font-semibold line-clamp-2 leading-snug">{card.display_title || '(无标题)'}</p>
                    <div className="flex items-center gap-1.5 mt-auto">
                      <img
                        src={card.user.avatar}
                        className="w-4 h-4 rounded-full object-cover bg-muted flex-shrink-0"
                        loading="lazy"
                      />
                      <span className="text-[11px] text-muted-foreground truncate flex-1">{card.user.nickname}</span>
                      <span className="text-[11px] text-rose-500 font-semibold flex-shrink-0">
                        ♥ {formatLikes(likes)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && notes.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <span className="text-5xl">🔎</span>
          <p className="text-sm">输入关键词，一键扫描全网爆款笔记</p>
        </div>
      )}
    </div>
  );
}
