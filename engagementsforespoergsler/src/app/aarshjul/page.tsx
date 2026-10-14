import { relativeTimeline } from '@/domain/ef';
import { capacityForecast, paramsAt } from '@/services';
import { ColumnChart } from '../_components/Charts';
import { fmtDate } from '../_lib/format';
import { currentActor, prisma } from '../_lib/server';

export const dynamic = 'force-dynamic';

const COLUMNS = [
  { key: 'created', label: 'Nye sager (T−60)' },
  { key: 'approvals', label: 'Banklister til godkendelse (T−30)' },
  { key: 'authDeadlines', label: 'Fuldmagtsfrister (T−10)' },
  { key: 'sends', label: 'Afsendelser (TR-10)' },
  { key: 'responses', label: 'Forventede svar' },
  { key: 'conclusions', label: 'Konklusioner (P−5)' },
] as const;

/** S08 Årshjul og kapacitet – forventede handlinger pr. uge og institut, så peak kan bemandes. */
export default async function SeasonPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const actor = await currentActor();
  const weeks = Math.min(40, Math.max(8, Number(sp.uger ?? 22)));
  const d = await capacityForecast(prisma, actor, { from: sp.fra, weeks });
  const params = await paramsAt(prisma, d.from);
  const timeline = relativeTimeline('2026-12-31', '2027-03-31', params);
  const peakWeek = d.weeks.find((w) => w.week === d.peak?.week);
  const totals = Object.fromEntries(COLUMNS.map((c) => [c.key, d.weeks.reduce((a, w) => a + w[c.key], 0)])) as Record<(typeof COLUMNS)[number]['key'], number>;
  const maxCell = Math.max(1, ...d.weeks.flatMap((w) => COLUMNS.map((c) => w[c.key])));
  const shade = (v: number) => (v === 0 ? undefined : { background: `color-mix(in srgb, var(--primary) ${Math.round(8 + (v / maxCell) * 52)}%, #fff)`, color: v / maxCell > 0.55 ? '#fff' : 'var(--ink)' });
  return (
    <>
      <div className="topline"><span>Årshjul og kapacitet</span><span>{d.weeks[0]?.week} – {d.weeks.at(-1)?.week}</span></div>
      <section className="card">
        <div className="section-head">
          <div>
            <h2>Årshjul og kapacitet</h2>
            <p>Forventede handlinger pr. uge – også for opgaver, der endnu ikke har en sag. Prognosen bygger på Maconomy, sidste års banklister, SAF-T og bankregisterets frister, så peak kan bemandes i god tid i stedet for at blive opdaget i indbakken.</p>
          </div>
          <form className="filter-row" method="get" action="/aarshjul" style={{ margin: 0 }}>
            <label>Fra<input type="date" name="fra" defaultValue={sp.fra ?? d.from} /></label>
            <label>Uger<select name="uger" defaultValue={String(weeks)}>{[12, 22, 30, 40].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <button className="secondary">Vis</button>
          </form>
        </div>
        <div className="stats four">
          <div className="stat"><span>Fuldmagtsdækning</span><strong>{d.coverage.covered} af {d.coverage.customers}</strong></div>
          <div className="stat"><span>Afsendelser i perioden</span><strong>{totals.sends}</strong></div>
          <div className="stat"><span>Forventede svar</span><strong>{totals.responses}</strong></div>
          <div className={`stat${d.peak ? ' alert' : ''}`}><span>Peak-uge</span><strong>{d.peak ? `${d.peak.week}` : '–'}</strong></div>
        </div>
        <ColumnChart
          title="Forventede afsendelser pr. uge – peak-ugen fremhævet"
          unit="afsendelser"
          labelEvery={weeks > 22 ? 2 : 1}
          data={d.weeks.map((w) => ({ key: w.start, label: w.week.split(' ')[0]!, value: w.sends, emphasis: w.week === d.peak?.week, detail: Object.entries(w.byInstitute).sort((a, b) => b[1] - a[1]).map(([n, v]) => `${n} ${v}`).join(' · ') || undefined }))}
        />
        {d.peak && peakWeek && (
          <div className="notice"><strong>Flaskehals i {d.peak.week} (uge fra {fmtDate(peakWeek.start)}):</strong> {d.peak.sends} afsendelser – {d.peak.institutes.map(([n, v]) => `${n} ${v}`).join(', ')}. Planlæg bemanding i kerneteamet, og send forudbestillinger tidligt, hvor instituttet tillader det.</div>
        )}
        <h3>Handlinger pr. uge</h3>
        <div className="table-wrap">
          <table className="stack dense heat">
            <thead><tr><th>Uge</th>{COLUMNS.map((c) => <th key={c.key} className="num">{c.label}</th>)}</tr></thead>
            <tbody>
              {d.weeks.map((w) => (
                <tr key={w.start}>
                  <td data-label="Uge"><strong>{w.week}</strong><span className="ref">fra {fmtDate(w.start)}</span></td>
                  {COLUMNS.map((c) => <td key={c.key} data-label={c.label} className={`cell${w[c.key] === 0 ? ' zero' : ''}`} style={shade(w[c.key])}>{w[c.key]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <h2>Relativ tidslinje</h2>
        <p>Gælder alle balancedage. Eksemplet viser sæson 2026/27 med balancedag 31.12.2026 og planlagt påtegning 31.03.2027. Frister relativt til T flyttes til næste hverdag; frister relativt til P til forrige hverdag.</p>
        <div className="table-wrap">
          <table className="stack dense">
            <thead><tr><th>Hvornår</th><th>Dato</th><th>Aktivitet</th><th>Ansvarlig</th><th>Regler</th></tr></thead>
            <tbody>
              {timeline.map((t) => (
                <tr key={t.when}><td data-label="Hvornår"><strong>{t.when}</strong></td><td data-label="Dato">{t.date ? fmtDate(t.date) : 'Pr. forespørgsel'}</td><td data-label="Aktivitet">{t.activity}</td><td data-label="Ansvarlig">{t.owner}</td><td data-label="Regler">{t.rules}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
