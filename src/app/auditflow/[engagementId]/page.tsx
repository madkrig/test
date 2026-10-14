import { bankConfirmations, prisma } from '@/services';
import { ActionButton } from '@/ui/client/action';
import { ClarificationForm, ConclusionForm, DecisionForm } from '@/ui/client/auditor-forms';
import { AddBank, ApprovePopulation, PopulationTable } from '@/ui/client/population';
import { Callout, Card, Denied, EventLog, Pill } from '@/ui/components';
import { decisionLabeller, EngagementHeader, TaskKpis, TasksTable, TimelineCard, VersionsCard, type ActiveView } from '@/ui/engagement';
import { CHANGE, da, SOURCE } from '@/ui/labels';
import { load, session, type Session } from '@/ui/session';
import { Shell } from '@/ui/Shell';

export const dynamic = 'force-dynamic';

export default async function EngagementPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const s = await session();
  const res = await load(() => bankConfirmations.getForEngagement(s.actor, engagementId));
  if (!res.ok) return <Shell s={s} active="mine"><Denied error={res.error} /></Shell>;
  const v = res.data;
  const isAuditor = s.actor.role === 'AUDITOR';

  if (v.subtask === null) {
    const c = v.clarification;
    return (
      <Shell s={s} active="mine">
        <EngagementHeader v={v} />
        <div className="grid-main">
          {c?.decision === 'OPEN' ? (
            <Card title="Månedlig kontrol: bankbekræftelser er ikke oprettet">
              <p className="muted">Fundet ved den månedlige kørsel · {c.reason === 'NEW_CUSTOMER_NO_HISTORY' ? 'ny kunde uden tidligere population' : 'ingen subopgave oprettet'}. Du skal tage aktivt stilling senest {da(c.deadline)}.</p>
              <Callout>Ved tilvalg opretter Kerne et tomt populationsudkast og indhenter kundens samlede bankliste. Der oprettes ingen BankTasks, før du har godkendt populationen.</Callout>
              {isAuditor ? <ClarificationForm itemId={c.id} /> : <p className="muted">Afventer revisors afklaring.</p>}
            </Card>
          ) : (
            <Card title="Bankbekræftelser er ikke aktiveret">
              {c?.decision === 'OPT_OUT' && <Callout>Fravalgt af {s.name(c.decidedBy)} {da(c.decidedAt)}: {c.optOutReason}</Callout>}
              <p className="muted">Aktivering opretter én subopgave og et tomt populationsudkast hos Kerne. Normalt sker det automatisk ved T-2 måneder.</p>
              {isAuditor && <ActionButton label="Aktivér bankbekræftelser" url={`/api/engagements/${engagementId}/bank-confirmations/activate`} body={{ source: 'AD_HOC' }} />}
            </Card>
          )}
          <aside className="stack"><TimelineCard timeline={v.timeline} today={s.today} /></aside>
        </div>
      </Shell>
    );
  }

  const banks = await prisma.bank.findMany({ orderBy: { name: 'asc' } });
  const review = v.summary.sent > 0 ? await bankConfirmations.getReviewPackage(s.actor, v.subtask.id) : null;
  const versions = v.population.versions;
  const pending = [...versions].reverse().find((x) => x.status === 'SUBMITTED');
  const latest = v.population.current;
  const approved = versions.filter((x) => x.status === 'APPROVED');
  const openDecisions = v.decisions.filter((d) => d.status === 'OPEN');
  const deadline = pending?.kind === 'FULL' ? da(v.timeline.populationDeadline.date)
    : openDecisions[0]?.deadline ? da(openDecisions[0].deadline)
    : v.subtask.status === 'AWAITING_KERNE' && v.summary.sent === 0 ? `${da(v.timeline.authorizationDeadline.date)} (T-5 uger)`
    : v.subtask.status === 'AWAITING_AUDITOR' ? da(v.engagement.professionalDeadline) : undefined;

  return (
    <Shell s={s} active="mine">
      <EngagementHeader v={v} {...(deadline ? { deadline } : {})} />
      <div className="grid-main">
        <div className="stack">
          {pending && pending.kind === 'FULL' && (
            <Card title={`Bankpopulation · version ${pending.version} (til godkendelse)`}>
              <p className="muted small">Forslag klargjort af Kerne. Historik er kun reference – du godkender årets population.</p>
              {v.subtask.openQuestions > 0 && <Callout tone="amber">{v.subtask.openQuestions} åbent spørgsmål på opgaven – populationen kan ikke massegodkendes.</Callout>}
              <PopulationTable subtaskId={v.subtask.id} items={pending.items} editable={isAuditor} banks={banks} />
              <p className="muted small">Fjernelse kræver begrundelse. Dine ændringer gemmes i en ny version.</p>
              {isAuditor && <Approve v={v} s={s} pending={pending} />}
            </Card>
          )}

          {pending && pending.kind === 'DELTA' && (
            <Card title={`Population version ${pending.version} – kun ændringen`}>
              <p className="muted small">Ny bank identificeret efter godkendelsen af version {approved.at(-1)?.version ?? 1}.</p>
              <ul className="list">
                {pending.items.map((i) => (
                  <li key={i.id}>
                    <span><strong>{i.bankName}</strong> <Pill badge={CHANGE[i.change] ?? null} small /></span>
                    <span className="muted small">{i.relationType} · kilde: {i.sources.map((x) => SOURCE[x] ?? x).join(', ')}</span>
                  </li>
                ))}
              </ul>
              {isAuditor && <Approve v={v} s={s} pending={pending} />}
            </Card>
          )}

          {!pending && latest && (latest.status === 'DRAFT' || latest.status === 'REJECTED') && (
            <Card title={`Bankpopulation · version ${latest.version} (hos Kerne)`}>
              {latest.status === 'REJECTED' && latest.rejectionReason && <Callout tone="amber">Returneret: {latest.rejectionReason}</Callout>}
              <Callout>Kerne klargør populationsforslaget. Du får besked, når det er klar til godkendelse.</Callout>
              <PopulationTable subtaskId={v.subtask.id} items={latest.items} editable={false} banks={banks} />
            </Card>
          )}

          {openDecisions.map((d) => {
            const task = v.tasks.find((t) => t.id === d.bankTaskId);
            const ev = d.evidence as { sentAt?: string; reminders?: number; escalationDate?: string; sharePointUrl?: string };
            return (
              <Card key={d.id} className="card-alert" title={d.type === 'MISSING_RESPONSE' ? `${task?.bankName ?? 'Banken'} har ikke svaret` : `Beslutning · ${task?.bankName ?? ''}`}
                aside={<Pill badge={{ icon: '▲', label: d.type === 'MISSING_RESPONSE' ? 'Faglig handling krævet' : 'Faglig undtagelse', tone: 'orange' }} />}>
                {d.type === 'MISSING_RESPONSE'
                  ? <p className="muted small">Sendt {da(ev.sentAt)} · {ev.reminders ?? 0} påmindelse(r) · T-10 arbejdsdage nået {da(ev.escalationDate)}</p>
                  : <p>{d.question}{ev.sharePointUrl ? <> · <a href={ev.sharePointUrl}>banksvar ↗</a></> : null}</p>}
                {isAuditor ? <DecisionForm decisionId={d.id} options={d.options as { id: string; label: string }[]} /> : <p className="muted">Afventer revisors beslutning.</p>}
                <p className="muted small">Ejer: {s.name(d.ownerId)} · Deadline: {da(d.deadline)}{d.deadline && d.deadline < s.today ? ' (overskredet)' : ''}. Valg, begrundelse, ejer og deadline logges. Ingen automatisk partnereskalation.</p>
              </Card>
            );
          })}

          {v.tasks.length > 0 && (
            <Card title="Bankopgaver" aside={approved[0] ? <span className="muted small">Population v{approved[0].version} godkendt {da(approved[0].approvedAt)} af {s.name(approved[0].approvedBy ?? '')}</span> : null}>
              <TaskKpis v={v} />
              <TasksTable v={v} linkTasks={!isAuditor} decisionLabel={decisionLabeller(v)} />
              {isAuditor && !pending && latest?.status !== 'DRAFT' && v.subtask.status !== 'COMPLETED' && (
                <AddBank url={`/api/bank-confirmations/${v.subtask.id}/population/delta`} banks={banks} label="+ Ny bank fundet efter godkendelse (delta)" defaultSources={['AUDITOR']}
                  exclude={approved.flatMap((x) => x.items.filter((i) => i.change !== 'REMOVED').map((i) => i.bankId))} />
              )}
            </Card>
          )}

          {review && <Conclusion v={v} review={review} isAuditor={isAuditor} s={s} />}
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

function Approve({ v, s, pending }: { v: ActiveView; s: Session; pending: ActiveView['population']['versions'][number] }) {
  const active = pending.items.filter((i) => i.change !== 'REMOVED');
  const delta = pending.kind === 'DELTA';
  return (
    <ApprovePopulation
      subtaskId={v.subtask.id}
      versionId={pending.id}
      version={pending.version}
      kind={pending.kind}
      customer={`${v.engagement.customer.name}`}
      banks={active.map((i) => i.bankName)}
      removed={pending.items.length - active.length}
      authorizationDeadline={delta ? 'før særskilt udsendelse' : da(v.timeline.authorizationDeadline.date)}
      sendDate={delta ? 'særskilt (mindst 5 arbejdsdage frem)' : da(v.timeline.sendDate.date)}
      actorName={s.actor.name}
      existingTasks={v.tasks.length}
    />
  );
}

function Conclusion({ v, review, isAuditor, s }: { v: ActiveView; review: Awaited<ReturnType<typeof bankConfirmations.getReviewPackage>>; isAuditor: boolean; s: Session }) {
  const notReady = review.banks.filter((b) => !b.reviewReady).length;
  const blockers = [
    ...(review.openPoints.length ? [`${review.openPoints.length} faglig(e) beslutning(er) ubehandlet`] : []),
    ...(notReady ? [`${notReady} bank(er) mangler endelig status`] : []),
  ];
  return (
    <Card title="Reviewpakke og faglig konklusion" aside={<span className="muted small">Dækning: {review.coverage.banks} banker · {review.coverage.received} modtaget · {review.coverage.awaitingBank} afventer bank · {review.coverage.exceptions} undtagelse(r)</span>}>
      {v.subtask.openReviewNotes > 0 && (
        <Callout tone="amber">
          {v.subtask.openReviewNotes} åben review note til teamet.{' '}
          {isAuditor && <ActionButton label="Luk review note" variant="link" url={`/api/bank-confirmations/${v.subtask.id}/review-notes/resolve`} />}
        </Callout>
      )}
      {review.conclusion ? (
        <>
          <p>{review.conclusion}</p>
          <p className="muted small">Registreret af {s.name(v.subtask.conclusionBy)} {da(v.subtask.conclusionAt)}.</p>
          {v.subtask.status === 'COMPLETED'
            ? <Callout tone="green">√ Subopgaven er fuldført.</Callout>
            : review.completionBlockers.length > 0 && <Callout>Kerne afslutter de operationelle opgaver: {review.completionBlockers.join(' ')}</Callout>}
        </>
      ) : isAuditor ? (
        <>
          {blockers.length > 0 && <Callout tone="red">■ Blokeret: {blockers.join(' · ')}</Callout>}
          <ConclusionForm subtaskId={v.subtask.id} blockers={blockers} />
        </>
      ) : (
        <p className="muted">Afventer revisors faglige konklusion.</p>
      )}
    </Card>
  );
}
