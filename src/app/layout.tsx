import type { Metadata, Viewport } from 'next';
import type { ReactElement } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: '文豪 · 让学习变成一件会发光的小事',
  description:
    '文豪是一个有趣、轻盈的 AI 学习空间，把视频、课件和笔记整理成清楚的知识卡、复习提醒与学习路径。',
  keywords: ['AI 学习平台', '智能笔记', '间隔重复', '知识图谱', '文豪'],
  authors: [{ name: '文豪团队' }],
  openGraph: {
    title: '文豪 · AI 学习空间',
    description: '把学习，变成一件会发光的小事。',
    type: 'website',
    locale: 'zh_CN',
  },
};

export const viewport: Viewport = {
  themeColor: '#FFF9F0',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }): ReactElement {
  return (
    <html lang="zh-CN">
      <head>
        {/* 字体stylesheet由全局CSS加载，保留预连接和系统字体回退。 */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="min-h-screen bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
