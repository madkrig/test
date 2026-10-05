import type { ReactNode } from 'react';
import { Header } from './_components/Header';
import './globals.css';

export const metadata = { title: 'Cedra E-signering via Penneo (prototype)' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="da">
      <body>
        <Header />
        <main className="main">{children}</main>
        <footer className="footer">Cedra – prototype af e-signering via Penneo. Alle data er syntetiske.</footer>
      </body>
    </html>
  );
}
