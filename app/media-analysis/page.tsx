'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type CookieStatusMap = Record<string, boolean>;

interface Platform {
  id: string;
  name: string;
  icon: string;
  description: string;
  path: string;
  cookieApi?: string;
}

const platforms: Platform[] = [
  {
    id: 'douyin',
    name: '抖音解析',
    icon: '🎬',
    description: '抖音视频解析与下载',
    path: '/parse',
    cookieApi: '/api/cookie'
  },
  {
    id: 'xhs',
    name: '小红书解析',
    icon: '📱',
    description: '小红书图文内容解析',
    path: '/analysis/xhs',
    cookieApi: '/api/analysis/xhs/cookie'
  }
];

let initialCookieStatusCache: CookieStatusMap | null = null;
let initialCookieStatusPromise: Promise<CookieStatusMap> | null = null;

async function requestAllCookieStatus(): Promise<CookieStatusMap> {
  const entries = await Promise.all(
    platforms.map(async (platform) => {
      if (!platform.cookieApi) return [platform.id, true] as const;

      try {
        const res = await fetch(platform.cookieApi);
        const data = await res.json();
        return [platform.id, Boolean(data.set ?? data.valid)] as const;
      } catch {
        return [platform.id, false] as const;
      }
    })
  );

  return Object.fromEntries(entries);
}

export default function MediaAnalysisPage() {
  const router = useRouter();
  const [cookieStatus, setCookieStatus] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const checkAllCookieStatus = useCallback(async (options?: { force?: boolean }) => {
    setLoading(true);

    try {
      const status = await (async () => {
        if (options?.force) {
          const nextStatus = await requestAllCookieStatus();
          initialCookieStatusCache = nextStatus;
          return nextStatus;
        }

        if (initialCookieStatusCache) return initialCookieStatusCache;

        if (!initialCookieStatusPromise) {
          initialCookieStatusPromise = requestAllCookieStatus()
            .then((nextStatus) => {
              initialCookieStatusCache = nextStatus;
              return nextStatus;
            })
            .finally(() => {
              initialCookieStatusPromise = null;
            });
        }

        return initialCookieStatusPromise;
      })();

      setCookieStatus(status);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkAllCookieStatus();
  }, [checkAllCookieStatus]);

  const clearCookie = async (platform: Platform) => {
    if (!platform.cookieApi) return;
    
    try {
      await fetch(platform.cookieApi, { method: 'DELETE' });
      await checkAllCookieStatus({ force: true });
    } catch {
      // 静默处理错误
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* 头部 */}
      <div className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">自媒体解析平台</h1>
              <p className="text-muted-foreground">解析多平台内容，提取图文/视频及数据，纯 HTTP 无需打开浏览器</p>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/content-library"
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
              >
                📚 作品库
              </Link>
              <button
                onClick={() => void checkAllCookieStatus({ force: true })}
                className="px-4 py-2 bg-muted border border-border rounded-lg text-sm hover:bg-border/50 transition-colors"
              >
                {loading ? '检查中...' : '🔄 刷新状态'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 主要内容 */}
      <div className="container mx-auto px-4 py-8">
        {/* 快速访问 */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-foreground mb-4">平台解析</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {platforms.map((platform) => (
              <div
                key={platform.id}
                className="rounded-xl border border-border bg-card p-6 hover:border-primary/30 transition-colors group cursor-pointer"
                onClick={() => router.push(platform.path)}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="text-4xl mb-2">{platform.icon}</div>
                  <div className={`px-2 py-1 text-xs rounded-full ${
                    loading ? 'bg-muted text-muted-foreground' :
                    cookieStatus[platform.id] ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' :
                    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
                  }`}>
                    {loading ? '检查中...' : 
                     cookieStatus[platform.id] ? '✅ 就绪' : '⚠️ 需配置'}
                  </div>
                </div>
                
                <h3 className="text-lg font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">
                  {platform.name}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">{platform.description}</p>
                
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-primary font-medium">点击进入</span>
                  <span className="text-muted-foreground">→</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cookie 管理 */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-foreground mb-4">Cookie 管理</h2>
          <div className="rounded-xl border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground mb-4">
              💡 <strong>推荐使用Chrome插件</strong>：安装我们的Chrome扩展程序，可以自动读取浏览器登录状态，一键同步Cookie到解析平台。
            </p>
            
            <div className="space-y-3">
              {platforms.filter(p => p.cookieApi).map((platform) => (
                <div key={platform.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{platform.icon}</span>
                    <div>
                      <div className="font-medium text-foreground">{platform.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {cookieStatus[platform.id] ? '已配置Cookie，可以正常解析' : '需要配置Cookie才能解析'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`px-3 py-1 text-xs rounded-full ${
                      cookieStatus[platform.id] ? 
                      'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' :
                      'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
                    }`}>
                      {cookieStatus[platform.id] ? '✅ 已设置' : '⚠️ 未设置'}
                    </div>
                    {cookieStatus[platform.id] && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          clearCookie(platform);
                        }}
                        className="text-xs text-red-500 hover:text-red-600 px-2 py-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                      >
                        清除
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 功能导航 */}
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-4">功能导航</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link
              href="/content-library"
              className="p-4 rounded-lg border border-border bg-card hover:border-primary/30 transition-colors group"
            >
              <div className="text-2xl mb-2">📚</div>
              <h3 className="font-medium text-foreground group-hover:text-primary transition-colors">作品素材库</h3>
              <p className="text-sm text-muted-foreground">查看已保存的解析内容</p>
            </Link>
            
            <Link
              href="/analysis"
              className="p-4 rounded-lg border border-border bg-card hover:border-primary/30 transition-colors group"
            >
              <div className="text-2xl mb-2">⚙️</div>
              <h3 className="font-medium text-foreground group-hover:text-primary transition-colors">解析设置</h3>
              <p className="text-sm text-muted-foreground">配置Cookie和解析参数</p>
            </Link>
            
            <button
              onClick={() => window.open('chrome://extensions/', '_blank')}
              className="p-4 rounded-lg border border-border bg-card hover:border-primary/30 transition-colors group text-left"
            >
              <div className="text-2xl mb-2">🧩</div>
              <h3 className="font-medium text-foreground group-hover:text-primary transition-colors">Chrome插件</h3>
              <p className="text-sm text-muted-foreground">安装插件自动同步Cookie</p>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
