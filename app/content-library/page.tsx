'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface XhsPost {
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

const ITEMS_PER_PAGE = 6;

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
        post.tags?.some(tag => {
          const tagStr = typeof tag === 'string' ? tag : (tag as any)?.name || String(tag);
          return tagStr.toLowerCase().includes(term);
        })
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
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-foreground">内容素材库</h1>
              <div className="text-sm text-muted-foreground">
                共 {filteredPosts.length} 个作品
                {searchTerm && ` (从 ${allPosts.length} 个作品中筛选)`}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button 
                onClick={loadPosts}
                className="px-4 py-2 text-sm bg-muted border border-border rounded-lg hover:bg-border/50 transition-colors"
              >
                🔄 刷新
              </button>
              <Link
                href="/media-analysis"
                className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:opacity-90 transition-opacity"
              >
                ➕ 添加内容
              </Link>
            </div>
          </div>
          
          {/* 搜索框 */}
          <div className="flex items-center gap-4">
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder="搜索标题、内容、作者或标签..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-2 pl-10 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
                🔍
              </div>
            </div>
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                清空
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 主要内容 */}
      <div className="container mx-auto px-4 py-8">
        {currentPosts.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📚</div>
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
                ➕ 开始解析内容
              </Link>
            )}
          </div>
        ) : (
          <>
            {/* 内容网格 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {currentPosts.map((post) => (
                <div 
                  key={post.id} 
                  className={`rounded-xl border bg-card p-6 hover:border-primary/30 transition-colors ${
                    highlightId === post.id ? 'ring-2 ring-primary/50' : ''
                  }`}
                >
                  {/* 作者信息 */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white text-sm font-medium">
                      {post.author_avatar ? (
                        <img src={post.author_avatar} alt="" className="w-full h-full rounded-full object-cover" />
                      ) : (
                        post.author_name?.charAt(0) || '?'
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-foreground text-sm">
                        {post.author_name || '未知用户'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatTime(post.saved_at)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setSelectedPost(post);
                          setShowEditModal(true);
                        }}
                        className="p-1.5 text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                        title="编辑"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => deletePost(post)}
                        className="p-1.5 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                        title="删除"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>

                  {/* 图片缩略图 */}
                  {post.images && post.images.length > 0 && (
                    <div className="flex gap-1.5 mb-3">
                      {post.images.slice(0, 3).map((img, idx) => (
                        <div key={idx} className="relative flex-1 aspect-square rounded-lg overflow-hidden bg-muted max-w-[80px]">
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
                  <h3 className="text-base font-semibold text-foreground mb-3 line-clamp-2">
                    {post.title || '无标题'}
                  </h3>

                  {/* 内容摘要 */}
                  {post.content && (
                    <p className="text-sm text-muted-foreground mb-4 line-clamp-3">
                      {post.content}
                    </p>
                  )}

                  {/* 标签 */}
                  {post.tags && post.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-4">
                      {post.tags.slice(0, 3).map((tag, idx) => (
                        <span key={idx} className="px-2 py-1 bg-pink-100 text-pink-700 text-xs rounded-full dark:bg-pink-900/40 dark:text-pink-300">
                          #{typeof tag === 'string' ? tag : (tag as any).name || tag}
                        </span>
                      ))}
                      {post.tags.length > 3 && (
                        <span className="px-2 py-1 bg-muted text-muted-foreground text-xs rounded-full">
                          +{post.tags.length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  {/* 互动数据 */}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
                    <div className="flex items-center gap-1">
                      <span>❤️</span>
                      <span>{formatNumber(post.like_count)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span>💬</span>
                      <span>{formatNumber(post.comment_count)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span>⭐</span>
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
                        className="flex-1 py-2 px-3 bg-muted border border-border rounded-lg text-xs font-medium text-center hover:bg-border/50 transition-colors"
                      >
                        查看原帖 ↗
                      </a>
                    )}
                    <a
                      href={`/content-library/detail?id=${post.id}`}
                      className="flex-1 py-2 px-3 bg-primary text-primary-foreground rounded-lg text-xs font-medium text-center hover:opacity-90 transition-opacity"
                    >
                      查看详情
                    </a>
                  </div>

                  <div className="mt-3 pt-3 border-t border-border text-right">
                    <span className="text-xs text-muted-foreground">#{post.id}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  上一页
                </button>
                
                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                        currentPage === page
                          ? 'bg-primary text-primary-foreground'
                          : 'border border-border hover:bg-muted'
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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