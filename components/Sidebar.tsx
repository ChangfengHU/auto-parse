'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

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
    href: '/publish',
    label: '视频发布',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
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
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-52 shrink-0 border-r border-gray-800 bg-gray-950 flex flex-col py-6 px-3 gap-1">
      {/* Logo */}
      <div className="px-3 mb-6">
        <span className="text-lg font-bold tracking-tight text-white">doouyin</span>
        <p className="text-xs text-gray-600 mt-0.5">视频解析 & 发布</p>
      </div>

      {NAV.map(({ href, label, icon }) => {
        const active = pathname === href || pathname.startsWith(href + '/');
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              active
                ? 'bg-pink-600/20 text-pink-400 border border-pink-600/30'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`}
          >
            {icon}
            {label}
          </Link>
        );
      })}
    </aside>
  );
}
