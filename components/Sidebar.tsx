'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

const NAV = [
  {
    href: '/parse',
    label: '视频解析',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
    ),
  },
  {
    href: '/metaai',
    label: 'Meta AI 创作',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    href: '/image-generate',
    label: '图片生成',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V5z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 13l2.5-2.5a1 1 0 011.414 0L16 14.586M8 17h8" />
        <circle cx="9" cy="8" r="1.5" />
      </svg>
    ),
  },
  {
    href: '/ads-dispatcher',
    label: '调度任务',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
      </svg>
    ),
  },
  {
    href: '/visual-story',
    label: '视觉故事',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 6.5A2.5 2.5 0 017.5 4H19v14H7.5A2.5 2.5 0 015 15.5v-9z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 8h7M8.5 12h5M5 15.5A2.5 2.5 0 017.5 13H19" />
      </svg>
    ),
  },
  {
    href: '/topic-ideas',
    label: '今日选题',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l2.4 4.86 5.37.78-3.89 3.79.92 5.35L12 15.7l-4.8 2.52.92-5.35-3.89-3.79 5.37-.78L12 3z" />
      </svg>
    ),
  },
  {
    href: '/publish',
    label: '视频发布',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
    ),
  },
  {
    href: '/workflows',
    label: '工作流管理',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
  },
  {
    href: '/nodes',
    label: '节点库',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
      </svg>
    ),
  },
  {
    href: '/media-analysis',
    label: '自媒体解析',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
  },
  {
    href: '/content-library',
    label: '作品素材库',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    ),
  },
  {
    href: '/materials',
    label: '素材库',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
      </svg>
    ),
  },
  {
    href: '/settings/backends',
    label: '后端配置',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317a1 1 0 011.35-.936l1.93.965a1 1 0 00.894 0l1.93-.965a1 1 0 011.35.936v2.168a1 1 0 00.553.894l1.93.965a1 1 0 010 1.788l-1.93.965a1 1 0 00-.553.894v2.168a1 1 0 01-1.35.936l-1.93-.965a1 1 0 00-.894 0l-1.93.965a1 1 0 01-1.35-.936v-2.168a1 1 0 00-.553-.894l-1.93-.965a1 1 0 010-1.788l1.93-.965a1 1 0 00.553-.894V4.317z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
      </svg>
    ),
  },
  {
    href: '/docs',
    label: '接口',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
];

export default function Sidebar({
  className = '',
  compact = false,
  onNavigate,
  headerRight,
}: {
  className?: string;
  compact?: boolean;
  onNavigate?: () => void;
  headerRight?: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <aside className={`w-52 shrink-0 border-r border-border bg-card flex flex-col py-6 px-3 gap-1 transition-colors ${className}`}>
      {/* Logo */}
      <div className="px-3 mb-6 flex items-start justify-between gap-2">
        <div>
          <span className="text-lg font-bold tracking-tight text-foreground">doouyin</span>
          <p className="text-xs text-muted-foreground mt-0.5">视频解析 & 发布</p>
        </div>
        {headerRight}
      </div>

      {NAV.map(({ href, label, icon }) => {
        const active = pathname === href || pathname.startsWith(href + '/');
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
              active
                ? 'bg-primary/10 text-primary border border-primary/20 shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
            title={label}
          >
            {icon}
            {!compact && label}
          </Link>
        );
      })}
    </aside>
  );
}
