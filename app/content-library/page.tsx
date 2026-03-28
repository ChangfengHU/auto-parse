'use client';

import { useState, useEffect } from 'react';
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
}

export default function ContentLibraryPage() {
  const [posts, setPosts] = useState<XhsPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadPosts();
  }, []);

  const loadPosts = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/content/list/xhs');
      const result = await res.json();
      
      if (result.success) {
        setPosts(result.data);
      } else {
        setError(result.error || '加载失败');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (num?: number) => {
    if (!num) return '0';
    if (num >= 10000) return `${(num / 10000).toFixed(1)}w`;
    return num.toString();
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-muted-foreground">加载内容库...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-4xl mb-4">❌</div>
          <p className="text-red-600 mb-4">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
          >
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
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold text-foreground">内容素材库</h1>
              <div className="text-sm text-muted-foreground">
                共 {posts.length} 个作品
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
                href="/analysis"
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
              >
                + 新增内容
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* 内容列表 */}
      <div className="container mx-auto px-4 py-6">
        {posts.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">📱</div>
            <h3 className="text-xl font-semibold text-foreground mb-2">暂无内容</h3>
            <p className="text-muted-foreground mb-6">开始解析一些小红书内容来构建你的素材库</p>
            <Link 
              href="/analysis"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
            >
              <span>🔍</span>
              去解析内容
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {posts.map((post) => (
              <div key={post.id} className="rounded-xl border border-border bg-card p-5 hover:border-primary/30 transition-colors group">
                {/* 作者信息 */}
                <div className="flex items-center gap-3 mb-4">
                  {post.author_avatar ? (
                    <img 
                      src={post.author_avatar} 
                      alt={post.author_name || '用户'} 
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-primary text-sm">👤</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground truncate">
                      {post.author_name || '未知用户'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(post.publish_time)}
                    </div>
                  </div>
                </div>

                {/* 标题和内容 */}
                <div className="mb-4">
                  <h3 className="font-semibold text-foreground mb-2 line-clamp-2 group-hover:text-primary transition-colors">
                    {post.title}
                  </h3>
                  {post.content && (
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {post.content}
                    </p>
                  )}
                </div>

                {/* 标签 */}
                {post.tags && post.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-4">
                    {post.tags.slice(0, 3).map((tag: any, index: number) => (
                      <span key={index} className="text-xs px-2 py-1 bg-primary/10 text-primary rounded-full">
                        #{typeof tag === 'string' ? tag : tag.name}
                      </span>
                    ))}
                    {post.tags.length > 3 && (
                      <span className="text-xs text-muted-foreground">+{post.tags.length - 3}</span>
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
                <div className="flex items-center gap-2">
                  {post.original_url && (
                    <a
                      href={post.original_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 px-3 py-2 text-xs text-center bg-muted border border-border rounded-lg hover:bg-border/50 transition-colors"
                    >
                      查看原帖 ↗
                    </a>
                  )}
                  <button className="px-3 py-2 text-xs bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors">
                    查看详情
                  </button>
                </div>

                {/* 元信息 */}
                <div className="mt-4 pt-3 border-t border-border text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>保存于 {formatDate(post.saved_at)}</span>
                    <span className="font-mono text-xs opacity-60">#{post.note_id.slice(-6)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}