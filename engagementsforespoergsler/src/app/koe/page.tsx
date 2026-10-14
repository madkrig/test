import Link from 'next/link';
import { workQueue, type QueueFilter } from '@/services';
import { Deadline, Empty } from '../_components/bits';
import { fmtDate } from '../_lib/format';
import { currentActor, prisma } from '../_lib/server';
import { QueueTable } from './QueueTable';

export const dynamic = 'force-dynamic';

const TILES: { key: QueueFilter['bucket']; label: string; field: 'klar' | 'fuldmagt' | 'svar' | 'overskredet' | 'verifikation' | 'afvist'; alert?: boolean }[] = [
  { key: 'KLAR', label: 'Klar til afsendelse', field: 'klar' },
  { key: 'FULDMAGT', label: 'Afventer fuldmagt', field: 'fuldmagt' },
  { key: 'SVAR', label: 'Afventer svar', field: 'svar' },
  { key: 'OVERSKREDET', label: 'Frist overskredet', field: 'overskredet', alert: true },
  { key: 'VERIFIKATION', label: 'Til verifikation', field: 'verifikation' },
  { key: 'AFVIST', label: 'Afvist af institut', field: 'afvist', alert: true },
];

/** S01 Arbejdskø – kerneteamets handlinger sorteret efter frist, med bulk og batch. */
export default async function QueuePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const actor = await currentActor();
  const filter: QueueFilter = { ...sp, view: (sp.view as QueueFilter['view']) ?? (sp.bucket ? 'ALLE' : 'HANDLING') };
  const q = await workQueue(prisma, actor, filter);
  const href = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/koe${next.size ? `?${next}` : ''}`;
  };
  return (
    <>
      <div className="topline"><span>Arbejdskø</span><span>{actor.name} · {fmtDate(q.today)}</span></div>
      <section className="card">
        <div className="section-head">
          <div>
            <h2>Arbejdskø</h2>
            <p>Alle forespørgsler, der kræver en handling fra kerneteamet – sorteret efter frist. Reglerne har lagt opgaverne her; ingen skal huske dem.</p>
          </div>
        </div>
        <div className="stats six">
          {TILES.map((t) => (
            <Link key={t.field} href={sp.bucket === t.key ? href({ bucket: undefined }) : href({ bucket: t.key, view: 'ALLE' })} className={`stat${t.alert && q.kpis[t.field] > 0 ? ' alert' : ''}${sp.bucket === t.key ? ' active' : ''}`} aria-pressed={sp.bucket === t.key}>
              <span>{t.label}</span><strong>{q.kpis[t.field]}</strong>
            </Link>
          ))}
        </div>
        <form className="filter-row" method="get" action="/koe">
          {sp.bucket && <input type="hidden" name="bucket" value={sp.bucket} />}
          <label>Balancedag
            <select name="balanceDate" defaultValue={sp.balanceDate ?? ''}><option value="">Alle åbne</option>{q.filters.balanceDates.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}</select>
          </label>
          <label>Pengeinstitut
            <select name="instituteId" defaultValue={sp.instituteId ?? ''}><option value="">Alle</option>{q.filters.institutes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
          </label>
          <label>Status
            <select name="view" defaultValue={filter.view}><option value="HANDLING">Kræver handling</option><option value="ALLE">Alle åbne</option></select>
          </label>
          <label>Revisor
            <select name="auditorId" defaultValue={sp.auditorId ?? ''}><option value="">Alle</option>{q.filters.auditors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          </label>
          <label>Afdeling
            <select name="department" defaultValue={sp.department ?? ''}><option value="">Alle</option>{q.filters.departments.map((d) => <option key={d} value={d}>{d}</option>)}</select>
          </label>
          <label style={{ flex: 1 }}>Søg
            <input type="search" name="q" defaultValue={sp.q ?? ''} placeholder="Kunde, CVR eller reference …" />
          </label>
          <button className="secondary">Filtrér</button>
        </form>
        {q.rows.length === 0 ? (
          <Empty>Ingen forespørgsler matcher filtrene. <Link href="/koe?view=ALLE">Vis alle åbne</Link>.</Empty>
        ) : (
          <QueueTable rows={q.rows} canAct={actor.role === 'KM' || actor.role === 'KL'} />
        )}
        <p><small>Viser {q.rows.length} af {q.total} åbne forespørgsler · Frister i rødt er overskredet, gule udløber inden for 3 hverdage · Køen viser kun sager, du har adgang til (10.4).</small></p>
      </section>

      <section className="card">
        <h2>Øvrige opgaver i kerneteamet</h2>
        <p>Banklister fra nye kunder, fuldmagter og svar uden match. Hver opgave har én ansvarlig og en frist (K3).</p>
        {q.other.length === 0 ? <Empty>Ingen åbne opgaver.</Empty> : (
          <div className="table-wrap">
            <table className="stack">
              <thead><tr><th>Opgave</th><th>Kunde</th><th>Ansvarlig</th><th>Frist</th></tr></thead>
              <tbody>
                {q.other.map((t) => (
                  <tr key={t.id}>
                    <td data-label="Opgave"><Link href={t.link}>{t.title}</Link><br /><small>{t.type}</small></td>
                    <td data-label="Kunde">{t.customer || '–'}</td>
                    <td data-label="Ansvarlig">{t.assignee}</td>
                    <td data-label="Frist"><Deadline date={t.dueDate} tone={t.deadlineTone} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
