import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import Sidebar from '@/components/Sidebar';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'doouyin — 视频解析 & 发布平台',
  description: '抖音/小红书/TikTok 视频去水印解析 + 一键发布到抖音',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-950 text-white`}>
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 min-h-screen overflow-y-auto">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
