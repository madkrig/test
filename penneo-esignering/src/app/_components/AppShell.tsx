'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, currentUserId, formatDateTime, setCurrentUser } from '../_lib/api';

interface Notification { id: string; message: string; link: string; createdAt: string; readAt: string | null }
interface NotificationList { data: Notification[]; unread: number }

/**
 * Ramme som i Cedra Stikprøveberegner: "cedra"-ordmærke i headeren, aside med
 * eyebrow, overskrift og nummereret navigation, og indholdet til højre.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [userId, setUserId] = useState('');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [n, tasks] = await Promise.all([
        api<NotificationList>('/api/notifications'),
        api<{ data: unknown[] }>('/api/signing-requests?scope=active'),
      ]);
      setNotifications(n.data);
      setUnread(n.unread);
      setActive(tasks.data.length);
    } catch {
      /* Tællere er ikke kritiske for siden. */
    }
  }, []);

  useEffect(() => {
    setUserId(currentUserId());
    api<{ data: { id: string; name: string }[] }>('/api/users').then((r) => setUsers(r.data)).catch(() => {});
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => { refresh(); }, [pathname, refresh]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      const res = await api<NotificationList>('/api/notifications/read', { method: 'POST' });
      setUnread(res.unread);
    } else if (!next) {
      refresh();
    }
  }

  function switchUser(id: string) {
    setCurrentUser(id);
    setUserId(id);
    window.location.reload();
  }

  const nav = [
    { href: '/markedsplads', label: 'Markedsplads', mark: '+' },
    { href: '/opgaver', label: 'Opgaver', mark: active === null ? '–' : String(active) },
  ];

  return (
    <div className="app">
      <header className="app-header">
        <Link className="brand" href="/markedsplads">cedra<span>E-signering</span></Link>
        <div className="header-tools">
          <span className="local">Prototype · syntetiske data</span>
          <div className="bell">
            <button className="secondary" onClick={toggle} aria-label={`Notifikationer (${unread} ulæste)`} aria-expanded={open}>🔔</button>
            {unread > 0 && <span className="badge">{unread}</span>}
            {open && (
              <div className="dropdown">
                <p className="eyebrow">Notifikationer</p>
                {notifications.length === 0 && <div className="empty">Ingen notifikationer endnu.</div>}
                {notifications.map((n) => (
                  <a
                    key={n.id}
                    href={n.link}
                    className={n.readAt ? '' : 'unread'}
                    onClick={(e) => { e.preventDefault(); setOpen(false); router.push(n.link); }}
                  >
                    {n.message}
                    <small>{formatDateTime(n.createdAt)}</small>
                  </a>
                ))}
              </div>
            )}
          </div>
          <select className="user" value={userId} onChange={(e) => switchUser(e.target.value)} aria-label="Bruger">
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </header>

      <div className="layout">
        <aside>
          <p className="eyebrow">E-signering via Penneo</p>
          <h1>Underskrevet og arkiveret.</h1>
          <p>Fra markedspladsen til underskrevne dokumenter i SharePoint – med status undervejs.</p>
          <nav className="side-nav" aria-label="Sider">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className={pathname.startsWith(n.href) ? 'active' : ''} aria-label={n.href === '/opgaver' ? `Opgaver (${n.mark} aktive)` : undefined}>
                <b aria-hidden="true">{n.mark}</b>{n.label}
              </Link>
            ))}
          </nav>
          <div className="aside-note">
            Underskrivere hentes fra kundens stamdata. Penneo melder status tilbage, og det underskrevne dokument arkiveres
            automatisk i SharePoint.
          </div>
        </aside>
        <main>
          {children}
          <footer className="app-footer">Penneo · SharePoint · PDF · Status via webhooks · Syntetiske data</footer>
        </main>
      </div>
    </div>
  );
}
