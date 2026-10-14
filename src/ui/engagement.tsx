import Link from 'next/link';
import type { bankConfirmations } from '@/services';
import { Card, Kpis, PageTitle, Pill, StatusBar } from './components';
import { da, dayMonth, engagementLabel, primaryFlag, statusBadge, taskRef } from './labels';

export type EngagementView = Awaited<ReturnType<typeof bankConfirmations.getForEngagement>>;
export type ActiveView = Extract<EngagementView, { population: unknown }>;
type Timeline = EngagementView['timeline'];

export function EngagementHeader({ v, deadline }: { v: EngagementView; deadline?: string }) {
  const e = v.engagement;
  return (
    <>
      <PageTitle
        title={`${e.customer.name} · ${engagementLabel(e)}`}
        sub={`CVR ${e.customer.cvr} (syntetisk) · Periode ${dayMonth(e.periodStart)}–${da(e.periodEnd)} · Statusdato ${da(e.statusDate)} · Faglig deadline ${da(e.professionalDeadline)}`}
      />
      {v.subtask && (
        <StatusBar label="Bankbekræftelser" badge={statusBadge(v.subtask.status)} next={v.subtask.nextAction} owner={v.subtask.nextOwner} {...(deadline ? { deadline } : {})} />
      )}
    </>
  );
}

const shortRule = (rule: string) => {
  const r = rule.replace(' måneder', ' mdr.').replace(/ arbejdsdage.*/, ' arb.dage');
  return r.startsWith('T-') ? r : `T-${r}`;
};

/** Begge tidsakser: statusdato (T-2 mdr. → T-4 uger) og faglig deadline (T-10 arbejdsdage). */
export function TimelineCard({ timeline, today }: { timeline: Timeline; today: string }) {
  const rows: [string, Timeline['activation']][] = [
    ['Aktivering', timeline.activation],
    ['Population godkendt', timeline.populationDeadline],
    ['Autorisation indhentet', timeline.authorizationDeadline],
    ['Anmodning sendes', timeline.sendDate],
    ['Faglig eskalation', timeline.professionalEscalation],
  ];
  const next = rows.find(([, m]) => m.date >= today)?.[1];
  return (
    <Card title="Tidsplan">
      <ul className="timeline">
        {rows.map(([label, m]) => (
          <li key={label} className={m === next ? 'next' : m.date < today ? 'past' : undefined}>
            <span className="strong">{shortRule(m.rule)}</span>
            <span>{da(m.date)}</span>
            <span className="muted small">{label}{m.adjusted ? ` · flyttet fra ${da(m.ruleDate)}` : ''}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">T-2 mdr. til T-4 uger regnes fra statusdato; T-10 fra faglig deadline. Weekend og helligdag → forudgående arbejdsdag.</p>
    </Card>
  );
}

export function VersionsCard({ v, name }: { v: ActiveView; name: (id: string) => string }) {
  return (
    <Card title="Populationsversioner">
      <ul className="list">
        {[...v.population.versions].reverse().map((x) => (
          <li key={x.id}>
            <span>
              <strong>v{x.version}</strong> · {x.kind === 'DELTA' ? 'delta' : 'fuld'} · {({ DRAFT: 'kladde', SUBMITTED: 'til godkendelse', APPROVED: 'godkendt', REJECTED: 'returneret' } as Record<string, string>)[x.status]}
            </span>
            <span className="muted small">
              {x.status === 'APPROVED' && x.approvedAt ? `${da(x.approvedAt)} af ${name(x.approvedBy ?? '')}` : ''}
              {x.status === 'REJECTED' && x.rejectionReason ? x.rejectionReason : ''}
              {x.status !== 'APPROVED' && x.status !== 'REJECTED' ? `${x.items.filter((i) => i.change !== 'REMOVED').length} bank(er)` : ''}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function TasksTable({ v, linkTasks, decisionLabel }: { v: ActiveView; linkTasks: boolean; decisionLabel: (taskId: string) => string | null }) {
  return (
    <table className="table">
      <thead>
        <tr><th>Bank</th><th>BankTask</th><th>Status</th><th>Flag</th><th>Metode</th><th>Kernes kontrol</th><th>Banksvar</th><th>Åbent punkt</th></tr>
      </thead>
      <tbody>
        {v.tasks.map((t) => (
          <tr key={t.id}>
            <td className="strong">{t.bankName}</td>
            <td>{linkTasks ? <Link href={`/kerne/bank-tasks/${t.id}`}>{taskRef(t.id)}</Link> : taskRef(t.id)}</td>
            <td><Pill badge={statusBadge(t.status)} /></td>
            <td><Pill badge={primaryFlag(t)} small /></td>
            <td className="muted">{t.method ? `${({ PLATFORM: 'Platform', UPLOAD_PORTAL: 'Uploadportal', EMAIL: 'E-mail', OTHER: 'Særskilt portal' } as Record<string, string>)[t.method.channel]} v${t.method.version}` : '–'}</td>
            <td>
              {t.response?.administrativeCheckStatus === 'PASSED' ? <span className="ok">√ Bestået</span>
                : t.response?.administrativeCheckStatus === 'FAILED' ? <span className="no">■ Fejlet</span>
                : t.response ? <span className="muted">Afventer</span> : '–'}
            </td>
            <td>{t.response?.sharePointDocumentId ? <a href={t.response.sharePointUrl ?? '#'} title={`sha256 ${t.response.integrityHash ?? ''}`}>{t.response.sharePointDocumentId} ↗</a> : '–'}</td>
            <td className="small">{decisionLabel(t.id) ?? (t.response?.deviations.length ? t.response.deviations.join('; ') : '–')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TaskKpis({ v }: { v: ActiveView }) {
  return <Kpis items={[['Banker', v.summary.banks], ['Sendt', v.summary.sent], ['Modtaget', v.summary.received], ['Undtagelser', v.summary.exceptions]]} />;
}

/** Tekst til "Åbent punkt"-kolonnen: åben beslutning eller seneste trufne beslutning. */
export function decisionLabeller(v: ActiveView) {
  return (taskId: string) => {
    const ds = v.decisions.filter((d) => d.bankTaskId === taskId);
    const open = ds.find((d) => d.status === 'OPEN');
    if (open) return `▲ ${open.type === 'MISSING_RESPONSE' ? 'Manglende svar – afventer revisors beslutning' : ((open.evidence as { deviations?: string[] }).deviations ?? [open.question]).join('; ')}`;
    const last = ds.at(-1);
    if (!last) return null;
    const label = (last.options as { id: string; label: string }[]).find((o) => o.id === last.chosenOption)?.label ?? last.chosenOption;
    return `Besluttet ${dayMonth(last.decidedAt)}: ${label}`;
  };
}
