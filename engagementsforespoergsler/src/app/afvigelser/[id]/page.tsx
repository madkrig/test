import Link from 'next/link';
import { notFound } from 'next/navigation';
import { deviationDetail, DomainError } from '@/services';
import { Action } from '../../_components/Action';
import { Tag } from '../../_components/bits';
import { fmtDate, fmtDateTime, fmtKr } from '../../_lib/format';
import { currentActor, prisma } from '../../_lib/server';

export const dynamic = 'force-dynamic';

/** S07 Afvigelse – vurdering, klassifikation, begrundelse og beslutning. */
export default async function DeviationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor();
  let d: Awaited<ReturnType<typeof deviationDetail>>;
  try {
    d = await deviationDetail(prisma, actor, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === 'NOT_FOUND') notFound();
    throw e;
  }
  const x = d.deviation;
  const closed = x.status === 'LUKKET';
  return (
    <>
      <div className="topline"><span>Afvigelse</span><span>{d.case.customer} · {fmtDate(d.case.balanceDate)}</span></div>
      <section className="card">
        <div className="case-head">
          <div>
            <h2>{x.type}</h2>
            <p><Link href={`/sager/${d.case.id}?fane=svar`}>{d.case.customer}</Link>{d.inquiry ? ` · ${d.inquiry.institute} · ${d.inquiry.reference}` : ''} · Opgaveansvarlig: {d.case.responsible}</p>
          </div>
          <Tag tone={closed ? 'ok' : x.severity === 'KRITISK' ? 'failed' : 'waiting'}>{x.severityLabel} · {closed ? 'Lukket' : x.status === 'UNDER_VURDERING' ? 'Under vurdering' : 'Åben'}</Tag>
        </div>
        <p>{x.description}</p>
        <div className="stats three">
          <div className="stat"><span>Iflg. pengeinstitut</span><strong>{d.evidence.bank ? fmtKr(d.evidence.bank.amountDkkOre) : '–'}</strong></div>
          <div className="stat"><span>Iflg. bogføring</span><strong>{d.evidence.ledger ? fmtKr(d.evidence.ledger.balanceOre) : '–'}</strong></div>
          <div className="stat"><span>Difference</span><strong>{fmtKr(d.evidence.differenceOre ?? x.amountOre)}</strong></div>
        </div>
        <dl>
          <dt>Kilde i svaret</dt><dd>{d.evidence.bank ? `${d.evidence.bank.description} ${d.evidence.bank.account}${d.evidence.bank.currency !== 'DKK' ? ` (${d.evidence.bank.currency})` : ''}` : '–'} {d.responseId && <Link href={`/svar/${d.responseId}`}>Åbn svaret</Link>}</dd>
          <dt>Kilde i bogføringen</dt><dd>{d.evidence.ledger ? `${d.evidence.ledger.name} ${d.evidence.ledger.account} (SAF-T)` : '–'}</dd>
          <dt>Oprettet</dt><dd>{fmtDateTime(x.createdAt)}</dd>
          <dt>Sendt til revisor</dt><dd>{fmtDateTime(x.sentToAuditorAt)}</dd>
          <dt>Vurdering</dt><dd>{x.decisionLabel ? `${x.decisionLabel} – ${x.justification}` : '–'}{x.preparedBy ? ` (forberedt af ${x.preparedBy})` : ''}</dd>
          <dt>Godkendt</dt><dd>{x.approvedBy ? `${x.approvedBy} ${fmtDateTime(x.approvedAt)}` : '–'}</dd>
        </dl>
        {!closed && !d.permissions.canClose && d.permissions.assess && (
          <div className="notice">Kritiske og væsentlige afvigelser kan kun lukkes af opgaveansvarlig revisor. Din vurdering sendes til godkendelse (OPG-10).</div>
        )}
        {!closed && (
          <div className="actions">
            {d.permissions.askCustomer && (
              <Action label="Bed kunden om forklaring" variant="secondary" endpoint={`/api/afvigelser/${x.id}/kunde`} title="Bed kunden om en forklaring" fields={[{ name: 'question', label: 'Spørgsmål til kunden', type: 'textarea', required: true, initial: `Banken oplyser: ${x.description} Kan I forklare forskellen og sende dokumentation?` }]} successMessage="Mail sendt fra funktionspostkassen." />
            )}
            <span className="spacer" />
            {d.permissions.assess && (
              <Action label={d.permissions.canClose ? 'Beslut og luk' : 'Forbered vurdering'} endpoint={`/api/afvigelser/${x.id}/vurdering`} title={d.permissions.canClose ? 'Beslut og luk afvigelsen' : 'Forbered vurdering til revisor'}
                fields={[
                  { name: 'decision', label: 'Beslutning', type: 'select', required: true, initial: x.decision ?? '', options: d.decisions.map((o) => ({ value: o.key, label: o.label })) },
                  ...(d.permissions.reclassify ? [{ name: 'severity', label: 'Klassifikation', type: 'select' as const, initial: x.severity, options: d.severities.map((o) => ({ value: o.key, label: o.label })) }] : []),
                  { name: 'justification', label: 'Begrundelse og evt. foreslået korrektion', type: 'textarea', required: true, initial: x.justification ?? '' },
                ]} />
            )}
          </div>
        )}
      </section>
      <section className="card">
        <h3 style={{ marginTop: 0 }}>Historik</h3>
        <ol className="timeline">
          {d.history.map((h) => <li key={h.id}><b>{h.action}</b>{h.reason ? ` – ${h.reason}` : ''}<small className="ev-meta">{fmtDateTime(h.at)} · {h.actor}</small></li>)}
        </ol>
      </section>
    </>
  );
}
