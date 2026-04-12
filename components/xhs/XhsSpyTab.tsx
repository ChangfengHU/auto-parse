'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function getString(obj: Record<string, unknown> | null, key: string): string {
  const v = obj?.[key];
  return typeof v === 'string' ? v : '';
}

function toNumberLike(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const raw = value.trim();
  if (!raw) return 0;

  const normalized = raw.replace(/,/g, '').toLowerCase();
  const unitMatch = normalized.match(/^([0-9]+(?:\.[0-9]+)?)(w|万)$/i);
  if (unitMatch) {
    const base = parseFloat(unitMatch[1]);
    if (!Number.isFinite(base)) return 0;
    return Math.round(base * 10000);
  }

  const num = parseInt(normalized.replace(/[^0-9-]/g, ''), 10);
  return Number.isFinite(num) ? num : 0;
}

function getNumber(obj: Record<string, unknown> | null, key: string): number {
  return toNumberLike(obj?.[key]);
}

function getArray(obj: Record<string, unknown> | null, key: string): unknown[] {
  const v = obj?.[key];
  return Array.isArray(v) ? v : [];
}

function isNoteItem(item: unknown): item is NoteItem {
  const rec = asRecord(item);
  return Boolean(rec && asRecord(rec.note_card));
}

export default function XhsSpyTab({ 
  onSelectNote,
  userId: initialUserId = '',
  density = 'compact'
}: { 
  onSelectNote?: (url: string) => void;
  userId?: string;
  density?: 'compact' | 'comfortable';
}) {
  const compact = density === 'compact';

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
  const [resolvedUserId, setResolvedUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [cursor, setCursor] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [autoLoadingAll, setAutoLoadingAll] = useState(false);

  const autoStopRef = useRef(false);
  const cursorRef = useRef('');
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);
  const [error, setError] = useState('');

  const resolveUserProfileId = (value: string) => {
    let finalId = value.trim();
    const profileMatch = finalId.match(/profile\/([a-zA-Z0-9_-]+)/);
    if (profileMatch) finalId = profileMatch[1];
    return finalId;
  };

  const extractNotes = (notesData: Record<string, unknown> | null): NoteItem[] => {
    if (!notesData) return [];
    const directCandidates = ['notes', 'items', 'list', 'note_list', 'noteList'];
    for (const key of directCandidates) {
      const arr = getArray(notesData, key).filter(isNoteItem);
      if (arr.length > 0) return arr;
    }

    const nestedData = asRecord(notesData.data);
    if (nestedData) {
      for (const key of directCandidates) {
        const arr = getArray(nestedData, key).filter(isNoteItem);
        if (arr.length > 0) return arr;
      }
    }

    return [];
  };

  const extractCursor = (notesData: Record<string, unknown> | null): { cursor: string; hasMore: boolean } => {
    if (!notesData) return { cursor: '', hasMore: false };
    const candidates = ['next_cursor', 'nextCursor', 'cursor', 'page_cursor', 'pageCursor'];
    const recs = [notesData, asRecord(notesData.data)].filter(Boolean) as Record<string, unknown>[];

    let next = '';
    for (const rec of recs) {
      for (const key of candidates) {
        const v = rec[key];
        if (typeof v === 'string' && v.trim()) {
          next = v.trim();
          break;
        }
        if (typeof v === 'number' && Number.isFinite(v) && v !== 0) {
          next = String(v);
          break;
        }
      }
      if (next) break;
    }

    const hasMoreFlag = (() => {
      for (const rec of recs) {
        const v = rec.has_more ?? rec.hasMore;
        if (typeof v === 'boolean') return v;
        if (typeof v === 'number') return v !== 0;
        if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
      }
      return undefined;
    })();

    const hasMore = typeof hasMoreFlag === 'boolean' ? hasMoreFlag : Boolean(next);
    return { cursor: next, hasMore };
  };

  const fetchMore = async (opts: { userId: string; cursor: string }) => {
    const res = await fetch('/api/analysis/xhs/spy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: opts.userId, cursor: opts.cursor }),
    });
    const d = await res.json() as { ok?: boolean; error?: string; data?: unknown };
    if (!d.ok) throw new Error(d.error ?? '加载更多失败');

    const data = asRecord(d.data);
    const notesWrap = asRecord(data?.notes);
    const notesData = asRecord(notesWrap?.data) ?? notesWrap;
    return {
      items: extractNotes(notesData),
      next: extractCursor(notesData),
    };
  };

  const handleSpy = useCallback(async (overrideId?: string) => {
    const finalId = resolveUserProfileId(overrideId || userId);
    if (!finalId) return;
    setResolvedUserId(finalId);

    setLoading(true);
    setError('');
    autoStopRef.current = true;
    setAutoLoadingAll(false);
    setProfile(null);
    setNotes([]);
    setCursor('');
    setHasMore(false);

    try {
      const res = await fetch('/api/analysis/xhs/spy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: finalId })
      });
      const d = await res.json() as { ok?: boolean; error?: string; data?: unknown };
      if (!d.ok) throw new Error(d.error ?? '侦测失败');

      const data = asRecord(d.data);
      const profWrap = asRecord(data?.profile);
      const profData = asRecord(profWrap?.data) ?? profWrap;

      const notesWrap = asRecord(data?.notes);
      const notesData = asRecord(notesWrap?.data) ?? notesWrap;
      const rawNotes = extractNotes(notesData);
      const next = extractCursor(notesData);

      setProfile(profData ?? null);
      setNotes(rawNotes);
      setCursor(next.cursor);
      setHasMore(next.hasMore);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // 自动触发侦测逻辑
  useEffect(() => {
    if (initialUserId) {
      setUserId(initialUserId);
      void handleSpy(initialUserId);
    }
  }, [initialUserId, handleSpy]);

  const formatLikes = (val: string | number) => {
    const num = typeof val === 'string' ? parseInt(val, 10) : val;
    if (isNaN(num)) return val;
    if (num >= 10000) return `${(num / 10000).toFixed(1)}w`;
    return num;
  };

  const getProfileFields = (p: Record<string, unknown> | null) => {
    if (!p) return null;

    const basicInfo = asRecord(p.basic_info) ?? (asRecord(asRecord(p.data)?.basic_info) ?? null) ?? p;
    const profileId =
      getString(basicInfo, 'user_id') ||
      getString(basicInfo, 'userId') ||
      getString(p, 'user_id') ||
      getString(p, 'userId') ||
      resolvedUserId;
    const interactions = [
      ...getArray(p, 'interactions'),
      ...getArray(asRecord(p.data), 'interactions'),
    ]
      .map(asRecord)
      .filter(Boolean) as Record<string, unknown>[];

    const findCount = (types: string[]) => {
      for (const type of types) {
        const hit = interactions.find((i) => getString(i, 'type') === type);
        const count = hit ? getNumber(hit, 'count') : 0;
        if (count) return count;
      }
      return 0;
    };

    const fans = findCount(['fans', 'fan', 'follower', 'followers']) || getNumber(p, 'fans') || getNumber(p, 'fansCount') || getNumber(p, 'fans_count');
    const follows = findCount(['follows', 'follow', 'following']) || getNumber(p, 'follows') || getNumber(p, 'followCount') || getNumber(p, 'follows_count');

    const likedCollect =
      findCount(['interaction', 'liked_and_collected', 'likedAndCollected', 'like_and_collect']) ||
      getNumber(p, 'liked_count') ||
      getNumber(p, 'likedCount') ||
      getNumber(p, 'like_count') ||
      getNumber(p, 'collected_count') ||
      getNumber(p, 'collect_count');

    return {
      profileId,
      profileUrl: profileId ? `https://www.xiaohongshu.com/user/profile/${profileId}` : '',
      nickname: getString(basicInfo, 'nickname') || getString(basicInfo, 'name') || '未知博主',
      desc: getString(basicInfo, 'desc') || getString(basicInfo, 'bio') || getString(basicInfo, 'description'),
      avatar: getString(basicInfo, 'imageb') || getString(basicInfo, 'avatar') || getString(basicInfo, 'image') || getString(basicInfo, 'imageB'),
      fans,
      follows,
      liked: likedCollect,
    };
  };

  const prof = getProfileFields(profile);

  return (
    <div className={compact ? 'space-y-3' : 'space-y-5'}>
      {/* 输入栏 */}
      <div className="flex gap-2">
        <input
          value={userId}
          onChange={e => setUserId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSpy()}
          placeholder="粘贴对标博主首页链接 或 User ID"
          className={compact
            ? 'flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition'
            : 'flex-1 px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition'
          }
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
        <div className={compact ? 'flex items-start gap-3 p-3 border border-border bg-card rounded-xl' : 'flex items-start gap-5 p-5 border border-border bg-card rounded-2xl'}>
          <img
            src={proxyXhsImage(prof.avatar)}
            className={compact ? 'w-14 h-14 rounded-full border border-border object-cover bg-muted flex-shrink-0' : 'w-20 h-20 rounded-full border-2 border-rose-100 object-cover shadow-md flex-shrink-0'}
            alt={prof.nickname}
          />
          <div className="flex-1 min-w-0">
            {prof.profileUrl ? (
              <a
                href={prof.profileUrl}
                target="_blank"
                rel="noreferrer"
                className="text-lg font-bold truncate hover:underline underline-offset-2"
                title="打开小红书原博主页"
              >
                {prof.nickname}
              </a>
            ) : (
              <h2 className="text-lg font-bold truncate">{prof.nickname}</h2>
            )}
            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{prof.desc || '这位博主很神秘，没有简介'}</p>
            <div className={compact ? 'flex gap-4 mt-2' : 'flex gap-6 mt-3'}>
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
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground">已加载 {notes.length} 篇，悬停可解析</p>
            {hasMore && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    if (!cursor || loadingMore || !resolvedUserId) return;
                    setLoadingMore(true);
                    try {
                      const { items, next } = await fetchMore({ userId: resolvedUserId, cursor });
                      setNotes((prev) => {
                        const seen = new Set(prev.map((item) => item.note_id ?? item.id ?? ''));
                        const merged = [...prev];
                        for (const item of items) {
                          const id = item.note_id ?? item.id ?? '';
                          if (id && !seen.has(id)) merged.push(item);
                        }
                        return merged;
                      });
                      cursorRef.current = next.cursor;
                      hasMoreRef.current = next.hasMore;
                      setCursor(next.cursor);
                      setHasMore(next.hasMore);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setLoadingMore(false);
                    }
                  }}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-50"
                  disabled={loadingMore || !cursor || !resolvedUserId}
                >
                  {loadingMore ? '加载中...' : '加载更多'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!resolvedUserId || !cursor) return;
                    if (autoLoadingAll) {
                      autoStopRef.current = true;
                      setAutoLoadingAll(false);
                      return;
                    }

                    autoStopRef.current = false;
                    setAutoLoadingAll(true);

                    void (async () => {
                      while (!autoStopRef.current && cursorRef.current && hasMoreRef.current) {
                        if (loadingMoreRef.current) {
                          await new Promise((r) => setTimeout(r, 300));
                          continue;
                        }

                        const c = cursorRef.current;
                        if (!c) break;

                        setLoadingMore(true);
                        try {
                          const { items, next } = await fetchMore({ userId: resolvedUserId, cursor: c });
                          setNotes((prev) => {
                            const seen = new Set(prev.map((item) => item.note_id ?? item.id ?? ''));
                            const merged = [...prev];
                            for (const item of items) {
                              const id = item.note_id ?? item.id ?? '';
                              if (id && !seen.has(id)) merged.push(item);
                            }
                            return merged;
                          });
                          cursorRef.current = next.cursor;
                          hasMoreRef.current = next.hasMore;
                          setCursor(next.cursor);
                          setHasMore(next.hasMore);
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                          autoStopRef.current = true;
                          break;
                        } finally {
                          setLoadingMore(false);
                        }

                        // 轻微节流，避免请求过猛
                        await new Promise((r) => setTimeout(r, 600));
                      }
                      setAutoLoadingAll(false);
                    })();
                  }}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-50"
                  disabled={!cursor || !resolvedUserId}
                  title="分批慢慢拉取全部作品"
                >
                  {autoLoadingAll ? '停止拉取' : '持续拉取'}
                </button>
              </div>
            )}
          </div>
          <div className={compact
            ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2'
            : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3'
          }>
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
