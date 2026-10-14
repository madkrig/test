import type { ReactNode } from 'react';
import { fmtDate, tagClass } from '../_lib/format';

export function Tag({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={tagClass(tone)}>{children}</span>;
}

/** Frister farvekodes: rød = overskredet, gul = inden for 3 hverdage (S01). */
export function Deadline({ date, tone }: { date: string | null | undefined; tone: 'overdue' | 'soon' | 'ok' | null }) {
  if (!date) return <span className="muted">–</span>;
  return <span className={`deadline ${tone ?? ''}`} title={tone === 'overdue' ? 'Frist overskredet' : tone === 'soon' ? 'Inden for 3 hverdage' : undefined}>{fmtDate(date)}</span>;
}

export interface TrackStep { key: string; label: string; state: 'done' | 'current' | 'todo'; counter?: string }

/** Pakkesporing (US-R-04): samme trin for revisor, kerneteam og ledelse. */
export function Tracking({ steps, compact = false }: { steps: TrackStep[]; compact?: boolean }) {
  return (
    <ol className={`tracking${compact ? ' compact' : ''}`} aria-label="Pakkesporing">
      {steps.map((s, i) => (
        <li key={s.key} className={s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
          <b aria-hidden="true">{s.state === 'done' ? '✓' : i + 1}</b>
          <span>{s.label}{s.counter ? ` (${s.counter})` : ''}</span>
        </li>
      ))}
    </ol>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
