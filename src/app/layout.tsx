import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'TEC · 海空運內部報價', description: '海空運客戶國家運價與報價管理系統' };
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
