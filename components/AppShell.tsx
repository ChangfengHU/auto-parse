'use client';

import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import GlobalNotifications from '@/components/xhs/GlobalNotifications';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <>
      <div className="flex min-h-screen">
        <Sidebar className="hidden md:flex" />
        <main className="flex-1 min-h-screen overflow-y-auto">
          <div className="md:hidden sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur px-4 py-3 flex items-center justify-between">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="inline-flex items-center justify-center rounded-lg border border-border px-2.5 py-1.5 text-sm"
            >
              菜单
            </button>
            <span className="text-sm font-semibold">doouyin</span>
            <span className="w-12" />
          </div>
          {children}
        </main>
      </div>

      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => setMobileNavOpen(false)} />
          <Sidebar
            onNavigate={() => setMobileNavOpen(false)}
            className="h-full"
            headerRight={
              <button
                onClick={() => setMobileNavOpen(false)}
                className="inline-flex items-center justify-center rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                关闭
              </button>
            }
          />
        </div>
      )}
      <GlobalNotifications />
    </>
  );
}

