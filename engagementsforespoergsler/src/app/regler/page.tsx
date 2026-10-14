import { rulesOverview } from '@/services';
import { Action, type FieldDef } from '../_components/Action';
import { fmtDate } from '../_lib/format';
import { currentActor, prisma } from '../_lib/server';

export const dynamic = 'force-dynamic';

const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v));

/** S10 Regler – parametre er data, ikke kode. Kun procesejeren kan ændre; nye versioner gælder fremadrettet (6.8). */
export default async function RulesPage() {
  const actor = await currentActor();
  const d = await rulesOverview(prisma, actor);
  const types = [...new Set(d.rules.map((r) => r.type))];
  return (
    <>
      <div className="topline"><span>Regler</span><span>{d.rules.length} regler · {d.rules.reduce((a, r) => a + r.versions.length, 0)} versioner</span></div>
      <section className="card">
        <h2>Regler, triggers og årshjul</h2>
        <p>Reglerne styrer, hvornår sager oprettes, hvad der kontrolleres før afsendelse, hvordan svar afstemmes, og hvornår der rykkes og eskaleres. En sag evalueres med det regelsæt, der gjaldt, da den blev oprettet – så en ændring midt i sæsonen ikke flytter frister på igangværende sager.</p>
        {!d.canEdit && <div className="notice">Kun procesejeren kan ændre regler. Du kan se dem.</div>}
        {types.map((t) => (
          <div key={t} className="card-section">
            <h3>{d.typeLabels[t as keyof typeof d.typeLabels]} ({t})</h3>
            <div className="table-wrap">
              <table className="stack dense">
                <thead><tr><th>Regel</th><th>Beskrivelse</th><th>Parametre</th><th>Version</th><th></th></tr></thead>
                <tbody>
                  {d.rules.filter((r) => r.type === t).map((r) => {
                    const entries = Object.entries(r.params as Record<string, unknown>);
                    const fields: FieldDef[] = entries.map(([k, v]) => ({
                      name: `params.${k}`, label: d.paramLabels[k] ?? k,
                      type: Array.isArray(v) ? (typeof v[0] === 'number' ? 'numlist' : 'list') : typeof v === 'number' ? 'number' : 'text',
                      initial: show(v), required: true, wide: typeof v === 'string' || Array.isArray(v),
                    }));
                    return (
                      <tr key={r.ruleId}>
                        <td data-label="Regel"><strong>{r.ruleId}</strong><span className="ref">{r.title}</span></td>
                        <td data-label="Beskrivelse">{r.description}</td>
                        <td data-label="Parametre">{entries.length ? entries.map(([k, v]) => <span key={k} className="ref" style={{ marginTop: 0 }}>{d.paramLabels[k] ?? k}: <strong>{show(v)}</strong></span>) : '–'}</td>
                        <td data-label="Version">v{r.version}<span className="ref">fra {fmtDate(r.activeFrom)}</span>{r.scheduled > 0 && <span className="ref missing">{r.scheduled} planlagt</span>}{r.versions.length > 1 && <details><summary>Historik</summary>{r.versions.map((v) => <span key={v.version} className="ref">v{v.version} {fmtDate(v.activeFrom)}–{fmtDate(v.activeTo)}: {Object.entries(v.params).map(([k, x]) => `${k}=${show(x)}`).join(', ') || '–'} · {v.changedBy}: {v.reason}</span>)}</details>}</td>
                        <td>{d.canEdit && entries.length > 0 && (
                          <Action label="Ny version" variant="small-secondary" endpoint={`/api/regler/${r.ruleId}`} title={`${r.ruleId} · ${r.title}`} intro="Den nye version gælder for sager oprettet fra ikrafttrædelsen. Ændringen logges med begrundelse."
                            fields={[...fields, { name: 'activeFrom', label: 'Ikrafttrædelse', type: 'date', required: true, initial: d.today }, { name: 'reason', label: 'Begrundelse', type: 'textarea', required: true }]} />
                        )}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
