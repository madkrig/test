import type { ReactNode } from 'react';

export const metadata = { title: 'Cedra Bankbekræftelser (prototype)' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="da">
      <body>{children}</body>
    </html>
  );
}
