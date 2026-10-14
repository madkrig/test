import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'Cedra Bankbekræftelser (prototype)', description: 'Workflowprototype for bankbekræftelser. Syntetiske data.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="da">
      <body>{children}</body>
    </html>
  );
}
