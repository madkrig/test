import type { ReactNode } from 'react';
import { can } from '@/domain/ef';
import { notificationsFor, shellInfo } from '@/services';
import { AppShell, type NavItem } from './_components/AppShell';
import { currentActor, prisma } from './_lib/server';
import './globals.css';
import './ef.css';

export const metadata = { title: 'Cedra · Engagementsforespørgsler' };
export const viewport = { themeColor: '#163b40' };
export const dynamic = 'force-dynamic';

/** Rammen tæller åbne handlinger pr. menupunkt, så "hvem har bolden" kan ses overalt (K3). */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const actor = await currentActor();
  const shell = await shellInfo(prisma, actor);
  const openTasks = (where: object) => prisma.task.count({ where: { status: { in: ['AABEN', 'I_GANG'] }, ...where } });
  const [queue, mine, auth, unmatched, pending, notifications] = await Promise.all([
    openTasks({ role: 'KM', type: { notIn: ['OPG-01'] } }),
    openTasks({ assigneeId: actor.id, type: { notIn: ['OPG-01'] } }),
    openTasks({ type: { startsWith: 'OPG-05' }, role: 'KM' }),
    prisma.response.count({ where: { matchStatus: 'UNMATCHED' } }),
    prisma.instituteChange.count({ where: { status: 'PENDING' } }),
    notificationsFor(prisma, actor),
  ]);
  const team = actor.role === 'KM' || actor.role === 'KL';
  const nav: NavItem[] = [
    ...(shell.can.queue ? [{ href: '/koe', label: 'Arbejdskø', mark: String(queue) }] : []),
    ...(shell.can.cases ? [{ href: '/sager', label: actor.role === 'OR' || actor.role === 'RM' ? 'Mine sager' : 'Sager', mark: actor.role === 'OR' || actor.role === 'RM' ? String(mine) : '§' }] : []),
    ...(team || actor.role === 'OR' ? [{ href: '/fuldmagter', label: 'Fuldmagter', mark: String(auth) }] : []),
    ...(team ? [{ href: '/svar/uidentificerede', label: 'Uidentificerede svar', mark: String(unmatched) }] : []),
    ...(shell.can.kpi ? [{ href: '/aarshjul', label: 'Årshjul og kapacitet', mark: '◷' }] : []),
    ...(team || actor.role === 'PE' ? [{ href: '/bankregister', label: 'Bankregister', mark: pending ? String(pending) : '≡' }] : []),
    { href: '/regler', label: 'Regler', mark: '§' },
    ...(can(actor.role, 'SEE_KPI') ? [{ href: '/rapporter', label: 'Rapporter og KPI', mark: '%' }] : []),
    { href: '/proces', label: 'Proces og modernisering', mark: '→' },
  ];
  return (
    <html lang="da">
      <body>
        <AppShell shell={shell} nav={nav} notifications={notifications.slice(0, 20)}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
