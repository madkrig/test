'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ErrorBox, type ApiError } from './action';

const COOKIE = 'cedra-user';

export function setUserCookie(id: string) {
  document.cookie = `${COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
}

/** Demodatoer, der matcher demo-scriptet (docs/demo-script.md). */
export const DEMO_DATES: [string, string][] = [
  ['2026-11-12', '12.11.2026 · populationsgodkendelse'],
  ['2026-11-20', '20.11.2026 · autorisation'],
  ['2026-12-03', '03.12.2026 · udsendelse (T-4 uger)'],
  ['2027-01-08', '08.01.2027 · svar modtaget'],
  ['2027-01-15', '15.01.2027 · påmindelse 1'],
  ['2027-01-22', '22.01.2027 · påmindelse 2'],
  ['2027-02-01', '01.02.2027 · T-10 arbejdsdage'],
];

export function DemoControls({ today, actorId, users }: { today: string; actorId: string; users: { id: string; label: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);

  async function changeDate(date: string) {
    const out = await api('POST', '/api/demo/clock', { date });
    setError(out.ok ? null : out.error);
    router.refresh();
  }

  return (
    <div className="demo-controls">
      <label className="demo-date" title="Fælles demodato for alle brugere">
        <span>Demodato</span>
        <input type="date" value={today} onChange={(e) => e.target.value && void changeDate(e.target.value)} />
      </label>
      <select
        aria-label="Skift bruger"
        value={actorId}
        onChange={(e) => {
          setUserCookie(e.target.value);
          router.push('/start');
        }}
      >
        {users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
      </select>
      {error && <div className="demo-error"><ErrorBox error={error} /></div>}
    </div>
  );
}

export function RolePicker({ users }: { users: { id: string; name: string; role: string; hint: string }[] }) {
  const router = useRouter();
  return (
    <div className="role-grid">
      {users.map((u) => (
        <button
          key={u.id}
          type="button"
          className="role-card"
          onClick={() => {
            setUserCookie(u.id);
            router.push('/start');
          }}
        >
          <strong>{u.name}</strong>
          <span className="muted">{u.role}</span>
          <span className="small">{u.hint}</span>
        </button>
      ))}
    </div>
  );
}

export function DemoTools({ today }: { today: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function reset(state: 'start' | 'brief') {
    if (!window.confirm('Nulstil alle syntetiske demodata? Ændringer i denne demo går tabt.')) return;
    setBusy(true);
    const out = await api('POST', '/api/demo/reset', { state });
    setBusy(false);
    setError(out.ok ? null : out.error);
    if (out.ok) setMessage(`Nulstillet til ${state === 'start' ? 'start' : 'brief'}-tilstand · demodato ${out.data.data.today}`);
    router.refresh();
  }

  async function changeDate(date: string) {
    const out = await api('POST', '/api/demo/clock', { date });
    setError(out.ok ? null : out.error);
    router.refresh();
  }

  return (
    <div className="stack">
      <div className="row wrap">
        <button className="btn btn-secondary" disabled={busy} onClick={() => void reset('start')}>Nulstil til start (12.11.2026)</button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => void reset('brief')}>Nulstil til brief-tilstand (15.01.2027)</button>
      </div>
      <label className="stack-sm">
        <span className="muted small">Demodato (i dag: {today})</span>
        <select value={DEMO_DATES.some(([d]) => d === today) ? today : ''} onChange={(e) => e.target.value && void changeDate(e.target.value)}>
          <option value="">Vælg trin i demoen…</option>
          {DEMO_DATES.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
        </select>
      </label>
      {message && <p className="small">{message}</p>}
      <ErrorBox error={error} />
    </div>
  );
}
