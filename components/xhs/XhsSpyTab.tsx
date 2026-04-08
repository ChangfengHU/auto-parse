'use client';

import { useState, useEffect } from 'react';

interface NoteItem {
  note_id?: string;
  id?: string;
  xsec_token?: string;
    note_card: {
      display_title: string;
      type: string;
      liked_count: string | number;
      cover: {
        url_default?: string;
        url?: string;
        info_list?: Array<{ url?: string; image_scene?: string }>;
        height: number;
        width: number;
      };
      user?: { nickname: string; avatar: string; xsec_token?: string };
      interact_info?: { liked_count: string | number };
    };
}

export default function XhsSpyTab({ 
  onSelectNote,
  userId: initialUserId = ''
}: { 
  onSelectNote?: (url: string) => void;
  userId?: string;
}) {
  const proxyXhsImage = (url?: string) => {
    if (!url) return '';
    const normalized = url.startsWith('//') ? `https:${url}` : url.startsWith('http://') ? `https://${url.slice(7)}` : url;
    if (!normalized.includes('xhscdn.com') && !normalized.includes('xiaohongshu.com')) return normalized;
    return `/api/proxy/image?url=${encodeURIComponent(normalized)}`;
  };

  const getCoverUrl = (cover: NoteItem['note_card']['cover']) => {
    if (cover.url_default) return proxyXhsImage(cover.url_default);
    if (cover.url) return proxyXhsImage(cover.url);
    if (Array.isArray(cover.info_list) && cover.info_list.length > 0) {
      const best = cover.info_list.find((i) => String(i.image_scene || '').includes('WM')) || cover.info_list[cover.info_list.length - 1];
      return proxyXhsImage(best?.url);
    }
    return '';
  };

  const [userId, setUserId] = useState(initialUserId);
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [error, setError] = useState('');

  // 自动触发侦测逻辑
  useEffect(() => {
    if (initialUserId) {
      setUserId(initialUserId);
      handleSpy(initialUserId);
    }
  }, [initialUserId]);

  const handleSpy = async (overrideId?: string) => {
    let finalId = (overrideId || userId).trim();
    const profileMatch = finalId.match(/profile\/([a-zA-Z0-9]+)/);
    if (profileMatch) finalId = profileMatch[1];
    if (!finalId) return;

    setLoading(true);
    setError('');
    setProfile(null);
    setNotes([]);

    try {
      const res = await fetch('/api/analysis/xhs/spy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: finalId })
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error);

      // 核心修正：Python 原样返回 XHS 结构，所以是 d.data.profile.data 和 d.data.notes.data.notes
      const profData = d.data.profile?.data || d.data.profile;
      const notesContainer = d.data.notes?.data || d.data.notes;
      const rawNotes: NoteItem[] = (notesContainer?.notes ?? []).filter((n: any) => n?.note_card);

      setProfile(profData);
      setNotes(rawNotes);
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

  const getProfileFields = (p: any) => {
    if (!p) return null;
    const basic = p.basic_info ?? p;
    const interactions = p.interactions ?? [];
    const fansInfo = interactions.find((i: any) => i.type === 'fans') ?? {};
    const followsInfo = interactions.find((i: any) => i.type === 'follows') ?? {};
    const likesInfo = interactions.find((i: any) => i.type === 'interaction') ?? {};
    return {
      nickname: basic.nickname ?? '未知博主',
      desc: basic.desc ?? basic.bio ?? '',
      avatar: basic.imageb ?? basic.avatar ?? '',
      fans: fansInfo.count ?? p.fans ?? 0,
      follows: followsInfo.count ?? p.follows ?? 0,
      liked: likesInfo.count ?? p.liked_count ?? 0,
    };
  };

  const prof = getProfileFields(profile);

  return (
    <div className="space-y-5">
      {/* 输入栏 */}
      <div className="flex gap-2">
        <input
          value={userId}
          onChange={e => setUserId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSpy()}
          placeholder="粘贴对标博主首页链接 或 User ID"
          className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
        />
        <button
          onClick={() => handleSpy()}
          disabled={loading || !userId.trim()}
          className="px-6 py-2.5 bg-zinc-900 hover:bg-zinc-700 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-black rounded-xl text-sm font-semibold disabled:opacity-50 transition min-w-[110px]"
        >
          {loading ? (
            <span className="flex items-center gap-2 justify-center">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              刺探中
            </span>
          ) : '👁️ 侦测'}
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-xl text-red-600 text-sm">{error}</div>
      )}

      {/* 博主档案卡片 */}
      {prof && (
        <div className="flex items-start gap-5 p-5 border border-border bg-card rounded-2xl">
          <img
            src={proxyXhsImage(prof.avatar)}
            className="w-20 h-20 rounded-full border-2 border-rose-100 object-cover shadow-md flex-shrink-0"
            alt={prof.nickname}
          />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold truncate">{prof.nickname}</h2>
            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{prof.desc || '这位博主很神秘，没有简介'}</p>
            <div className="flex gap-6 mt-3">
              {[
                { label: '粉丝', value: prof.fans },
                { label: '关注', value: prof.follows },
                { label: '获赞与收藏', value: prof.liked },
              ].map(stat => (
                <div key={stat.label} className="text-center">
                  <p className="text-base font-bold">{formatLikes(stat.value)}</p>
                  <p className="text-[11px] text-muted-foreground">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 笔记网格 */}
      {notes.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-3">近期发布 {notes.length} 篇，悬停可解析</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {notes.map((item) => {
              const card = item.note_card;
              const noteId = item.note_id ?? item.id ?? '';
              const likes = card.interact_info?.liked_count ?? card.liked_count ?? 0;
              return (
                <div
                  key={noteId}
                  className="group relative border border-border rounded-2xl overflow-hidden bg-card hover:shadow-lg transition-all duration-300 flex flex-col"
                >
                  <div className="relative overflow-hidden bg-muted" style={{ aspectRatio: `${card.cover.width || 3}/${card.cover.height || 4}` }}>
                    <img
                      src={getCoverUrl(card.cover)}
                      alt={card.display_title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading="lazy"
                    />
                    {card.type === 'video' && (
                      <span className="absolute top-2 right-2 bg-black/70 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">🎬</span>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-2.5 gap-1.5">
                      <button
                        onClick={() => {
                          if (noteId) {
                            const fullUrl = `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${item.note_card.user?.xsec_token || item.xsec_token || ''}&xsec_source=pc_feed`;
                            onSelectNote?.(fullUrl);
                          }
                        }}
                        className="w-full py-1.5 bg-white text-black rounded-lg text-[11px] font-bold hover:bg-gray-100 transition"
                      >
                        🚀 解析单帖
                      </button>
                    </div>
                  </div>
                  <div className="p-2 flex flex-col gap-1 overflow-hidden">
                    <p className="text-[11px] font-medium line-clamp-2 leading-snug">{card.display_title || '(无标题)'}</p>
                    <span className="text-[10px] text-rose-500 font-semibold">
                      ♥ {formatLikes(likes)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && !profile && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <span className="text-5xl">🕵️</span>
          <p className="text-sm">输入对标博主链接，深度解析其爆款矩阵</p>
        </div>
      )}
    </div>
  );
}
