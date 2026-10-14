import Link from 'next/link';
import { bankConfirmations, prisma } from '@/services';
import { Card, PageTitle, Pill } from '@/ui/components';
import { da, stamp, statusBadge } from '@/ui/labels';
import { session } from '@/ui/session';
import { Shell } from '@/ui/Shell';

export const dynamic = 'force-dynamic';

export default async function MyEngagements() {
  const s = await session(['AUDITOR']);
  const rows = await bankConfirmations.myEngagements(s.actor);
  const notifications = await prisma.notification.findMany({ where: { recipient: s.actor.id }, orderBy: { createdAt: 'desc' }, take: 6 });
  const actionNeeded = rows.filter((r) => r.clarification || r.subtask?.status === 'AWAITING_AUDITOR');
  return (
    <Shell s={s} active="mine">
      <PageTitle title="Mine revisioner" sub={`Bankbekræftelser på dine revisionsopgaver · ${actionNeeded.length} kræver din handling`} />
      <div className="grid-main">
        <Card>
          <table className="table">
            <thead>
              <tr><th>Kunde</th><th>Revision · statusdato</th><th>Bankbekræftelser</th><th>Næste handling</th><th>Ejer</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.engagementId} className={r.clarification || r.subtask?.status === 'AWAITING_AUDITOR' ? 'row-hl' : undefined}>
                  <td><Link href={`/auditflow/${r.engagementId}`} className="strong">{r.customer}</Link></td>
                  <td>{r.engagement} · {da(r.statusDate)}</td>
                  <td>
                    {r.subtask ? <Pill badge={statusBadge(r.subtask.status)} /> : r.clarification ? <Pill badge={{ icon: '…', label: 'Afklaring åben', tone: 'amber' }} /> : <span className="muted">Ikke aktiveret</span>}
                  </td>
                  <td>{r.subtask?.nextAction ?? (r.clarification ? 'Tilvælg eller fravælg bankbekræftelser' : '–')}</td>
                  <td className="muted">{r.subtask?.nextOwner ?? (r.clarification ? s.name(r.responsibleAuditorId) : '–')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Notifikationer">
          {notifications.length === 0 && <p className="muted small">Ingen notifikationer.</p>}
          <ul className="list">
            {notifications.map((n) => (
              <li key={n.id}>
                <Link href={n.link}>{n.message}</Link>
                <span className="muted small">{stamp(n.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Shell>
  );
}
