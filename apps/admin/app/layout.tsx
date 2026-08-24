import type { Metadata } from 'next';
import { extensionAttributeCleanupScript } from './extension-attribute-cleanup';
import './globals.css';

export const metadata: Metadata = {
  title: 'JiliBDT Operations',
  description: 'Private administrator portal for supervised update preparation and delivery.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: extensionAttributeCleanupScript }} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
