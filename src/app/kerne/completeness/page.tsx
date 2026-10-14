import Link from 'next/link';
import { completeness } from '@/services';
import { ActionButton } from '@/ui/client/action';
import { Callout, Card, Denied, Kpis, PageTitle, Pill } from '@/ui/components';
import { da } from '@/ui/labels';
import { load, session } from '@/ui/session';
import { Shell } from '@/ui/Shell';

export const dynamic = 'force-dynamic';

const MONTHS = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
const DECISION = {
  OPEN: { icon: '…', label: 'Afklaring åben', tone: 'amber' },
  OPT_IN: { icon: '√', label: 'Tilvalgt', tone: 'green' },
  OPT_OUT: { icon: '−', label: 'Fravalgt', tone: 'grey' },
} as const;

const REASON: Record<string, string> = { NEW_CUSTOMER_NO_HISTORY: 'Ny kunde uden historik', NO_SUBTASK: 'Ingen subopgave oprettet' };

const days = (from: string, to: string) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));

/** F12: separat månedlig fuldstændighedskontrol – opretter afklaringer, aldrig bankforespørgsler. */
export default async function Completeness() {
  const s = await session(['SERVICE_OWNER']);
  const res = await load(() => completeness.listRuns(s.actor));
  if (!res.ok) return <Shell s={s} active="completeness"><Denied error={res.error} /></Shell>;
  const [run, ...older] = res.data;
  // Afklaringer fra tidligere kørsler vises sammen med den seneste, så intet åbent punkt forsvinder.
  const items = res.data.flatMap((r) => r.items.map((i) => ({ ...i, runDate: r.runDate })));
  return (
    <Shell s={s} active="completeness">
      <div className="row between">
        <PageTitle
          title={run ? `Fuldstændighedskontrol · ${MONTHS[Number(run.runDate.slice(5, 7)) - 1]} ${run.runDate.slice(0, 4)}` : 'Fuldstændighedskontrol'}
          sub={run ? `Kørt ${da(run.runDate)} · adskilt fra populationsgodkendelsen på den enkelte revision` : 'Ingen kørsler endnu'}
        />
        <ActionButton label={`Kør kontrol pr. ${da(s.today)}`} url="/api/completeness-runs/run" body={{ runDate: s.today }} />
      </div>
      {run && <Kpis items={[['Aktive revisionsopgaver', run.populationSize], ['I T-2-vinduet', run.inWindow], ['Med subopgave', run.withSubtask], ['Mangler', run.inWindow - run.withSubtask]]} />}
      <Card>
        <table className="table">
          <thead>
            <tr><th>Kunde · revision</th><th>Årsag</th><th>Ansvarlig revisor</th><th>Afklaring</th><th>Begrundelse</th><th>Alder</th><th>Deadline</th></tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={7} className="muted">Ingen afklaringer.</td></tr>}
            {items.map((i) => (
              <tr key={i.id}>
                <td><Link href={`/auditflow/${i.engagementId}`} className="strong">{i.customerName}</Link> · Statusdato {da(i.statusDate)}</td>
                <td>{REASON[i.reason] ?? i.reason}</td>
                <td>{s.name(i.responsibleAuditorId)}</td>
                <td><Pill badge={DECISION[i.decision as keyof typeof DECISION] ?? null} small /></td>
                <td>{i.optOutReason ?? '–'}</td>
                <td>{days(i.runDate, i.decidedAt?.slice(0, 10) ?? s.today)} dage</td>
                <td>{da(i.deadline)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Callout>Kontrollen opretter afklaringsopgaver til den ansvarlige revisor – aldrig automatiske bankforespørgsler. Valg og begrundelse logges.</Callout>
      {older.length > 0 && <p className="muted small">Tidligere kørsler: {older.map((r) => da(r.runDate)).join(', ')}</p>}
    </Shell>
  );
}
