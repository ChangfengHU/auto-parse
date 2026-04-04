'use client';

import { useState, useEffect } from 'react';

interface NoteCard {
  id: string;
  xsec_token?: string;
  note_card: {
    display_title: string;
    type: string;
    liked_count: string | number;
    cover: { 
      url?: string; 
      url_default?: string; 
      height: number; 
      width: number;
      info_list?: Array<{ url: string; image_scene?: string }>;
    };
    user: { nickname: string; avatar: string; user_id?: string };
    interact_info?: { liked_count: string | number };
  };
}

let initialFeedCache: NoteCard[] | null = null;
let initialFeedPromise: Promise<NoteCard[]> | null = null;

async function requestFeedItems(): Promise<NoteCard[]> {
  const res = await fetch('/api/analysis/xhs/feed');
  const d = await res.json();
  if (!d.ok) throw new Error(d.error);

  return (d.data?.data?.items ?? []).filter((i: any) => i?.note_card);
}

export default function XhsFeedTab({ 
  onSelectNote,
  onSpyUser 
}: { 
  onSelectNote?: (url: string) => void;
  onSpyUser?: (userId: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<NoteCard[]>([]);
  const [error, setError] = useState('');

  const fetchFeed = async (options?: { force?: boolean }) => {
    setLoading(true);
    setError('');
    try {
      const items = await (async () => {
        if (options?.force) {
          const nextItems = await requestFeedItems();
          initialFeedCache = nextItems;
          return nextItems;
        }

        if (initialFeedCache) return initialFeedCache;

        if (!initialFeedPromise) {
          initialFeedPromise = requestFeedItems()
            .then((nextItems) => {
              initialFeedCache = nextItems;
              return nextItems;
            })
            .finally(() => {
              initialFeedPromise = null;
            });
        }

        return initialFeedPromise;
      })();

      setNotes(items);
      if (items.length === 0) setError('暂时没有热门推荐，请检查 Cookie 是否过期');
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchFeed(); }, []);

  const formatLikes = (val: string | number) => {
    const num = typeof val === 'string' ? parseInt(val, 10) : val;
    if (isNaN(num)) return val;
    return num >= 10000 ? `${(num / 10000).toFixed(1)}w` : num;
  };

  const getCoverUrl = (cover: any) => {
    if (cover.url_default) return cover.url_default;
    if (cover.url) return cover.url;
    if (cover.info_list && cover.info_list.length > 0) {
      // 优先找带 WM 或较大尺寸的
      const best = cover.info_list.find((i: any) => i.image_scene?.includes('WM')) || cover.info_list[cover.info_list.length - 1];
      return best.url;
    }
    return '';
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-700">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">根据您的兴趣实时推荐，挖掘当下全网最热内容</p>
        <button 
          onClick={() => void fetchFeed({ force: true })} 
          disabled={loading}
          className="text-xs px-3 py-1 bg-muted hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition"
        >
          {loading ? '刷新中...' : '🔄 换一批'}
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-xl text-red-600 dark:text-red-400 text-sm">
          ⚠️ {error}
        </div>
      )}

      {notes.length > 0 && (
         <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {notes.map((item) => {
              const card = item.note_card;
              const likes = card.interact_info?.liked_count ?? card.liked_count ?? 0;
              return (
                <div key={item.id} className="group relative border border-border rounded-2xl overflow-hidden bg-card hover:shadow-xl transition-all duration-300 flex flex-col">
                  <div className="relative overflow-hidden bg-muted" style={{ aspectRatio: `${card.cover.width || 3}/${card.cover.height || 4}` }}>
                    <img 
                      src={getCoverUrl(card.cover)} 
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                      loading="lazy" 
                      alt={card.display_title}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-2 gap-1.5">
                      <button
                        onClick={() => {
                          const fullUrl = `https://www.xiaohongshu.com/explore/${item.id}?xsec_token=${item.xsec_token}&xsec_source=pc_feed`;
                          onSelectNote?.(fullUrl);
                        }}
                        className="w-full py-1.5 bg-rose-500 text-white rounded-lg text-xs font-bold hover:bg-rose-600 transition"
                      >
                        🚀 深度解析
                      </button>
                      <button
                        onClick={() => onSpyUser?.(card.user.user_id || '')}
                        className="w-full py-1.5 bg-white/20 text-white backdrop-blur-md rounded-lg text-xs font-bold hover:bg-white/30 transition border border-white/20"
                      >
                        👁️ 刺探博主
                      </button>
                    </div>
                  </div>
                  <div className="p-2.5 flex flex-col gap-1.5 flex-1">
                    <p className="text-xs font-semibold line-clamp-2 leading-snug">{card.display_title || '(无标题)'}</p>
                    <div className="flex items-center gap-1.5 mt-auto">
                      <img src={card.user.avatar} className="w-3.5 h-3.5 rounded-full object-cover bg-muted" />
                      <span className="text-[10px] text-muted-foreground truncate flex-1">{card.user.nickname}</span>
                      <span className="text-[10px] text-rose-500 font-semibold flex-shrink-0">♥ {formatLikes(likes)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
         </div>
      )}

      {loading && notes.length === 0 && (
         <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
           {[...Array(10)].map((_, i) => (
             <div key={i} className="aspect-[3/4] bg-muted rounded-2xl animate-pulse" />
           ))}
         </div>
      )}
    </div>
  );
}
