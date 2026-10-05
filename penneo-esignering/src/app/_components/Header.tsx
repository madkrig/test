'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, currentUserId, formatDateTime, setCurrentUser } from '../_lib/api';
import { CedraMark } from './Logo';

interface Notification { id: string; message: string; link: string; createdAt: string; readAt: string | null }

const NAV = [
  { href: '/markedsplads', label: 'Markedsplads' },
  { href: '/opgaver', label: 'Opgaver' },
];

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [userId, setUserId] = useState('');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await api<{ data: Notification[]; unread: number }>('/api/notifications');
      setNotifications(res.data);
      setUnread(res.unread);
    } catch {
      /* Notifikationer er ikke kritiske for siden. */
    }
  }, []);

  useEffect(() => {
    setUserId(currentUserId());
    api<{ data: { id: string; name: string }[] }>('/api/users').then((r) => setUsers(r.data)).catch(() => {});
    loadNotifications();
    const timer = setInterval(loadNotifications, 4000);
    return () => clearInterval(timer);
  }, [loadNotifications]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      const res = await api<{ data: Notification[]; unread: number }>('/api/notifications/read', { method: 'POST' });
      setUnread(res.unread);
    } else if (!next) {
      loadNotifications();
    }
  }

  function switchUser(id: string) {
    setCurrentUser(id);
    setUserId(id);
    window.location.reload();
  }

  return (
    <header className="header">
      <div className="header-inner">
        <Link href="/markedsplads" className="logo">
          <CedraMark />
          <strong>Cedra</strong>
          <span className="hide-sm">Revisorportal</span>
        </Link>
        <nav className="nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={pathname.startsWith(n.href) ? 'active' : ''}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="header-tools">
          <div className="bell">
            <button onClick={toggle} aria-label={`Notifikationer (${unread} ulæste)`}>🔔</button>
            {unread > 0 && <span className="badge">{unread}</span>}
            {open && (
              <div className="dropdown">
                <div className="head">Notifikationer</div>
                {notifications.length === 0 && <div className="empty small">Ingen notifikationer endnu.</div>}
                {notifications.map((n) => (
                  <a
                    key={n.id}
                    href={n.link}
                    className={n.readAt ? '' : 'unread'}
                    onClick={(e) => { e.preventDefault(); setOpen(false); router.push(n.link); }}
                  >
                    <div>{n.message}</div>
                    <div className="muted small">{formatDateTime(n.createdAt)}</div>
                  </a>
                ))}
              </div>
            )}
          </div>
          <select className="user-select" value={userId} onChange={(e) => switchUser(e.target.value)} aria-label="Bruger">
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} (revisor)</option>)}
          </select>
        </div>
      </div>
    </header>
  );
}
