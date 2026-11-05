import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'TEC · 航空貨運內部報價', description: '本機航空貨運合約與報價管理系統' };
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
