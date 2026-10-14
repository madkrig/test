import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DomainError, responseDetail } from '@/services';
import { Action, type FieldDef } from '../../_components/Action';
import { Empty, Tag } from '../../_components/bits';
import { fmtDate, fmtDateTime, fmtKr } from '../../_lib/format';
import { currentActor, prisma } from '../../_lib/server';

export const dynamic = 'force-dynamic';

const MATCH: Record<string, { label: string; tone: string }> = {
  MATCH: { label: 'Match', tone: 'ok' },
  DIFFERENCE: { label: 'Difference', tone: 'failed' },
  KUN_I_SVAR: { label: 'Kun i bank', tone: 'failed' },
  KUN_I_BOGFOERING: { label: 'Kun i bogføring', tone: 'failed' },
};

/** S06 Svar og afstemning – svaret side om side med udtræk og bogføring. Erstatter afstemningen i Excel. */
export default async function ResponsePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await currentActor();
  let d: Awaited<ReturnType<typeof responseDetail>>;
  try {
    d = await responseDetail(prisma, actor, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === 'NOT_FOUND') notFound();
    throw e;
  }
  const r = d.response;
  if (!d.inquiry || !d.case || !d.tiles || !d.checks) {
    return (
      <>
        <div className="topline"><span>Svar</span><span>Uidentificeret</span></div>
        <section className="card">
          <h2>Svaret er ikke matchet</h2>
          <p>Svaret fra {r.sender} kunne ikke matches på reference eller CVR, institut og dato (AR-01). Match det i køen for uidentificerede svar.</p>
          <Link className="button" href="/svar/uidentificerede">Gå til uidentificerede svar</Link>
        </section>
      </>
    );
  }
  const approved = !!r.approvedAt;
  const selected = sp.linje;
  const dateOk = r.statementDate === d.inquiry.statementDate;
  const pm = d.permissions;
  const openDeviations = d.deviations.filter((x) => x.status !== 'LUKKET');
  const unsent = openDeviations.filter((x) => !x.sentToAuditorAt);
  const lineFields = (l: (typeof d.lines)[number]): FieldDef[] => [
    { name: 'category', label: 'Kategori', type: 'select', required: true, initial: l.category, options: d.categories.map((c) => ({ value: c.key, label: c.label })) },
    { name: 'accountRef', label: 'Konto', type: 'text', initial: l.accountRef ?? '' },
    { name: 'description', label: 'Tekst', type: 'text', required: true, initial: l.description },
    { name: 'currency', label: 'Valuta', type: 'text', required: true, initial: l.currency },
    { name: 'amountOre', label: 'Beløb iflg. pengeinstitut', type: 'kr', initial: l.amountOre === null ? '' : fmtKr(l.amountOre), help: 'I valutaen ovenfor. Omregnes med Nationalbankens kurs på balancedagen (AR-10).' },
  ];
  const lineById = new Map(d.lines.map((l) => [l.id, l]));

  return (
    <>
      <div className="topline"><span>Svar og afstemning</span><span>{d.inquiry.statusLabel}</span></div>
      <section className="card">
        <div className="case-head">
          <div>
            <h2>Svar og afstemning · {d.inquiry.institute}</h2>
            <p>
              <Link href={`/sager/${d.case.id}?fane=forespoergsler`}>{d.case.customer}</Link> · Reference {d.inquiry.reference} · Opgørelsesdato {fmtDate(r.statementDate)} {dateOk ? '✓' : <span className="missing">≠ {fmtDate(d.inquiry.statementDate)} (AR-03)</span>} · Modtaget {fmtDateTime(r.receivedAt)} {r.channel === 'PLATFORM' ? 'via platformen' : `i ${d.inquiry.mailbox}`} ·{' '}
              {r.senderVerified ? <strong style={{ color: 'var(--ok-text)' }}>Afsender verificeret (kendt {r.channel === 'PLATFORM' ? 'kanal' : 'domæne'})</strong> : <strong className="missing">Afsender ikke verificeret (AR-02)</strong>}
            </p>
          </div>
          {approved && <span className="result-tag">Udtræk godkendt {fmtDate(r.approvedAt)}</span>}
        </div>
        {r.invalidReason && <div className="error" role="alert"><strong>Svaret kan ikke bruges som revisionsbevis.</strong><div>{r.invalidReason}</div></div>}
      </section>

      <div className="split" style={{ marginTop: 22 }}>
        <div className="pdf-frame">
          <div className="pdf" aria-label="Svarets dokument">
            <h4>Engagementsopgørelse</h4>
            <div className="meta">{d.inquiry.institute} · pr. {fmtDate(r.statementDate)} · {d.document.attachment}</div>
            <p style={{ fontSize: 12 }}>{d.document.body}</p>
            <table>
              <thead><tr><th>Engagement</th><th className="num">Saldo</th></tr></thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.id} className={selected === l.id ? 'mark' : ''}>
                    <td>{l.description}<span className="ref">{l.account}</span></td><td className="num">{l.currency !== 'DKK' ? `${l.currency} ` : ''}{fmtKr(l.amountOre)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="sig">
              <strong>Tegningsret</strong>
              <div>{d.document.signingRights.join(', ') || '–'}</div>
            </div>
            <p className="muted archive-ref">Arkiveret: {r.documentRef}</p>
          </div>
        </div>

        <div>
          <div className="stats three" style={{ marginTop: 0 }}>
            <div className="stat"><span>Linjer matcher {approved ? '' : 'automatisk'}</span><strong>{d.tiles.matched} / {d.tiles.total}</strong></div>
            <div className={`stat${d.tiles.deviations ? ' alert' : ''}`}><span>Afvigelser til behandling</span><strong>{d.tiles.deviations}</strong></div>
            <div className="stat"><span>Sikkerhed i AI-udtræk</span><strong>{d.tiles.aiConfidence === null ? '–' : `${Math.round(d.tiles.aiConfidence * 100)} %`}</strong></div>
          </div>
          {!approved && d.checks.blockers.length > 0 && <div className="notice"><strong>Før udtrækket kan godkendes:</strong><ul>{d.checks.blockers.map((b) => <li key={b}>{b}</li>)}</ul></div>}
          {!approved && d.checks.warnings.length > 0 && <div className="notice"><ul>{d.checks.warnings.map((b) => <li key={b}>{b}</li>)}</ul></div>}

          <div className="table-wrap" style={{ marginTop: 0 }}>
            <table className="stack dense">
              <thead><tr><th>Kategori og konto</th><th className="num">Iflg. pengeinstitut</th><th className="num">Iflg. bogføring</th><th className="num">Difference</th><th>Status</th></tr></thead>
              <tbody>
                {d.recon.map((x, n) => {
                  const line = x.responseLineId ? lineById.get(x.responseLineId) : undefined;
                  const m = MATCH[x.matchStatus]!;
                  return (
                    <tr key={n} className={selected && selected === x.responseLineId ? 'selected' : ''}>
                      <td data-label="Kategori">
                        {line ? <Link href={`?linje=${line.id}`} scroll={false}>{x.category}</Link> : x.category}<span className="ref">{x.account}</span>
                        {!approved && line && (
                          <div className="inline-actions line-tools">
                            <span className={`conf${line.low && !line.verified ? ' low' : ''}`}>AI {line.aiConfidence === null ? 'manuel' : `${Math.round(line.aiConfidence * 100)} %`}{line.verified ? ' · kontrolleret' : ''}</span>
                            {pm.register && line.low && !line.verified && <Action label="Kontrollér" variant="small" endpoint={`/api/svarlinjer/${line.id}/kontroller`} />}
                            {pm.register && <Action label="Ret" variant="small-secondary" endpoint={`/api/svarlinjer/${line.id}`} method="PATCH" title="Ret udtræk" intro="Rettelsen logges med før og efter." fields={lineFields(line)} />}
                          </div>
                        )}
                      </td>
                      <td data-label="Iflg. pengeinstitut" className="num">{fmtKr(x.bankOre)}</td>
                      <td data-label="Iflg. bogføring" className="num">{fmtKr(x.bookedOre)}</td>
                      <td data-label="Difference" className="num">{fmtKr(x.differenceOre)}</td>
                      <td data-label="Status"><Tag tone={m.tone}>{m.label}</Tag></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="panel two-col">
            <div>
              <h3>Sikkerheder og garantier</h3>
              <p>{d.notes.length ? d.notes.map((n) => `${n.label} ${fmtKr(n.amountDkkOre)} kr.`).join(' · ') : 'Ingen oplyst.'}</p>
              {d.notes.length > 0 && <small>→ overføres til revisor som input til noter (AR-08)</small>}
            </div>
            <div>
              <h3>Tegningsret i banken</h3>
              <p>{d.signingRights?.matches ? `✓ ${d.signingRights.bank.length} ${d.signingRights.bank.length === 1 ? 'person' : 'personer'} – svarer til CVR` : <span className="missing">Afviger fra CVR: {d.signingRights?.extra.join(', ')} (AR-09)</span>}</p>
            </div>
          </div>

          {!approved && d.previewDeviations.length > 0 && (
            <div className="notice"><strong>Afvigelser, der oprettes ved godkendelse:</strong><ul>{d.previewDeviations.map((x) => <li key={x.description}>{x.severityLabel}: {x.description}</li>)}</ul></div>
          )}

          {approved && (
            <>
              <h3>Afvigelser</h3>
              {d.deviations.length === 0 ? <Empty>Ingen afvigelser – svaret er afstemt.</Empty> : (
                <ul className="signer-list">
                  {d.deviations.map((x) => (
                    <li key={x.id}>
                      <span className="who"><strong><Link href={`/afvigelser/${x.id}`}>{x.type}</Link></strong><small>{x.description}</small>{x.decision && <small>{x.decision}: {x.justification}</small>}</span>
                      <span className="inline-actions">
                        <Tag tone={x.status === 'LUKKET' ? 'ok' : x.severity === 'KRITISK' ? 'failed' : 'waiting'}>{x.severityLabel} · {x.status === 'LUKKET' ? 'Lukket' : x.status === 'UNDER_VURDERING' ? 'Under vurdering' : x.sentToAuditorAt ? 'Hos revisor' : 'Åben'}</Tag>
                        {pm.assess && x.status === 'AABEN' && (
                          <Action label="Markér som forklaret …" variant="small-secondary" endpoint={`/api/afvigelser/${x.id}/vurdering`} body={{ decision: 'FORKLARET' }} title="Markér som forklaret" intro="Kritiske og væsentlige afvigelser kan kun lukkes af opgaveansvarlig revisor – din vurdering sendes til godkendelse."
                            fields={[{ name: 'justification', label: 'Begrundelse', type: 'textarea', required: true }]} />
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          <div className="actions">
            {pm.register && !approved && (
              <Action label="Ret udtræk" variant="secondary" endpoint={`/api/svar/${r.id}/linjer`} title="Tilføj linje manuelt" intro="Fase 1 kan registreres manuelt; fase 2 bruger AI-udtræk. Begge logges."
                fields={[{ name: 'category', label: 'Kategori', type: 'select', required: true, options: d.categories.map((c) => ({ value: c.key, label: c.label })) }, { name: 'accountRef', label: 'Konto', type: 'text' }, { name: 'description', label: 'Tekst', type: 'text', required: true }, { name: 'currency', label: 'Valuta', type: 'text', initial: 'DKK', required: true }, { name: 'amountOre', label: 'Beløb', type: 'kr' }]} />
            )}
            <span className="spacer" />
            {pm.register && !approved && d.inquiry.status === 'SVAR_MODTAGET' && <Action label="Godkend udtræk" endpoint={`/api/svar/${r.id}/godkend`} acknowledgeKey="acknowledgeWarnings" disabled={d.checks.blockers.length > 0} disabledReason="Løs punkterne ovenfor først" />}
            {pm.sendToAuditor && <Action label={`Send ${unsent.length} ${unsent.length === 1 ? 'afvigelse' : 'afvigelser'} til revisor`} endpoint={`/api/forespoergsler/${d.inquiry.id}/afvigelser/send`} />}
          </div>
        </div>
      </div>
    </>
  );
}
