'use client';

import { useEffect, useState } from 'react';

interface NoteCard {
  id?: string;
  note_id?: string;
  xsec_token?: string;
  note_card: {
    display_title: string;
    type: string;
    liked_count: string | number; // JSON 中可能是字符串 "8835"
    cover: {
      url_default?: string;
      url?: string;
      info_list?: Array<{ url?: string; image_scene?: string }>;
      height: number;
      width: number;
    };
    user: { nickname: string; avatar: string; user_id?: string };
    interact_info?: { liked: boolean; liked_count: string | number };
    };
}

const QUICK_TAGS = ['热门', '穿搭', '美食', '彩妆', '影视', '职场', '情感', '家居', '游戏', '旅行', '健身'] as const;

function isNoteCard(item: unknown): item is NoteCard {
  return typeof item === 'object' && item !== null && 'note_card' in item;
}

function getNoteId(item: NoteCard): string {
  return String(item.id || item.note_id || '').trim();
}

export default function XhsSearchTab({ 
  onSelectNote,
  onSpyUser,
  density = 'compact'
}: { 
  onSelectNote?: (url: string) => void;
  onSpyUser?: (userId: string) => void;
  density?: 'compact' | 'comfortable';
}) {
  const compact = density === 'compact';

  const proxyXhsImage = (url?: string) => {
    if (!url) return '';
    const normalized = url.startsWith('//') ? `https:${url}` : url.startsWith('http://') ? `https://${url.slice(7)}` : url;
    if (!normalized.includes('xhscdn.com') && !normalized.includes('xiaohongshu.com')) return normalized;
    return `/api/proxy/image?url=${encodeURIComponent(normalized)}`;
  };

  const getCoverUrl = (cover: NoteCard['note_card']['cover']) => {
    if (cover.url_default) return proxyXhsImage(cover.url_default);
    if (cover.url) return proxyXhsImage(cover.url);
    if (Array.isArray(cover.info_list) && cover.info_list.length > 0) {
      const best = cover.info_list.find((i) => String(i.image_scene || '').includes('WM')) || cover.info_list[cover.info_list.length - 1];
      return proxyXhsImage(best?.url);
    }
    return '';
  };

  async function requestFeedItems(): Promise<NoteCard[]> {
    const res = await fetch('/api/analysis/xhs/feed');
    const d = await res.json();
    if (!d.ok) throw new Error(d.error);
    const payload = d.data?.data ?? d.data;
    return (payload?.items ?? []).filter(isNoteCard);
  }

  async function requestSearchItems(nextKeyword: string): Promise<NoteCard[]> {
    const res = await fetch('/api/analysis/xhs/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: nextKeyword.trim() })
    });
    const d = await res.json();
    if (!d.ok) throw new Error(d.error);
    const responseData = d.data?.data || d.data;
    return (responseData?.items ?? []).filter(isNoteCard);
  }

  const [keyword, setKeyword] = useState('');
  const [selectedTag, setSelectedTag] = useState<(typeof QUICK_TAGS)[number]>('热门');
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<NoteCard[]>([]);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [storedIds, setStoredIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const runQuery = async (options?: { forceHot?: boolean; searchKeyword?: string }) => {
    const forceHot = options?.forceHot === true;
    const query = options?.searchKeyword ?? keyword.trim();
    const useFeedApi = forceHot || (selectedTag === '热门' && !query);
    setLoading(true);
    setError('');
    setNotes([]);
    try {
      const items = useFeedApi ? await requestFeedItems() : await requestSearchItems(query);
      setNotes(items);
      setSelectedIds([]);
      setStoredIds([]);
      setSaveMsg('');
      if (items.length === 0) {
        setError(useFeedApi ? '暂时没有热门推荐，请检查登录信息是否有效' : '没有搜到内容，换个关键词试试');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void runQuery({ forceHot: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = async () => {
    if (!keyword.trim()) {
      if (selectedTag === '热门') {
        await runQuery({ forceHot: true });
      }
      return;
    }
    await runQuery({ searchKeyword: keyword.trim() });
  };

  const handleTagClick = async (tag: (typeof QUICK_TAGS)[number]) => {
    setSelectedTag(tag);
    if (tag === '热门') {
      setKeyword('');
      await runQuery({ forceHot: true });
      return;
    }
    setKeyword(tag);
    await runQuery({ searchKeyword: tag });
  };

  const formatLikes = (val: string | number) => {
    const num = typeof val === 'string' ? parseInt(val, 10) : val;
    if (isNaN(num)) return val;
    if (num >= 10000) return `${(num / 10000).toFixed(1)}w`;
    return num;
  };

  const visibleIds = notes.map(getNoteId).filter(Boolean);
  const selectedSet = new Set(selectedIds);
  const storedSet = new Set(storedIds);

  const toggleSelect = (noteId: string) => {
    if (!noteId) return;
    setSelectedIds((prev) => (
      prev.includes(noteId) ? prev.filter((id) => id !== noteId) : [...prev, noteId]
    ));
  };

  const buildSaveItems = (targetIds: string[]) => {
    const idSet = new Set(targetIds);
    return notes
      .filter((item) => {
        const noteId = getNoteId(item);
        return noteId && idSet.has(noteId);
      })
      .map((item) => ({
        id: getNoteId(item),
        xsec_token: item.xsec_token,
        note_card: {
          display_title: item.note_card?.display_title,
          cover: item.note_card?.cover,
        },
      }));
  };

  const saveByIds = async (targetIds: string[], tip: string) => {
    const uniqIds = Array.from(new Set(targetIds.filter(Boolean)));
    if (!uniqIds.length) {
      setSaveMsg('⚠️ 请先选择要入库的内容');
      return;
    }
    setSaving(true);
    setSaveMsg('');
    try {
      const items = buildSaveItems(uniqIds);
      if (!items.length) {
        setSaveMsg('⚠️ 未找到可入库内容');
        return;
      }
      const res = await fetch('/api/materials/xhs-feed-covers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json() as {
        ok?: boolean;
        savedCount?: number;
        skippedCount?: number;
        savedIds?: string[];
        existedIds?: string[];
        errors?: string[];
      };
      if (!res.ok || data.ok === false) {
        throw new Error((data as { error?: string }).error || '入库失败');
      }
      const mergedDoneIds = Array.from(new Set([
        ...storedIds,
        ...(data.savedIds ?? []),
        ...(data.existedIds ?? []),
      ]));
      setStoredIds(mergedDoneIds);
      const suffix = data.errors?.length ? `（${data.errors.length} 条失败）` : '';
      setSaveMsg(`✅ ${tip}完成：新增 ${data.savedCount ?? 0}，已存在 ${data.skippedCount ?? 0}${suffix}`);
    } catch (e) {
      setSaveMsg('❌ 入库失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={compact ? 'space-y-3' : 'space-y-5'}>
      <div className={compact ? 'flex gap-1.5 overflow-x-auto pb-1' : 'flex flex-wrap gap-2'}>
        {QUICK_TAGS.map((tag) => (
          <button
            key={tag}
            onClick={() => void handleTagClick(tag)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
              selectedTag === tag
                ? 'bg-foreground text-background border-foreground'
                : 'bg-card text-foreground/80 border-border hover:bg-muted'
            }`}
          >
            {tag}
          </button>
        ))}
      </div>

      {/* 搜索栏 */}
      <div className={compact ? 'flex gap-2' : 'flex gap-2'}>
        <input
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="输入行业爆款关键词 (如: 穿搭 / 美食 / 程序员工具)。留空并选“热门”可看热门推荐"
          className={compact
            ? 'flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition'
            : 'flex-1 px-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition'
          }
        />
        <button
          onClick={handleSearch}
          disabled={loading || (selectedTag !== '热门' && !keyword.trim())}
          className={compact
            ? 'px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition min-w-[96px]'
            : 'px-6 py-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition min-w-[110px]'
          }
        >
          {loading ? (
            <span className="flex items-center gap-2 justify-center">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              搜罗中
            </span>
          ) : selectedTag === '热门' && !keyword.trim() ? '🔥 看热门' : '🔍 搜爆款'}
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-sm">{error}</div>
      )}

      {notes.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-3">
            {selectedTag === '热门' && !keyword.trim()
              ? `当前热门推荐 ${notes.length} 篇`
              : `找到 ${notes.length} 篇相关笔记`}
          </p>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setSelectedIds(visibleIds)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-card hover:bg-muted transition"
            >
              全选当前
            </button>
            <button
              onClick={() => setSelectedIds([])}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-card hover:bg-muted transition"
            >
              清空选择
            </button>
            <button
              onClick={() => void saveByIds(visibleIds, '全部入库')}
              disabled={saving || !visibleIds.length}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50 transition"
            >
              {saving ? '入库中...' : '一键全部入库'}
            </button>
            <button
              onClick={() => void saveByIds(selectedIds, '批量入库')}
              disabled={saving || !selectedIds.length}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-foreground text-background hover:opacity-90 disabled:opacity-50 transition"
            >
              {saving ? '入库中...' : `批量入库（已选 ${selectedIds.length}）`}
            </button>
          </div>
          {saveMsg && <p className="text-xs text-muted-foreground mb-3">{saveMsg}</p>}
          {/* 网格 */}
          <div className={compact
            ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2'
            : 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3'
          }>
            {notes.map((item) => {
              const card = item.note_card;
              const likes = card.interact_info?.liked_count ?? card.liked_count ?? 0;
              const noteId = getNoteId(item);
              const checked = selectedSet.has(noteId);
              const stored = storedSet.has(noteId);
              return (
                <div
                  key={noteId || `${card.display_title}-${likes}`}
                  className={compact
                    ? 'group relative border border-border rounded-xl overflow-hidden bg-card hover:shadow-lg transition-all duration-300 flex flex-col cursor-default'
                    : 'group relative border border-border rounded-2xl overflow-hidden bg-card hover:shadow-xl transition-all duration-300 flex flex-col cursor-default'
                  }
                >
                  <div className="relative overflow-hidden bg-muted" style={{ aspectRatio: `${card.cover.width || 3}/${card.cover.height || 4}` }}>
                    <label className={compact
                      ? 'absolute left-2 top-2 z-20 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-white text-[10px]'
                      : 'absolute left-2 top-2 z-20 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-1 text-white text-[10px]'
                    }>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelect(noteId)}
                        className="accent-rose-500"
                      />
                      选择
                    </label>
                    <button
                      onClick={() => void saveByIds([noteId], '单条入库')}
                      disabled={saving || stored || !noteId}
                      className={`absolute right-2 top-2 z-20 rounded-md ${compact ? 'px-1.5 py-0.5' : 'px-2 py-1'} text-[10px] font-semibold transition ${
                        stored
                          ? 'bg-emerald-500/90 text-white'
                          : 'bg-white/90 text-black hover:bg-white'
                      } disabled:opacity-60`}
                    >
                      {stored ? '✅ 已入库' : '💾 入库'}
                    </button>
                    <img
                      src={getCoverUrl(card.cover)}
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
                          const fullUrl = `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${item.xsec_token}&xsec_source=pc_feed`;
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

                  <div className={compact ? 'p-2 flex flex-col gap-1 flex-1' : 'p-2.5 flex flex-col gap-1.5 flex-1'}>
                    <p className="text-xs font-semibold line-clamp-2 leading-snug">{card.display_title || '(无标题)'}</p>
                    <div className="flex items-center gap-1.5 mt-auto">
                      <img
                        src={proxyXhsImage(card.user.avatar)}
                        alt={card.user.nickname}
                        className={compact ? 'w-3.5 h-3.5 rounded-full object-cover bg-muted flex-shrink-0' : 'w-4 h-4 rounded-full object-cover bg-muted flex-shrink-0'}
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
          <p className="text-sm">点击标签或输入关键词，一键扫描全网爆款笔记</p>
        </div>
      )}
    </div>
  );
}
