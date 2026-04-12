'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowPathIcon,
  PencilSquareIcon,
  TrashIcon,
  MagnifyingGlassIcon,
  ArrowTopRightOnSquareIcon,
  ChatBubbleLeftEllipsisIcon,
  HeartIcon,
  BookmarkIcon,
} from '@heroicons/react/24/outline';

interface XhsPost {
  id: string;
  note_id: string;
  title: string;
  content?: string;
  author_name?: string;
  author_id?: string;
  author_avatar?: string;
  tags?: Array<string | { name?: string }>;
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

const ITEMS_PER_PAGE = 6;

type TagItem = NonNullable<XhsPost['tags']>[number];

function getTagText(tag: TagItem): string {
  if (typeof tag === 'string') return tag;
  return (tag.name || '').trim();
}

function ContentLibraryContent() {
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('id');
  
  const [allPosts, setAllPosts] = useState<XhsPost[]>([]);
  const [filteredPosts, setFilteredPosts] = useState<XhsPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // 分页和搜索状态
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPost, setSelectedPost] = useState<XhsPost | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

  useEffect(() => {
    loadPosts();
  }, []);

  useEffect(() => {
    // 搜索和筛选
    let filtered = allPosts;
    
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = allPosts.filter(post => 
        post.title?.toLowerCase().includes(term) ||
        post.content?.toLowerCase().includes(term) ||
        post.author_name?.toLowerCase().includes(term) ||
        post.tags?.some((tag) => getTagText(tag).toLowerCase().includes(term))
      );
    }
    
    setFilteredPosts(filtered);
    setCurrentPage(1); // 重置到第一页
  }, [searchTerm, allPosts]);

  const loadPosts = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/content/list/xhs');
      const result = await res.json();
      
      if (result.success) {
        setAllPosts(result.data);
      } else {
        setError(result.error || '加载失败');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const deletePost = async (post: XhsPost) => {
    if (!confirm(`确定要删除作品"${post.title}"吗？`)) return;
    
    try {
      const res = await fetch(`/api/content/delete/xhs`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: post.id })
      });
      
      if (res.ok) {
        await loadPosts();
      } else {
        alert('删除失败');
      }
    } catch (error) {
      alert('删除失败: ' + (error instanceof Error ? error.message : '未知错误'));
    }
  };

  const updatePost = async (updatedPost: XhsPost) => {
    try {
      const res = await fetch(`/api/content/update/xhs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedPost)
      });
      
      if (res.ok) {
        setShowEditModal(false);
        setSelectedPost(null);
        await loadPosts();
      } else {
        alert('更新失败');
      }
    } catch (error) {
      alert('更新失败: ' + (error instanceof Error ? error.message : '未知错误'));
    }
  };

  // 分页计算
  const totalPages = Math.ceil(filteredPosts.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const currentPosts = filteredPosts.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return '未知时间';
    try {
      return new Date(dateStr).toLocaleString('zh-CN');
    } catch {
      return '无效时间';
    }
  };

  const formatNumber = (num?: number) => {
    if (!num) return '0';
    return num >= 10000 ? `${(num / 10000).toFixed(1)}w` : String(num);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
          <p className="text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <button onClick={loadPosts} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg">
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* 头部导航 */}
      <div className="border-b border-border bg-card">
        <div className="max-w-[1560px] mx-auto px-3 sm:px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">内容素材库</h1>
              <div className="text-sm text-muted-foreground">
                共 {filteredPosts.length} 个作品
                {searchTerm && ` (从 ${allPosts.length} 个作品中筛选)`}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button 
                onClick={loadPosts}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-muted border border-border rounded-lg hover:bg-border/50 transition-colors"
              >
                <ArrowPathIcon className="h-3.5 w-3.5" />
                刷新
              </button>
              <Link
                href="/media-analysis"
                className="px-3 py-1.5 bg-primary text-primary-foreground text-xs rounded-lg hover:opacity-90 transition-opacity"
              >
                添加内容
              </Link>
            </div>
          </div>
          
          {/* 搜索框 */}
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder="搜索标题、内容、作者或标签..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 pl-9 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="px-2.5 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                清空
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 主要内容 */}
      <div className="max-w-[1560px] mx-auto px-3 sm:px-4 py-5">
        {currentPosts.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl bg-card">
            <p className="text-xl text-muted-foreground mb-2">
              {searchTerm ? '没有找到匹配的内容' : '还没有保存任何作品'}
            </p>
            <p className="text-sm text-muted-foreground mb-6">
              {searchTerm ? '尝试使用其他关键词搜索' : '去解析一些小红书内容吧！'}
            </p>
            {!searchTerm && (
              <Link
                href="/media-analysis"
                className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
              >
                开始解析内容
              </Link>
            )}
          </div>
        ) : (
          <>
            {/* 内容网格 */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5 gap-3 mb-5">
              {currentPosts.map((post) => (
                <div 
                  key={post.id} 
                  className={`rounded-xl border bg-card p-3 hover:border-primary/30 transition-colors ${
                    highlightId === post.id ? 'ring-2 ring-primary/50' : ''
                  }`}
                >
                  {/* 作者信息 */}
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white text-xs font-medium">
                      {post.author_avatar ? (
                        <img src={post.author_avatar} alt="" className="w-full h-full rounded-full object-cover" />
                      ) : (
                        post.author_name?.charAt(0) || '?'
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-foreground text-xs">
                        {post.author_name || '未知用户'}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatTime(post.saved_at)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setSelectedPost(post);
                          setShowEditModal(true);
                        }}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title="编辑"
                        aria-label="编辑"
                      >
                        <PencilSquareIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => deletePost(post)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        title="删除"
                        aria-label="删除"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* 图片缩略图 */}
                  {post.images && post.images.length > 0 && (
                    <div className="flex gap-1.5 mb-2">
                      {post.images.slice(0, 3).map((img, idx) => (
                        <div key={idx} className="relative flex-1 aspect-square rounded-md overflow-hidden bg-muted max-w-[74px]">
                          <img
                            src={img.oss_url || img.original_url}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                          {idx === 2 && post.images!.length > 3 && (
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-xs font-semibold">
                              +{post.images!.length - 3}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 标题 */}
                  <h3 className="text-sm font-semibold text-foreground mb-1 line-clamp-2 leading-5">
                    {post.title || '无标题'}
                  </h3>

                  {/* 内容摘要 */}
                  {post.content && (
                    <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                      {post.content}
                    </p>
                  )}

                  {/* 标签 */}
                  {post.tags && post.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {post.tags.slice(0, 2).map((tag, idx) => (
                        <span key={idx} className="px-1.5 py-0.5 bg-pink-100 text-pink-700 text-[11px] rounded-full dark:bg-pink-900/40 dark:text-pink-300">
                          #{getTagText(tag)}
                        </span>
                      ))}
                      {post.tags.length > 2 && (
                        <span className="px-1.5 py-0.5 bg-muted text-muted-foreground text-[11px] rounded-full">
                          +{post.tags.length - 2}
                        </span>
                      )}
                    </div>
                  )}

                  {/* 互动数据 */}
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-2">
                    <div className="flex items-center gap-1">
                      <HeartIcon className="h-3.5 w-3.5" />
                      <span>{formatNumber(post.like_count)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <ChatBubbleLeftEllipsisIcon className="h-3.5 w-3.5" />
                      <span>{formatNumber(post.comment_count)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <BookmarkIcon className="h-3.5 w-3.5" />
                      <span>{formatNumber(post.collect_count)}</span>
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex gap-2">
                    {post.original_url && (
                      <a
                        href={post.original_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title="查看原帖"
                        aria-label="查看原帖"
                      >
                        <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                      </a>
                    )}
                    <a
                      href={`/content-library/detail?id=${post.id}`}
                      className="flex-1 py-1.5 px-3 bg-primary text-primary-foreground rounded-lg text-xs font-medium text-center hover:opacity-90 transition-opacity"
                    >
                      详情
                    </a>
                  </div>
                </div>
              ))}
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1.5 border border-border rounded-lg hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  上一页
                </button>
                <span className="px-3 py-1.5 rounded-lg border border-border bg-muted text-foreground">
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1.5 border border-border rounded-lg hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  下一页
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 编辑模态框 */}
      {showEditModal && selectedPost && (
        <EditPostModal
          post={selectedPost}
          onSave={updatePost}
          onClose={() => {
            setShowEditModal(false);
            setSelectedPost(null);
          }}
        />
      )}
    </div>
  );
}

// 编辑模态框组件
function EditPostModal({ 
  post, 
  onSave, 
  onClose 
}: { 
  post: XhsPost; 
  onSave: (post: XhsPost) => void; 
  onClose: () => void; 
}) {
  const [editedPost, setEditedPost] = useState({ ...post });

  const handleSave = () => {
    onSave(editedPost);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-foreground">编辑作品</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              ✕
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">标题</label>
              <input
                type="text"
                value={editedPost.title}
                onChange={(e) => setEditedPost({ ...editedPost, title: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">内容</label>
              <textarea
                value={editedPost.content || ''}
                onChange={(e) => setEditedPost({ ...editedPost, content: e.target.value })}
                rows={4}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">作者名称</label>
              <input
                type="text"
                value={editedPost.author_name || ''}
                onChange={(e) => setEditedPost({ ...editedPost, author_name: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">标签 (用逗号分隔)</label>
              <input
                type="text"
                value={editedPost.tags?.join(', ') || ''}
                onChange={(e) => setEditedPost({ 
                  ...editedPost, 
                  tags: e.target.value.split(',').map(tag => tag.trim()).filter(Boolean) 
                })}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>

          <div className="flex gap-3 mt-6 pt-6 border-t border-border">
            <button
              onClick={onClose}
              className="flex-1 py-2 px-4 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="flex-1 py-2 px-4 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ContentLibraryPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-pink-50 to-purple-50 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pink-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">加载中...</p>
        </div>
      </div>
    }>
      <ContentLibraryContent />
    </Suspense>
  );
}
