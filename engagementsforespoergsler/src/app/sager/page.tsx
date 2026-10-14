import Link from 'next/link';
import { CASE_STATUS_LABELS } from '@/domain/ef';
import { caseList } from '@/services';
import { Action } from '../_components/Action';
import { Empty, Tracking } from '../_components/bits';
import { fmtDate } from '../_lib/format';
import { currentActor, prisma } from '../_lib/server';

export const dynamic = 'force-dynamic';

/** S02 Mine sager – revisors overblik med pakkesporing og næste handling. */
export default async function CasesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const actor = await currentActor();
  const scope = (sp.scope as 'MINE' | 'ALLE') ?? undefined;
  const data = await caseList(prisma, actor, { scope, balanceDate: sp.balanceDate, status: sp.status, mineOnly: sp.mineOnly === '1' });
  const forMe = data.rows.filter((r) => r.forMe).length;
  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/sager${next.size ? `?${next}` : ''}`;
  };
  return (
    <>
      <div className="topline"><span>{data.scope === 'MINE' ? 'Mine sager' : 'Alle sager'}</span><span>{data.rows.length} sager · {forMe} kræver din handling</span></div>
      <section className="card">
        <div className="section-head">
          <div>
            <h2>{data.scope === 'MINE' ? 'Mine sager' : 'Sager'}</h2>
            <p>Én sag pr. erklæringsopgave og balancedag. Pakkesporingen viser, hvor sagen er, og hvem der har bolden.</p>
          </div>
          <div className="filters" role="tablist" aria-label="Omfang">
            <Link role="tab" aria-selected={data.scope === 'MINE'} className={data.scope === "MINE" ? "active" : ""} href={href({ scope: 'MINE' })}>Mine</Link>
            <Link role="tab" aria-selected={data.scope === 'ALLE'} className={data.scope === "ALLE" ? "active" : ""} href={href({ scope: 'ALLE' })}>Alle jeg har adgang til</Link>
          </div>
        </div>
        <form className="filter-row" method="get" action="/sager">
          <input type="hidden" name="scope" value={data.scope} />
          <label>Balancedag
            <select name="balanceDate" defaultValue={sp.balanceDate ?? ''}><option value="">Alle</option>{data.balanceDates.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}</select>
          </label>
          <label>Status
            <select name="status" defaultValue={sp.status ?? ''}><option value="">Alle</option>{Object.entries(CASE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <label className="check" style={{ alignSelf: 'center', paddingTop: 14 }}><input type="checkbox" name="mineOnly" value="1" defaultChecked={sp.mineOnly === '1'} /> Kræver min handling</label>
          <button className="secondary">Filtrér</button>
        </form>
        {data.rows.length === 0 ? <Empty>Ingen sager matcher. Sager oprettes automatisk ved T−60 (TR-02).</Empty> : (
          <div className="table-wrap">
            <table className="stack dense">
              <thead><tr><th>Kunde</th><th>Balancedag</th><th>Påtegning</th><th>Pakkesporing</th><th>Næste handling</th><th>Hvem har bolden</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Kunde"><strong><Link href={`/sager/${r.id}`}>{r.customer}</Link></strong><span className="ref">{r.type} · CVR {r.cvr}</span></td>
                    <td data-label="Balancedag">{fmtDate(r.balanceDate)}</td>
                    <td data-label="Påtegning">{fmtDate(r.plannedSignOff)}</td>
                    <td data-label="Pakkesporing"><Tracking steps={r.tracking} compact /><span className="ref">{r.statusLabel}</span></td>
                    <td data-label="Næste handling">{r.myNext ? <strong>{r.myNext}</strong> : r.forMe ? <strong>{r.nextAction}</strong> : r.nextAction}{r.myTasks > 1 && <span className="ref">{r.myTasks} åbne opgaver til dig</span>}{r.myNext && r.myNext !== r.nextAction && <span className="ref">Sagen: {r.nextAction}</span>}</td>
                    <td data-label="Hvem har bolden">{r.forMe ? <span className="tag waiting">Dig</span> : r.nextOwner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {data.optIn.length > 0 && (
        <section className="card">
          <h2>Opgaver uden forespørgselspligt</h2>
          <p>Review og opstilling har ikke pligt (TR-01). Tilvælg engagementsforespørgsler, hvis du vurderer, at der er behov – derefter kører samme proces.</p>
          <ul className="signer-list">
            {data.optIn.map((e) => (
              <li key={e.id}>
                <span className="who"><strong>{e.customer}</strong><small>{e.type} · balancedag {fmtDate(e.balanceDate)}</small></span>
                <Action label="Tilvælg forespørgsler" variant="small-secondary" endpoint={`/api/opgaver/${e.id}/tilvalg`} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
