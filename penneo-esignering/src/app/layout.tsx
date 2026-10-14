import type { ReactNode } from 'react';
import { AppShell } from './_components/AppShell';
import './globals.css';

export const metadata = { title: 'Cedra · E-signering' };
export const viewport = { themeColor: '#163b40' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="da">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
