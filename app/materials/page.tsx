'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { XhsPostData } from '@/lib/analysis/xhs-fetch';
import {
  ArrowPathIcon,
  ClipboardIcon,
  EyeIcon,
  FolderOpenIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

interface Material {
  id: string;
  platform: string;
  mediaType?: 'video' | 'image';
  title: string;
  ossUrl: string;
  videoUrl: string;
  coverUrl?: string;
  sourceUrl?: string;
  sourceNoteId?: string;
  sourcePostUrl?: string;
  relatedContentId?: string;
  parsedAt: number;
}

interface PagedMaterials {
  items: Material[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const PAGE_SIZE = 12;

function timeAgo(ts: number) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${Math.floor(diff / 86400)}天前`;
}

function buildPostUrl(m: Material) {
  if (m.sourcePostUrl) return m.sourcePostUrl;
  if (m.sourceNoteId) return `https://www.xiaohongshu.com/discovery/item/${m.sourceNoteId}`;
  return '';
}

function extractXsecToken(url?: string) {
  if (!url) return '';
  try {
    return new URL(url).searchParams.get('xsec_token') || '';
  } catch {
    const match = url.match(/[?&]xsec_token=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }
}

function proxyXhsImage(url?: string) {
  if (!url) return '';
  const normalized = url.startsWith('//') ? `https:${url}` : url.startsWith('http://') ? `https://${url.slice(7)}` : url;
  if (!normalized.includes('xhscdn.com') && !normalized.includes('xiaohongshu.com')) return normalized;
  return `/api/proxy/image?url=${encodeURIComponent(normalized)}`;
}

export default function MaterialsPage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'video' | 'image'>('video');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [counts, setCounts] = useState<{ video: number; image: number }>({ video: 0, image: 0 });
  const [keyword, setKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [linkedFilter, setLinkedFilter] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<'video' | 'image' | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid' | 'compact'>('grid');

  const [parsingMaterial, setParsingMaterial] = useState<Material | null>(null);
  const [parseLoading, setParseLoading] = useState(false);
  const [parseError, setParseError] = useState('');
  const [parseData, setParseData] = useState<XhsPostData | null>(null);
  const [parseComments, setParseComments] = useState<Array<{ id: string; nickname: string; content: string; likeCount: number }>>([]);
  const [parseCommentsLoading, setParseCommentsLoading] = useState(false);
  const [parseCommentsError, setParseCommentsError] = useState('');
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveResult, setSaveResult] = useState<{ contentId?: string; message?: string } | null>(null);

  const router = useRouter();

  const loadCounts = useCallback(async (q: string, linked: 'all' | 'linked' | 'unlinked') => {
    const qp = new URLSearchParams({ page: '1', pageSize: '1', linked });
    if (q.trim()) qp.set('q', q.trim());
    const [videoRes, imageRes] = await Promise.all([
      fetch(`/api/materials?kind=video&${qp.toString()}`),
      fetch(`/api/materials?kind=image&${qp.toString()}`),
    ]);
    const [videoData, imageData] = await Promise.all([videoRes.json(), imageRes.json()]);
    setCounts({
      video: Number(videoData?.total || 0),
      image: Number(imageData?.total || 0),
    });
  }, []);

  const loadPage = useCallback(
    async (kind: 'video' | 'image', nextPage: number, q: string, linked: 'all' | 'linked' | 'unlinked') => {
      setLoading(true);
      const params = new URLSearchParams({
        kind,
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
        linked,
      });
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(`/api/materials?${params.toString()}`);
      const data = (await res.json()) as PagedMaterials;
      setMaterials(Array.isArray(data?.items) ? data.items : []);
      setTotal(Number(data?.total || 0));
      setPage(Number(data?.page || 1));
      setTotalPages(Number(data?.totalPages || 1));
      setLoading(false);
    },
    []
  );

  const refresh = useCallback(async () => {
    await Promise.all([loadPage(activeTab, page, keyword, linkedFilter), loadCounts(keyword, linkedFilter)]);
  }, [activeTab, page, keyword, linkedFilter, loadCounts, loadPage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, keyword, linkedFilter]);

  useEffect(() => {
    void loadPage(activeTab, page, keyword, linkedFilter);
  }, [activeTab, page, keyword, linkedFilter, loadPage]);

  async function handleDelete(id: string) {
    setDeletingId(id);
    await fetch(`/api/materials?id=${id}`, { method: 'DELETE' });
    const fallbackPage = materials.length <= 1 && page > 1 ? page - 1 : page;
    await Promise.all([
      loadPage(activeTab, fallbackPage, keyword, linkedFilter),
      loadCounts(keyword, linkedFilter),
    ]);
    setDeletingId(null);
  }

  function handlePublish(m: Material) {
    router.push(`/publish?ossUrl=${encodeURIComponent(m.ossUrl)}&title=${encodeURIComponent(m.title)}`);
  }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url).catch(() => {});
  }

  async function startParseFlow(m: Material) {
    const postUrl = buildPostUrl(m);
    setParsingMaterial(m);
    setParseLoading(true);
    setParseError('');
    setParseData(null);
    setParseComments([]);
    setParseCommentsError('');
    setSaveResult(null);
    if (!postUrl) {
      setParseError('缺少来源链接，无法解析');
      setParseLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/analysis/xhs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: postUrl }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `解析失败（HTTP ${res.status}）`);
      }
      const nextData = data.data as XhsPostData;
      setParseData(nextData);

      const xsecToken = extractXsecToken(postUrl);
      if (xsecToken && nextData.noteId) {
        setParseCommentsLoading(true);
        try {
          const commentsRes = await fetch('/api/analysis/xhs/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ noteId: nextData.noteId, xsecToken }),
          });
          const commentsData = await commentsRes.json();
          if (!commentsRes.ok || commentsData?.error) {
            throw new Error(commentsData?.error || '评论加载失败');
          }
          setParseComments(commentsData?.data?.comments || []);
        } catch (error) {
          setParseCommentsError(error instanceof Error ? error.message : String(error));
        } finally {
          setParseCommentsLoading(false);
        }
      }
    } catch (error) {
      setParseError(error instanceof Error ? error.message : String(error));
    } finally {
      setParseLoading(false);
    }
  }

  async function confirmSaveToContent() {
    if (!parseData || !parsingMaterial) return;
    setSaveLoading(true);
    setSaveResult(null);
    try {
      const res = await fetch('/api/content/save/xhs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteData: parseData,
          originalUrl: buildPostUrl(parsingMaterial) || parseData.postUrl,
          comments: [],
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `保存失败（HTTP ${res.status}）`);
      }
      const contentId = String(data?.data?.post?.id || '');
      setSaveResult({
        contentId,
        message: '✅ 已保存到作品素材库',
      });
      await loadPage(activeTab, page, keyword, linkedFilter);
      await loadCounts(keyword, linkedFilter);
    } catch (error) {
      setSaveResult({ message: `❌ ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setSaveLoading(false);
    }
  }

  const iconBtnClass =
    'inline-flex items-center justify-center h-7 w-7 rounded-md border border-border bg-background/90 text-muted-foreground hover:text-foreground hover:bg-muted transition disabled:opacity-30';
  const compactIconBtnClass =
    'inline-flex items-center justify-center h-6 w-6 rounded-md border border-border bg-background/90 text-muted-foreground hover:text-foreground hover:bg-muted transition disabled:opacity-30';

  const renderMaterialActions = (m: Material, isVideo: boolean) => (
    <>
      {isVideo && (
        <button
          onClick={() => handlePublish(m)}
          className={iconBtnClass}
          title="立即发布"
          aria-label="立即发布"
        >
          <PaperAirplaneIcon className="h-4 w-4" />
        </button>
      )}
      <button
        onClick={() => {
          setPreviewUrl(m.ossUrl);
          setPreviewType(isVideo ? 'video' : 'image');
        }}
        className={iconBtnClass}
        title="放大查看"
        aria-label="放大查看"
      >
        <EyeIcon className="h-4 w-4" />
      </button>
      <button
        onClick={() => copyUrl(m.ossUrl)}
        className={iconBtnClass}
        title="复制链接"
        aria-label="复制链接"
      >
        <ClipboardIcon className="h-4 w-4" />
      </button>
      {m.relatedContentId ? (
        <a
          href={`/content-library/detail?id=${m.relatedContentId}`}
          className={iconBtnClass}
          title="查看作品素材"
          aria-label="查看作品素材"
        >
          <FolderOpenIcon className="h-4 w-4" />
        </a>
      ) : (
        m.platform === 'xiaohongshu' &&
        m.mediaType === 'image' && (
          <button
            onClick={() => void startParseFlow(m)}
            className={iconBtnClass}
            title="解析到作品素材"
            aria-label="解析到作品素材"
          >
            <SparklesIcon className="h-4 w-4" />
          </button>
        )
      )}
    </>
  );

  const renderGridPrimaryActions = (m: Material, isVideo: boolean) => (
    <>
      <button
        onClick={() => {
          setPreviewUrl(m.ossUrl);
          setPreviewType(isVideo ? 'video' : 'image');
        }}
        className={compactIconBtnClass}
        title="放大查看"
        aria-label="放大查看"
      >
        <EyeIcon className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => copyUrl(m.ossUrl)}
        className={compactIconBtnClass}
        title="复制链接"
        aria-label="复制链接"
      >
        <ClipboardIcon className="h-3.5 w-3.5" />
      </button>
    </>
  );

  const renderGridSecondaryActions = (m: Material, isVideo: boolean) => (
    <>
      {isVideo && (
        <button
          onClick={() => handlePublish(m)}
          className={compactIconBtnClass}
          title="立即发布"
          aria-label="立即发布"
        >
          <PaperAirplaneIcon className="h-3.5 w-3.5" />
        </button>
      )}
      {m.relatedContentId ? (
        <a
          href={`/content-library/detail?id=${m.relatedContentId}`}
          className={compactIconBtnClass}
          title="查看作品素材"
          aria-label="查看作品素材"
        >
          <FolderOpenIcon className="h-3.5 w-3.5" />
        </a>
      ) : (
        m.platform === 'xiaohongshu' &&
        m.mediaType === 'image' && (
          <button
            onClick={() => void startParseFlow(m)}
            className={compactIconBtnClass}
            title="解析到作品素材"
            aria-label="解析到作品素材"
          >
            <SparklesIcon className="h-3.5 w-3.5" />
          </button>
        )
      )}
    </>
  );

  return (
    <div className="max-w-[1560px] mx-auto px-3 sm:px-4 py-6">
      <div className="flex items-end justify-between gap-3 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">素材库</h1>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <div className="inline-flex rounded-lg bg-muted p-1 gap-1">
          <button
            onClick={() => setActiveTab('video')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${
              activeTab === 'video' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
          >
            视频 ({counts.video})
          </button>
          <button
            onClick={() => setActiveTab('image')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${
              activeTab === 'image' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
          >
            图片 ({counts.image})
          </button>
        </div>
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setKeyword(searchInput.trim());
          }}
          placeholder="按标题搜索"
          className="w-full sm:w-56 md:w-64 px-3 py-1.5 text-xs rounded-lg border border-border bg-background"
        />
        <button
          onClick={() => setKeyword(searchInput.trim())}
          className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted"
        >
          查询
        </button>
        <button
          onClick={() => {
            setSearchInput('');
            setKeyword('');
          }}
          className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted"
        >
          清空
        </button>
        <select
          value={linkedFilter}
          onChange={(e) => setLinkedFilter(e.target.value as 'all' | 'linked' | 'unlinked')}
          className="px-3 py-1.5 text-xs rounded-lg border border-border bg-background"
        >
          <option value="all">关联状态：全部</option>
          <option value="linked">已解析到作品素材</option>
          <option value="unlinked">未解析到作品素材</option>
        </select>
        <div className="ml-auto inline-flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 text-xs ${viewMode === 'list' ? 'bg-muted font-semibold' : 'bg-background text-muted-foreground'}`}
          >
            列表
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`px-3 py-1.5 text-xs border-l border-border ${viewMode === 'grid' ? 'bg-muted font-semibold' : 'bg-background text-muted-foreground'}`}
          >
            网格
          </button>
          <button
            onClick={() => setViewMode('compact')}
            className={`px-3 py-1.5 text-xs border-l border-border ${viewMode === 'compact' ? 'bg-muted font-semibold' : 'bg-background text-muted-foreground'}`}
          >
            紧凑
          </button>
        </div>
        <button
          onClick={() => void refresh()}
          className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted"
          title="刷新"
          aria-label="刷新"
        >
          <ArrowPathIcon className="h-4 w-4" />
        </button>
      </div>

      {loading && materials.length === 0 && <div className="py-12 text-sm text-muted-foreground">正在加载素材...</div>}

      {!loading && materials.length === 0 && (
        <div className="text-center py-20 bg-card border border-dashed border-border rounded-2xl">
          <p className="text-lg font-medium text-foreground mb-1">暂无素材</p>
          <p className="text-sm text-muted-foreground">可调整查询条件后重试</p>
        </div>
      )}

      {viewMode === 'list' && (
        <div className="grid gap-4">
          {materials.map((m) => {
            const isVideo = (m.mediaType ?? 'video') === 'video';
            return (
              <div key={m.id} className="group bg-card border border-border rounded-2xl p-4 flex flex-col sm:flex-row gap-4 sm:gap-5">
                <div className="w-full sm:w-32 h-44 sm:h-20 flex-shrink-0 bg-black rounded-xl overflow-hidden">
                  {isVideo ? (
                    <video src={m.ossUrl + '#t=1'} className="w-full h-full object-cover" preload="metadata" muted />
                  ) : (
                    <img src={m.ossUrl} className="w-full h-full object-cover" alt={m.title} loading="lazy" />
                  )}
                </div>

                <div className="flex-1 min-w-0 flex flex-col justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-foreground truncate flex-1">{m.title || '（无标题）'}</p>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-primary/10 text-primary">
                        {isVideo ? '视频' : '图片'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{timeAgo(m.parsedAt)}</span>
                    </div>
                    {(m.sourceNoteId || m.sourcePostUrl) && (
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        {m.sourceNoteId && <span>来源ID: {m.sourceNoteId}</span>}
                        {m.sourcePostUrl && (
                          <a href={m.sourcePostUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                            原始链接
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-3">
                    <div className="flex gap-2 flex-wrap">{renderMaterialActions(m, isVideo)}</div>
                    <button
                      onClick={() => void handleDelete(m.id)}
                      disabled={deletingId === m.id}
                      title="删除"
                      aria-label="删除"
                      className={iconBtnClass}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {viewMode === 'grid' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
          {materials.map((m) => {
            const isVideo = (m.mediaType ?? 'video') === 'video';
            return (
              <div key={m.id} className="group bg-card border border-border rounded-xl overflow-hidden">
                <div className="aspect-[3/4] bg-black relative">
                  {isVideo ? (
                    <video src={m.ossUrl + '#t=1'} className="w-full h-full object-cover" preload="metadata" muted />
                  ) : (
                    <img src={m.ossUrl} className="w-full h-full object-cover" alt={m.title} loading="lazy" />
                  )}
                  <div className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-md bg-black/35 p-1 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                    {renderGridSecondaryActions(m, isVideo)}
                  </div>
                  <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/55 text-white text-[10px]">
                    {isVideo ? '视频' : '图片'}
                  </span>
                </div>
                <div className="p-2 space-y-1.5">
                  <p className="text-xs font-medium line-clamp-2 leading-4 min-h-8">{m.title || '（无标题）'}</p>
                  <div className="flex items-center justify-between gap-1.5">
                    <p className="text-[10px] text-muted-foreground">{timeAgo(m.parsedAt)}</p>
                    <div className="flex items-center gap-1">{renderGridPrimaryActions(m, isVideo)}</div>
                    <button
                      onClick={() => void handleDelete(m.id)}
                      disabled={deletingId === m.id}
                      title="删除"
                      aria-label="删除"
                      className={compactIconBtnClass}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {viewMode === 'compact' && (
        <div className="bg-card border border-border rounded-2xl divide-y divide-border">
          {materials.map((m) => {
            const isVideo = (m.mediaType ?? 'video') === 'video';
            return (
              <div key={m.id} className="p-2.5 flex items-center gap-2.5">
                <div className="w-14 h-10 rounded-md bg-black overflow-hidden flex-shrink-0">
                  {isVideo ? (
                    <video src={m.ossUrl + '#t=1'} className="w-full h-full object-cover" preload="metadata" muted />
                  ) : (
                    <img src={m.ossUrl} className="w-full h-full object-cover" alt={m.title} loading="lazy" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{m.title || '（无标题）'}</div>
                  <div className="text-[10px] text-muted-foreground">{timeAgo(m.parsedAt)}</div>
                </div>
                <div className="flex items-center gap-1">{renderMaterialActions(m, isVideo)}</div>
                <button
                  onClick={() => void handleDelete(m.id)}
                  disabled={deletingId === m.id}
                  title="删除"
                  aria-label="删除"
                  className={iconBtnClass}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

        {total > 0 && (
         <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-foreground">
          <span>
            第 {page}/{totalPages} 页 · 共 {total} 条
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-muted"
            >
              上一页
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-muted"
            >
              下一页
            </button>
          </div>
        </div>
      )}

      {previewUrl && previewType && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => {
            setPreviewUrl(null);
            setPreviewType(null);
          }}
        >
          {previewType === 'video' ? (
            <video
              src={previewUrl}
              controls
              autoPlay
              onClick={(e) => e.stopPropagation()}
              className="max-h-[90vh] max-w-[90vw] rounded-xl bg-black"
            />
          ) : (
            <img
              src={previewUrl}
              alt="preview"
              onClick={(e) => e.stopPropagation()}
              className="max-h-[90vh] max-w-[90vw] object-contain rounded-xl"
            />
          )}
        </div>
      )}

      {parsingMaterial && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-background border border-border p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold">解析确认</h3>
              <button onClick={() => setParsingMaterial(null)} className="text-xs text-muted-foreground hover:text-foreground">关闭</button>
            </div>

            <div className="text-xs text-muted-foreground">
              来源：{buildPostUrl(parsingMaterial) || '无来源链接'}
            </div>

            {parseLoading && <div className="text-sm text-muted-foreground">正在解析帖子内容...</div>}
            {parseError && <div className="text-sm text-red-500">{parseError}</div>}

            {parseData && (
              <div className="space-y-2 text-sm">
                <div>标题：{parseData.title || '（无标题）'}</div>
                <div>作者：{parseData.author?.name || '未知'}</div>
                <div>类型：{parseData.type} · 图片 {parseData.images?.length || 0} 张 {parseData.video?.url ? '· 含视频' : ''}</div>
                <div className="text-xs text-muted-foreground">
                  点赞 {parseData.stats?.likes || 0} · 评论 {parseData.stats?.comments || 0} · 收藏 {parseData.stats?.collects || 0} · 分享 {parseData.stats?.shares || 0}
                </div>
                {parseData.desc && (
                  <div className="rounded-lg border border-border p-3 text-xs whitespace-pre-line max-h-40 overflow-y-auto">
                    {parseData.desc}
                  </div>
                )}
                {parseData.images?.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {parseData.images.slice(0, 8).map((img) => (
                      <img
                        key={img.index}
                        src={proxyXhsImage(img.previewUrl || img.originalUrl)}
                        alt=""
                        className="w-full aspect-square object-cover rounded-md border border-border"
                      />
                    ))}
                  </div>
                )}
                {parseData.video?.url && (
                  <video src={parseData.video.url} controls className="w-full rounded-lg border border-border bg-black" preload="metadata" />
                )}
                <div className="pt-2">
                  <div className="text-xs font-semibold mb-1">评论预览</div>
                  {parseCommentsLoading && <div className="text-xs text-muted-foreground">正在加载评论...</div>}
                  {parseCommentsError && <div className="text-xs text-red-500">{parseCommentsError}</div>}
                  {!parseCommentsLoading && !parseCommentsError && parseComments.length === 0 && (
                    <div className="text-xs text-muted-foreground">暂无评论数据</div>
                  )}
                  {parseComments.length > 0 && (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {parseComments.slice(0, 20).map((c) => (
                        <div key={c.id} className="rounded-md border border-border p-2 text-xs">
                          <div className="font-semibold">{c.nickname}</div>
                          <div className="text-muted-foreground whitespace-pre-line">{c.content}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                disabled={!parseData || saveLoading}
                onClick={() => void confirmSaveToContent()}
                className="px-4 py-2 bg-primary text-white rounded-lg text-xs font-semibold disabled:opacity-50"
              >
                {saveLoading ? '保存中...' : '确认保存到OSS并入作品素材库'}
              </button>
              {saveResult?.contentId && (
                <a
                  href={`/content-library/detail?id=${saveResult.contentId}`}
                  className="px-4 py-2 bg-primary/10 text-primary rounded-lg text-xs font-semibold"
                >
                  进入素材库详情
                </a>
              )}
            </div>
            {saveResult?.message && <div className="text-xs text-muted-foreground">{saveResult.message}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
