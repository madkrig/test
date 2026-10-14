import Link from 'next/link';
import { bankConfirmations, bankTasks, prisma } from '@/services';
import { ActionButton } from '@/ui/client/action';
import { QueueTable } from '@/ui/client/queue';
import { Card, PageTitle } from '@/ui/components';
import { da, stamp } from '@/ui/labels';
import { session } from '@/ui/session';
import { Shell } from '@/ui/Shell';

export const dynamic = 'force-dynamic';

const VIEWS = [
  ['action', 'Kræver handling'],
  ['mine', 'Mine'],
  ['four-eyes', 'Fire-øjne'],
  ['all', 'Alle åbne'],
  ['completed', 'Afsluttede'],
] as const;

export default async function Queue({ searchParams }: { searchParams: Promise<{ view?: string; subtask?: string }> }) {
  const s = await session(['KERNE', 'SERVICE_OWNER']);
  const { view = 'action', subtask } = await searchParams;
  const all = await bankTasks.listBankTasks(s.actor, { pageSize: 200, includeCompleted: view === 'completed' });
  const counts = {
    action: all.items.filter((t) => t.rank <= 4).length,
    mine: all.items.filter((t) => t.kerneOwnerId === s.actor.id).length,
    'four-eyes': all.items.filter((t) => t.flags.fourEyesRequired && !t.sentAt).length,
  };
  let items = all.items;
  if (view === 'action') items = items.filter((t) => t.rank <= 4);
  if (view === 'mine') items = items.filter((t) => t.kerneOwnerId === s.actor.id);
  if (view === 'four-eyes') items = items.filter((t) => t.flags.fourEyesRequired && !t.sentAt);
  if (view === 'completed') items = items.filter((t) => t.status === 'COMPLETED');
  if (subtask) items = items.filter((t) => t.subtaskId === subtask);
  const [population, notifications] = await Promise.all([
    bankConfirmations.populationWork(s.actor),
    prisma.notification.findMany({ where: { recipient: { in: [s.actor.id, `ROLE:${s.actor.role}`, 'ROLE:KERNE'] } }, orderBy: { createdAt: 'desc' }, take: 6 }),
  ]);
  const owners = s.users.filter((u) => u.role === 'KERNE' || u.role === 'SERVICE_OWNER');
  return (
    <Shell s={s} active="queue">
      <PageTitle title="Arbejdskø · bankbekræftelser" sub="Sorteret: blokeret › frist overskredet › autorisation mangler › klar til udsendelse › svar til kontrol › afventer" />
      <div className="row between">
        <nav className="tabs">
          {VIEWS.map(([key, label]) => (
            <Link key={key} href={`/kerne?view=${key}`} className={view === key ? 'active' : undefined}>
              {label}{key in counts ? ` (${counts[key as keyof typeof counts]})` : ''}
            </Link>
          ))}
        </nav>
        {s.actor.role === 'KERNE' && <ActionButton label="Kør T-10-kontrol" variant="secondary" url="/api/jobs/escalation-check" />}
      </div>
      {subtask && <p className="small">Filtreret på én subopgave · <Link href="/kerne">vis alle</Link></p>}
      <Card>
        <QueueTable
          rows={items.map((t) => ({ ...t, owner: s.name(t.kerneOwnerId) === '–' ? 'Ikke tildelt' : s.name(t.kerneOwnerId), method: t.method?.replace('UPLOAD_PORTAL', 'Uploadportal').replace('EMAIL', 'E-mail').replace('PLATFORM', 'Platform').replace('OTHER', 'Særskilt portal') ?? null }))}
          owners={owners}
        />
        <p className="muted small">Bulk-tildeling mulig. Udsendelse sker pr. opgave efter bankens metode; fire-øjne kræver en anden medarbejder.</p>
      </Card>
      <div className="grid-2">
        <Card title={`Populationer at klargøre (${population.length})`}>
          {population.length === 0 && <p className="muted small">Ingen populationsforslag venter.</p>}
          <table className="table">
            <tbody>
              {population.map((p) => (
                <tr key={p.subtaskId}>
                  <td><Link className="strong" href={`/kerne/population/${p.subtaskId}`}>{p.customer}</Link></td>
                  <td>v{p.version} · {p.banks} bank(er)</td>
                  <td>{p.nextAction}</td>
                  <td className="muted">Deadline {da(p.deadline)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Notifikationer">
          <ul className="list">
            {notifications.map((n) => (
              <li key={n.id}><Link href={n.link}>{n.message}</Link><span className="muted small">{stamp(n.createdAt)}</span></li>
            ))}
          </ul>
        </Card>
      </div>
    </Shell>
  );
}
