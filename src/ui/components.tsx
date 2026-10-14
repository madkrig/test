import Link from 'next/link';
import type { ReactNode } from 'react';
import { EVENT, humanize, stamp, type Badge, type Tone } from './labels';

export function Pill({ badge, small }: { badge: Badge | null; small?: boolean }) {
  if (!badge) return <span className="muted">–</span>;
  return (
    <span className={`pill tone-${badge.tone}${small ? ' pill-sm' : ''}`}>
      <span aria-hidden>{badge.icon}</span> {badge.label}
    </span>
  );
}

export function Mark({ ok, label }: { ok: boolean; label: ReactNode }) {
  return (
    <li className={`check ${ok ? 'ok' : 'no'}`}>
      <span className="check-icon" aria-hidden>{ok ? '√' : '■'}</span>
      <span>{label}</span>
    </li>
  );
}

export function Card({ title, aside, children, className }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || aside) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {aside && <div className="card-aside">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Callout({ tone = 'grey', children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`callout tone-${tone}`}>{children}</div>;
}

export function PageTitle({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <div className="page-title">
      <h1>{title}</h1>
      {sub && <p className="muted">{sub}</p>}
    </div>
  );
}

/** Statuslinjen fra Figma: navn · status · næste handling · ejer og deadline. */
export function StatusBar({ label, badge, next, owner, deadline }: { label: string; badge: Badge; next: string; owner: string; deadline?: string }) {
  return (
    <div className="statusbar">
      <strong>{label}</strong>
      <Pill badge={badge} />
      <span className="statusbar-next">Næste handling: {next}</span>
      <span className="muted statusbar-owner">
        Ejer: {owner}
        {deadline ? ` · Deadline: ${deadline}` : ''}
      </span>
    </div>
  );
}

export function Kpis({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="kpis">
      {items.map(([label, value]) => (
        <div key={label} className="kpi">
          <span className="muted">{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field-row">
      <span className="muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}

export interface EventRow { id: string; at: string; actorId: string; action: string; change: string | null; reason: string | null }

export function EventLog({ events, name, limit = 12 }: { events: EventRow[]; name: (id: string) => string; limit?: number }) {
  const shown = events.filter((e) => e.action !== 'ACCESS_DENIED');
  const recent = shown.slice(-limit);
  return (
    <div className="events">
      {shown.length > recent.length && <p className="muted small">{shown.length - recent.length} ældre hændelser skjult</p>}
      {recent.length === 0 && <p className="muted small">Ingen hændelser endnu.</p>}
      <ol>
        {recent.map((e) => (
          <li key={e.id}>
            <span className="muted small">{stamp(e.at)} · {name(e.actorId)}</span>
            <span>
              {EVENT[e.action] ?? e.action}
              {e.change ? <span className="muted"> · {humanize(e.change, name)}</span> : null}
            </span>
            {e.reason && <span className="muted small">Begrundelse: {e.reason}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Denied({ error }: { error: { code: string; message: string; recovery?: string } }) {
  return (
    <Card title={error.code === 'FORBIDDEN' ? 'Ingen adgang' : 'Kan ikke vises'}>
      <p>{error.message}</p>
      {error.recovery && <p className="muted">{error.recovery}</p>}
      <p><Link href="/">Skift bruger</Link></p>
    </Card>
  );
}
