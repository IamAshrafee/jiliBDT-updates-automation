import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'JiliBDT Phase 1 Admin',
  description: 'Administrator review surface for Google Sheet update preparation.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
