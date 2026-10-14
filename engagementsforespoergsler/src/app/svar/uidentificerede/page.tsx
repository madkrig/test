import { unmatchedResponses } from '@/services';
import { Action } from '../../_components/Action';
import { Empty, Tag } from '../../_components/bits';
import { fmtDate, fmtDateTime } from '../../_lib/format';
import { currentActor, prisma } from '../../_lib/server';

export const dynamic = 'force-dynamic';

/** Uidentificerede svar (AR-01): svar uden reference eller entydigt match – håndteres inden 2 hverdage. */
export default async function UnmatchedPage() {
  const actor = await currentActor();
  const d = await unmatchedResponses(prisma, actor);
  return (
    <>
      <div className="topline"><span>Uidentificerede svar</span><span>{d.rows.length} i køen</span></div>
      <section className="card">
        <h2>Uidentificerede svar</h2>
        <p>Svar læses fra funktionspostkassen – ikke fra personlige indbakker. Kan et svar ikke matches på reference eller CVR, institut og dato, lander det her og matches manuelt inden 2 hverdage (SOP-EF-06).</p>
        {d.rows.length === 0 ? <Empty>Alle svar er matchet.</Empty> : (
          <ul className="signer-list">
            {d.rows.map((r) => (
              <li key={r.id}>
                <span className="who">
                  <strong>{r.subject}</strong>
                  <small>Fra {r.sender} ({r.institute}) · modtaget {fmtDateTime(r.receivedAt)} · opgørelsesdato {fmtDate(r.statementDate)} · {r.lines} linjer</small>
                  <small>{r.body}</small>
                </span>
                <span className="inline-actions">
                  {r.due === 'overdue' && <Tag tone="failed">Over 2 hverdage</Tag>}
                  {d.canMatch && (
                    <Action label="Match til forespørgsel" variant="small" endpoint={`/api/svar/${r.id}/match`} title="Match svaret manuelt"
                      intro="Afsenderen (AR-02) og opgørelsesdatoen (AR-03) kontrolleres, når svaret er matchet."
                      fields={[{ name: 'inquiryId', label: 'Forespørgsel', type: 'select', required: true, initial: r.candidates.find((c) => c.likely)?.id ?? '', options: r.candidates.map((c) => ({ value: c.id, label: `${c.label}${c.likely ? ' – sandsynlig' : ''}` })) }]} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
