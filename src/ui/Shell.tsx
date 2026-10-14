import Link from 'next/link';
import type { ReactNode } from 'react';
import { DemoControls } from './client/demo';
import { ROLE } from './labels';
import type { Session } from './session';

type Nav = [label: string, href: string, key: string];

function navFor(role: string): Nav[] {
  if (role === 'AUDITOR') return [['Mine revisioner', '/auditflow', 'mine'], ['Portefølje', '/auditflow/portfolio', 'portfolio']];
  const nav: Nav[] = [['Arbejdskø', '/kerne', 'queue']];
  if (role === 'SERVICE_OWNER') nav.push(['Fuldstændighed', '/kerne/completeness', 'completeness']);
  nav.push(['Bankregister', '/admin/banks', 'banks']);
  return nav;
}

/** Fælles ramme: AuditFlow for revisorer, Kerne for de administrative roller (brief afsnit 6). */
export function Shell({ s, active, children }: { s: Session; active: string; children: ReactNode }) {
  const isAuditFlow = s.actor.role === 'AUDITOR';
  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">Cedra</Link>
        <span className={`product ${isAuditFlow ? 'product-af' : 'product-kerne'}`}>{isAuditFlow ? 'AuditFlow' : 'Kerne'}</span>
        <nav>
          {navFor(s.actor.role).map(([label, href, key]) => (
            <Link key={key} href={href} className={key === active ? 'active' : undefined}>{label}</Link>
          ))}
        </nav>
        <DemoControls today={s.today} actorId={s.actor.id} users={s.users.filter((u) => u.role !== 'SYSTEM').map((u) => ({ id: u.id, label: `${u.name} · ${ROLE[u.role] ?? u.role}` }))} />
      </header>
      <main className="page">{children}</main>
      <footer className="foot muted">Syntetiske data · prototype</footer>
    </>
  );
}
