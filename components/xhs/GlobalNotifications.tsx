'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';

export default function GlobalNotifications() {
  const pathname = usePathname();
  const [unread, setUnread] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const enabled = pathname?.startsWith('/analysis/xhs');

  useEffect(() => {
    if (!enabled) {
      setUnread(null);
      setOpen(false);
      return;
    }
    // 轮询频率：每 60 秒查一次
    const fetchUnread = async () => {
      try {
        const res = await fetch('/api/analysis/xhs/unread');
        const d = await res.json();
        if (d.ok && d.data) {
          setUnread(d.data);
        }
      } catch (e) {
        // 静默失败，防干扰主业务
      }
    };
    
    fetchUnread();
    const timer = setInterval(fetchUnread, 60000);
    return () => clearInterval(timer);
  }, [enabled]);

  if (!enabled) return null;

  if (!unread) return null;

  const total = 
    (unread.likes || 0) + 
    (unread.comments || 0) + 
    (unread.mentions || 0) + 
    (unread.fans || 0);

  if (total === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="bg-card border border-border rounded-xl shadow-2xl p-4 w-64 animate-in slide-in-from-bottom-5 fade-in duration-200">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold">小红书情报雷达</h3>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
          </div>
          <div className="space-y-2 text-sm">
            {unread.likes > 0 && <div className="flex justify-between"><span>❤️ 赞与收藏</span> <span className="font-bold text-red-500">+{unread.likes}</span></div>}
            {unread.comments > 0 && <div className="flex justify-between"><span>💬 新评论</span> <span className="font-bold text-blue-500">+{unread.comments}</span></div>}
            {unread.mentions > 0 && <div className="flex justify-between"><span>👉 被 @提及时</span> <span className="font-bold text-purple-500">+{unread.mentions}</span></div>}
            {unread.fans > 0 && <div className="flex justify-between"><span>👋 新粉丝</span> <span className="font-bold text-green-500">+{unread.fans}</span></div>}
          </div>
          <a href="/analysis/xhs" className="block w-full text-center mt-4 py-1.5 bg-muted hover:bg-muted/80 text-xs rounded-md transition-colors">
            前往处理
          </a>
        </div>
      )}

      <button 
        onClick={() => setOpen(!open)}
        className="w-12 h-12 bg-white dark:bg-zinc-800 rounded-full shadow-lg border border-border flex items-center justify-center hover:scale-105 transition-transform relative group"
      >
        <span className="text-xl">🔔</span>
        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full font-bold border-2 border-white dark:border-zinc-800 animate-pulse">
          {total > 99 ? '99+' : total}
        </span>
      </button>
    </div>
  );
}
