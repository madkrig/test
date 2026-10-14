'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { api, errorBody, setCurrentUser, type ApiErrorBody } from '../_lib/api';
import { fmtDate, fmtDateTime } from '../_lib/format';

export interface NavItem { href: string; label: string; mark: string }
interface Shell {
  actor: { id: string; name: string; role: string; roleLabel: string; department: string };
  today: string;
  unread: number;
  lastDailyRun: string | null;
  demo: boolean;
  users: { id: string; name: string; role: string; roleLabel: string; department: string }[];
  can: { runJobs: boolean };
}
interface Notification { id: string; message: string; link: string; createdAt: string; readAt: string | null; channels: string[] }

const CHANNEL: Record<string, string> = { TEAMS: 'Teams', EMAIL: 'E-mail', BRUGERFLADE: 'Brugerflade', DAGLIG: 'Daglig opsamling' };

/**
 * Ramme som i Cedra Stikprøveberegner: "cedra"-ordmærke, aside med eyebrow,
 * udsagn og nummereret navigation. Headeren har rollevælger (prototype for
 * Entra ID), notifikationer og demo-styring af systemdatoen.
 */
export function AppShell({ shell, nav, notifications, children }: { shell: Shell; nav: NavItem[]; notifications: Notification[]; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(shell.unread);
  const [demoOpen, setDemoOpen] = useState(false);
  const [target, setTarget] = useState(shell.today);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<ApiErrorBody | null>(null);

  async function toggleBell() {
    const next = !open;
    setOpen(next);
    setDemoOpen(false);
    if (next && unread > 0) {
      await api('/api/notifikationer/laest', { method: 'POST' }).catch(() => undefined);
      setUnread(0);
    }
  }

  function switchUser(id: string) {
    setCurrentUser(id);
    window.location.href = '/';
  }

  async function run(kind: 'dato' | 'job') {
    setBusy(kind === 'dato' ? 'Flytter datoen og kører de mellemliggende dage …' : 'Kører daglig kørsel …');
    setError(null);
    setMessage(null);
    try {
      if (kind === 'dato') {
        const r = await api<{ days: number; casesCreated: number; remindersSuggested: number; escalations: number; notifications: number }>('/api/demo/dato', { method: 'POST', body: { date: target } });
        setMessage(`${r.days} dage kørt: ${r.casesCreated} nye sager, ${r.remindersSuggested} rykkerforslag, ${r.escalations} eskaleringer, ${r.notifications} notifikationer.`);
      } else {
        const r = await api<{ casesCreated: number; remindersSuggested: number; escalations: number; notifications: number; sendTasks: number }>('/api/job/daglig', { method: 'POST' });
        setMessage(`Daglig kørsel: ${r.casesCreated} nye sager, ${r.sendTasks} afsendelser klar, ${r.remindersSuggested} rykkerforslag, ${r.escalations} eskaleringer.`);
      }
      router.refresh();
    } catch (e) {
      setError(errorBody(e));
    } finally {
      setBusy(null);
    }
  }

  const groups = [...new Set(shell.users.map((u) => u.roleLabel))];

  return (
    <div className="app">
      <header className="app-header">
        <Link className="brand" href="/">cedra<span>Engagementsforespørgsler</span></Link>
        <div className="header-tools">
          <span className="local">Prototype · syntetiske data</span>
          {shell.demo && (
            <div className="demo-wrap">
              <button className="secondary date-button" onClick={() => { setDemoOpen(!demoOpen); setOpen(false); }} aria-expanded={demoOpen} aria-label={`Systemdato ${fmtDate(shell.today)}`}>
                <span aria-hidden="true">◷</span> <span className="date-text">{fmtDate(shell.today)}</span>
              </button>
              {demoOpen && (
                <div className="dropdown demo-panel">
                  <p className="eyebrow">Systemdato (demo)</p>
                  <p>Reglerne kører hver dag: rykkere, eskaleringer og frister opstår, når datoen flyttes frem.</p>
                  <label className="field">
                    <span>Flyt frem til</span>
                    <input type="date" value={target} min={shell.today} onChange={(e) => setTarget(e.target.value)} />
                  </label>
                  <div className="actions compact">
                    {shell.can.runJobs && <button className="secondary small" disabled={!!busy} onClick={() => run('job')}>Kør daglig kørsel</button>}
                    <button className="small" disabled={!!busy || target <= shell.today} onClick={() => run('dato')}>Flyt datoen</button>
                  </div>
                  {busy && <div className="progress" role="status">{busy}</div>}
                  {message && <div className="notice ok-notice" role="status">{message}</div>}
                  {error && <div className="error" role="alert"><strong>{error.message}</strong>{error.recovery && <div>{error.recovery}</div>}</div>}
                  <small>Seneste daglige kørsel: {fmtDate(shell.lastDailyRun)}</small>
                </div>
              )}
            </div>
          )}
          <div className="bell">
            <button className="secondary" onClick={toggleBell} aria-label={`Notifikationer (${unread} ulæste)`} aria-expanded={open}>🔔</button>
            {unread > 0 && <span className="badge">{unread}</span>}
            {open && (
              <div className="dropdown">
                <p className="eyebrow">Notifikationer</p>
                {notifications.length === 0 && <div className="empty">Ingen notifikationer. Du får kun besked, når du skal handle.</div>}
                {notifications.map((n) => (
                  <a key={n.id} href={n.link} className={n.readAt ? '' : 'unread'} onClick={(e) => { e.preventDefault(); setOpen(false); router.push(n.link); }}>
                    {n.message}
                    <small>{fmtDateTime(n.createdAt)} · {n.channels.map((c) => CHANNEL[c] ?? c).join(' + ')}</small>
                  </a>
                ))}
                <Link className="all-link" href="/notifikationer" onClick={() => setOpen(false)}>Se alle notifikationer</Link>
              </div>
            )}
          </div>
          <select className="user" value={shell.actor.id} onChange={(e) => switchUser(e.target.value)} aria-label="Bruger og rolle">
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {shell.users.filter((u) => u.roleLabel === g).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
      </header>

      <div className="layout">
        <aside>
          <p className="eyebrow">{shell.actor.roleLabel} · {shell.actor.department}</p>
          <h1>Ét spor fra bankliste til konklusion.</h1>
          <p>Reglerne planlægger, funktionspostkassen sender og modtager, og svarene afstemmes mod bogføringen – med én ansvarlig for hver handling.</p>
          <nav className="side-nav" aria-label="Sider">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className={pathname === n.href || pathname.startsWith(`${n.href}/`) ? 'active' : ''}>
                <b aria-hidden="true">{n.mark}</b>{n.label}
              </Link>
            ))}
          </nav>
          <div className="aside-note">
            Erstatter banklister i Excel/Access, VBA-mails fra Outlook, svar i personlige indbakker og afstemning i regneark.
            Se <Link href="/proces">Proces og modernisering</Link>.
          </div>
        </aside>
        <main>
          {children}
          <footer className="app-footer">EF-service · Funktionspostkasse via Graph · Penneo · SharePoint · Hændelseslog · Syntetiske data</footer>
        </main>
      </div>
    </div>
  );
}
