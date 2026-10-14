import { kpiReport } from '@/services';
import { BarList, ColumnChart } from '../_components/Charts';
import { fmtDate, fmtPct } from '../_lib/format';
import { currentActor, prisma } from '../_lib/server';

export const dynamic = 'force-dynamic';

const num = (v: number | null) => (v === null ? '–' : String(v).replace('.', ','));

/** S11 Rapporter og KPI – beregnet af hændelsesloggen; ingen manuel dataindsamling i regneark (K7). */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const actor = await currentActor();
  const d = await kpiReport(prisma, actor, { from: sp.fra || undefined, to: sp.til || undefined, department: sp.afdeling || undefined });
  const t = d.totals;
  const weekMax = Math.max(1, ...d.perWeek.map((w) => Math.max(w.sent, w.answered)));
  const top = weekMax <= 4 ? 4 : weekMax <= 10 ? 10 : Math.ceil(weekMax / 5) * 5;
  const label = (w: string) => w.split('-')[1]!;
  return (
    <>
      <div className="topline"><span>Rapporter og KPI</span><span>{sp.fra || sp.til ? `${fmtDate(sp.fra)} – ${fmtDate(sp.til)}` : 'Hele perioden'}{sp.afdeling ? ` · ${sp.afdeling}` : ''}</span></div>
      <section className="card">
        <div className="section-head">
          <div>
            <h2>Rapporter og KPI</h2>
            <p>Rettidighed, svar, afvisninger og svartider pr. periode, afdeling og institut – beregnet direkte af hændelsesloggen.</p>
          </div>
          <div className="inline-actions">
            <a className="button secondary small" href="/api/rapporter/haendelseslog.csv">Hændelseslog (CSV)</a>
            <a className="button secondary small" href="/api/rapporter/ocel">Procesanalyse (OCEL 2.0)</a>
          </div>
        </div>
        <form className="filter-row" method="get" action="/rapporter">
          <label>Sendt fra<input type="date" name="fra" defaultValue={sp.fra ?? ''} /></label>
          <label>Sendt til<input type="date" name="til" defaultValue={sp.til ?? ''} /></label>
          <label>Afdeling<select name="afdeling" defaultValue={sp.afdeling ?? ''}><option value="">Alle</option>{['Revision Øst', 'Revision Vest'].map((x) => <option key={x}>{x}</option>)}</select></label>
          <button className="secondary">Vis</button>
        </form>
        <div className="stats four">
          <div className="stat"><span>Forespørgsler sendt</span><strong>{t.sent}</strong></div>
          <div className="stat"><span>Rettidig afsendelse</span><strong>{fmtPct(t.sentOnTimePct)}</strong></div>
          <div className="stat"><span>Svarprocent</span><strong>{fmtPct(t.answerRatePct)}</strong></div>
          <div className="stat"><span>Svar inden frist</span><strong>{fmtPct(t.answeredInTimePct)}</strong></div>
          <div className="stat"><span>Gns. svartid</span><strong>{num(t.avgResponseWorkdays)} hverdage</strong></div>
          <div className="stat"><span>Rykkere · eskaleringer</span><strong>{t.reminders} · {t.escalations}</strong></div>
          <div className="stat"><span>Afvisninger · ad hoc</span><strong>{t.rejections} · {t.adhoc}</strong></div>
          <div className="stat"><span>Konkluderet til tiden</span><strong>{fmtPct(t.concludedOnTimePct)} <small>({t.concluded})</small></strong></div>
        </div>
        <div className="two-col">
          <ColumnChart title="Sendt pr. uge" unit="sendt" max={top} labelEvery={d.perWeek.length > 12 ? 2 : 1} data={d.perWeek.map((w) => ({ key: w.week, label: label(w.week), value: w.sent, emphasis: true, detail: `Uge fra ${fmtDate(w.start)}` }))} />
          <ColumnChart title="Besvaret pr. uge" unit="besvaret" max={top} labelEvery={d.perWeek.length > 12 ? 2 : 1} data={d.perWeek.map((w) => ({ key: w.week, label: label(w.week), value: w.answered, emphasis: true, detail: `Uge fra ${fmtDate(w.start)}` }))} />
        </div>
        <div className="two-col">
          <BarList title="Afvisninger pr. årsag" unit="afvisninger" data={Object.entries(d.rejections).map(([label, value]) => ({ label, value }))} />
          <BarList title="Afvigelser pr. klassifikation" unit="afvigelser" data={Object.entries(d.bySeverity).filter(([, v]) => v > 0).map(([label, value]) => ({ label, value }))} />
        </div>
        <details>
          <summary>Tabelvisning pr. uge</summary>
          <div className="table-wrap"><table className="dense"><thead><tr><th>Uge</th><th className="num">Sendt</th><th className="num">Besvaret</th></tr></thead><tbody>{d.perWeek.map((w) => <tr key={w.week}><td>{w.week}</td><td className="num">{w.sent}</td><td className="num">{w.answered}</td></tr>)}</tbody></table></div>
        </details>
      </section>
      <section className="card">
        <h2>Pengeinstitutter</h2>
        <p>Svartider mod SLA pr. institut. Afvigelsen fra SLA opdateres automatisk i bankregisteret og bruges til forventet modtagelse næste år (K4).</p>
        <div className="table-wrap">
          <table className="stack dense">
            <thead><tr><th>Institut</th><th className="num">Sendt</th><th className="num">Besvaret</th><th className="num">Gns. svartid</th><th className="num">SLA</th><th className="num">Afvigelse fra frist</th><th className="num">Rykkere</th><th className="num">Afvisninger</th></tr></thead>
            <tbody>
              {d.perInstitute.map((i) => (
                <tr key={i.id}>
                  <td data-label="Institut"><strong>{i.name}</strong></td>
                  <td data-label="Sendt" className="num">{i.sent}</td>
                  <td data-label="Besvaret" className="num">{i.answered}</td>
                  <td data-label="Gns. svartid" className="num">{num(i.avgDays)}</td>
                  <td data-label="SLA" className="num">{i.sla}</td>
                  <td data-label="Afvigelse" className="num">{i.slaDeviation === null ? '–' : `${i.slaDeviation > 0 ? '+' : ''}${num(i.slaDeviation)}`}</td>
                  <td data-label="Rykkere" className="num">{i.reminders}</td>
                  <td data-label="Afvisninger" className="num">{i.rejections}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Afdelinger</h3>
        <div className="table-wrap">
          <table className="stack dense">
            <thead><tr><th>Afdeling</th><th className="num">Sager</th><th className="num">Sendt</th><th className="num">Besvaret</th></tr></thead>
            <tbody>{d.departments.map((x) => <tr key={x.department}><td data-label="Afdeling"><strong>{x.department}</strong></td><td data-label="Sager" className="num">{x.cases}</td><td data-label="Sendt" className="num">{x.sent}</td><td data-label="Besvaret" className="num">{x.answered}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="notice">Ad hoc-forespørgsler vises særskilt, så mønstre – fx mange institutter opdaget sent – kan føre til et bedre bankliste-forslag (SOP-EF-09). Eksporten af hændelsesloggen bruges til procesanalyse i evalueringen (P10).</div>
      </section>
    </>
  );
}
