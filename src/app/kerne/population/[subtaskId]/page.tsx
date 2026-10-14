import { bankConfirmations, prisma } from '@/services';
import { ActionButton } from '@/ui/client/action';
import { PopulationTable } from '@/ui/client/population';
import { Callout, Card, Denied, EventLog } from '@/ui/components';
import { EngagementHeader, TimelineCard, VersionsCard } from '@/ui/engagement';
import { da } from '@/ui/labels';
import { load, session } from '@/ui/session';
import { Shell } from '@/ui/Shell';

export const dynamic = 'force-dynamic';

/** Kerne klargør populationsforslaget (kilder: sidste år, R75, ERP, kunde) og indsender til revisor. */
export default async function KernePopulation({ params }: { params: Promise<{ subtaskId: string }> }) {
  const { subtaskId } = await params;
  const s = await session(['KERNE', 'SERVICE_OWNER']);
  const subtask = await prisma.subtask.findUnique({ where: { id: subtaskId } });
  if (!subtask) return <Shell s={s} active="queue"><Denied error={{ code: 'NOT_FOUND', message: 'Subopgaven findes ikke.' }} /></Shell>;
  const res = await load(() => bankConfirmations.getForEngagement(s.actor, subtask.engagementId));
  if (!res.ok) return <Shell s={s} active="queue"><Denied error={res.error} /></Shell>;
  const v = res.data;
  if (v.subtask === null) return null;
  const banks = await prisma.bank.findMany({ orderBy: { name: 'asc' } });
  const latest = v.population.current!;
  const editable = latest.status === 'DRAFT' || latest.status === 'REJECTED';
  const active = latest.items.filter((i) => i.change !== 'REMOVED');
  return (
    <Shell s={s} active="queue">
      <EngagementHeader v={v} deadline={`${da(v.timeline.populationDeadline.date)} (revisor godkender senest T-6 uger)`} />
      <div className="grid-main">
        <div className="stack">
          <Card title={`Populationsforslag · version ${latest.version} (${editable ? 'kladde' : latest.status === 'SUBMITTED' ? 'hos revisor' : 'godkendt'})`}>
            {latest.status === 'REJECTED' && latest.rejectionReason && <Callout tone="amber">Returneret af revisor: {latest.rejectionReason}. Ret populationen og indsend igen.</Callout>}
            {!v.engagement.customer.hasHistory && <Callout>Ny kunde uden tidligere population: indhent kundens samlede bankliste og supplér med R75 og ERP.</Callout>}
            <p className="muted small">Historik er kun reference. Kilder: sidste år, R75 (skatteoplysninger), ERP-system, kunde.</p>
            <PopulationTable subtaskId={v.subtask.id} items={latest.items} editable={editable} banks={banks} />
            {editable && (
              <div className="row">
                <ActionButton label={`Indsend til revisor (${active.length} ${active.length === 1 ? 'bank' : 'banker'})`} url={`/api/bank-confirmations/${v.subtask.id}/population/submit`} />
              </div>
            )}
            {latest.status === 'SUBMITTED' && <Callout>Afventer revisors godkendelse. Ændringer herfra opretter en ny kladdeversion.</Callout>}
          </Card>
        </div>
        <aside className="stack">
          <TimelineCard timeline={v.timeline} today={s.today} />
          <VersionsCard v={v} name={s.name} />
          <Card title="Historik"><EventLog events={v.events} name={s.name} /></Card>
        </aside>
      </div>
    </Shell>
  );
}
