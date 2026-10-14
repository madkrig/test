import { fuldmagtOverview } from '@/services';
import { Action } from '../_components/Action';
import { Empty, Tag } from '../_components/bits';
import { fmtDate } from '../_lib/format';
import { currentActor, prisma } from '../_lib/server';

export const dynamic = 'force-dynamic';

const ROLE: Record<string, string> = { DIREKTOER: 'Direktør', FORMAND: 'Bestyrelsesformand', BESTYRELSESMEDLEM: 'Bestyrelsesmedlem' };
const resultTone = (r: string) => (r === 'GYLDIG' ? 'ok' : r === 'BOER_FORNYES' ? 'waiting' : 'failed');

/** S05 Fuldmagter – status pr. kunde med årsag (FR-ID), Penneo-signering og 4-øjne. Erstatter Word og mail. */
export default async function AuthPage() {
  const actor = await currentActor();
  const d = await fuldmagtOverview(prisma, actor);
  const signing = d.rows.filter((r) => r.active?.status === 'SENDT_TIL_SIGNERING').length;
  const toVerify = d.rows.filter((r) => r.active?.status === 'UNDERSKREVET').length;
  const missing = d.rows.filter((r) => r.result === 'MANGLER' || r.result === 'SKAL_FORNYES').length;
  const bulkCandidates = d.rows.filter((r) => r.needsAction && r.result !== 'GYLDIG' && (!r.active || r.active.status === 'UDKAST'));
  return (
    <>
      <div className="topline"><span>Fuldmagter</span><span>Dækning {d.coverage.valid}/{d.coverage.total} kunder</span></div>
      <section className="card">
        <div className="section-head">
          <div>
            <h2>Fuldmagter</h2>
            <p>Kontrollen kører mod CVR ved T−60, ved ny tegningsregel og ved afvisning (TR-04). Fuldmagter dannes fra skabelonen (bilag A), underskrives med MitID i Penneo, og underskriverne tjekkes automatisk mod tegningsreglen (FR-02).</p>
          </div>
          {d.canAct && bulkCandidates.length > 0 && (
            <Action label={`Send ${bulkCandidates.length} til signering`} endpoint="/api/fuldmagter/bulk" title="Bulk-signering via Penneo"
              intro="Der dannes én fuldmagt pr. kunde med de underskrivere, tegningsreglen kræver. Kunden får en e-mail med link til Penneo og en kort forklaring om gebyr."
              fields={[{ name: 'customerIds', label: 'Kunder', type: 'checkboxes', options: bulkCandidates.map((r) => ({ value: r.customerId, label: `${r.customer} – ${r.resultLabel} (${r.ruleId ?? 'ingen fuldmagt'})` })), initial: bulkCandidates.map((r) => r.customerId) }]} submitLabel="Send til signering" />
          )}
        </div>
        <div className="stats four">
          <div className="stat"><span>Gyldig fuldmagt</span><strong>{d.coverage.valid} af {d.coverage.total}</strong></div>
          <div className="stat"><span>Afventer underskrift</span><strong>{signing}</strong></div>
          <div className={`stat${toVerify ? ' alert' : ''}`}><span>Til verifikation (4-øjne)</span><strong>{toVerify}</strong></div>
          <div className={`stat${missing ? ' alert' : ''}`}><span>Mangler eller skal fornyes</span><strong>{missing}</strong></div>
        </div>
        {d.rows.length === 0 ? <Empty>Ingen kunder med åbne sager.</Empty> : (
          <div className="table-wrap">
            <table className="stack dense">
              <thead><tr><th>Kunde</th><th>Kontrol</th><th>I gang</th><th>Frist</th><th>Handlinger</th></tr></thead>
              <tbody>
                {d.rows.map((r) => {
                  const mgmt = r.management.map((m) => ({ value: m.unitNumber, label: `${m.name} (${ROLE[m.role] ?? m.role})` }));
                  const a = r.active;
                  return (
                    <tr key={r.customerId}>
                      <td data-label="Kunde"><strong>{r.customer}</strong><span className="ref">CVR {r.cvr}</span><span className="ref" title={r.signingRule}>{r.signingRule}</span></td>
                      <td data-label="Kontrol">
                        <Tag tone={resultTone(r.result)}>{r.resultLabel}{r.ruleId ? ` · ${r.ruleId}` : ''}</Tag>
                        <span className="ref">{r.reason}</span>
                        {r.current && <span className="ref">Nuværende: {fmtDate(r.current.signedDate)} · {r.current.holderName}</span>}
                        {r.specific.map((x) => <span key={x.instituteId} className="ref">{x.institute}: {x.label}{x.pending ? ` · ${x.pending.statusLabel}` : ''}</span>)}
                      </td>
                      <td data-label="I gang">
                        {a ? (
                          <>
                            <Tag tone={a.status === 'UNDERSKREVET' ? 'failed' : 'waiting'}>{a.statusLabel}{a.daysSinceSent !== null && a.status === 'SENDT_TIL_SIGNERING' ? ` · dag ${a.daysSinceSent}` : ''}</Tag>
                            <span className="ref">{a.source === 'MANUEL' ? `Manuel upload af ${a.uploadedBy}` : a.penneoCaseId ?? 'Udkast fra skabelon'}</span>
                            <span className="ref">{a.signers.map((x) => `${x.name}${x.signedAt ? ' ✓' : ''}`).join(', ') || 'Ingen underskrivere valgt'}</span>
                          </>
                        ) : '–'}
                      </td>
                      <td data-label="Frist">{fmtDate(r.authDeadline)}</td>
                      <td data-label="Handlinger">
                        <div className="inline-actions">
                          {a && <a className="button small secondary" href={`/api/fuldmagter/${a.id}/dokument`} target="_blank" rel="noreferrer">Se fuldmagt</a>}
                          {d.canAct && a?.status === 'UDKAST' && (
                            <Action label="Send til signering" variant="small" endpoint={`/api/fuldmagter/${a.id}/signering`} title={`Send fuldmagt for ${r.customer} til Penneo`}
                              intro={`Tegningsregel: ${r.signingRule} Underskriverne kontrolleres, før kunden får noget.`}
                              fields={[{ name: 'signerUnits', label: 'Underskrivere', type: 'checkboxes', options: mgmt, initial: a.signers.map((x) => x.unitNumber) }]} submitLabel="Send til Penneo" />
                          )}
                          {d.canAct && a?.status === 'SENDT_TIL_SIGNERING' && <Action label="Påmind kunde" variant="small-secondary" endpoint={`/api/fuldmagter/${a.id}/paamind`} successMessage="Påmindelse sendt via Penneo." />}
                          {d.demo && a?.status === 'SENDT_TIL_SIGNERING' && <Action label="Demo: underskriv i Penneo" variant="small-secondary" endpoint={`/api/fuldmagter/${a.id}/penneo-underskrevet`} />}
                          {d.canVerify && a?.status === 'UNDERSKREVET' && (
                            <>
                              <Action label="Godkend underskrivere" variant="small" endpoint={`/api/fuldmagter/${a.id}/verificer`} body={{ approve: true }} disabled={a.uploadedById === d.actorId} disabledReason="Du har selv uploadet fuldmagten – en anden skal verificere (4-øjne)." fields={[{ name: 'note', label: 'Bemærkning til kontrollen', type: 'text' }]} title="4-øjne: verificér underskrivere" intro={`Kontrollér underskrifterne på papirfuldmagten mod tegningsreglen: ${r.signingRule}`} />
                              <Action label="Afvis" variant="small-secondary" endpoint={`/api/fuldmagter/${a.id}/verificer`} body={{ approve: false }} disabled={a.uploadedById === d.actorId} disabledReason="Du har selv uploadet fuldmagten." fields={[{ name: 'note', label: 'Hvorfor afvises den?', type: 'textarea', required: true }]} />
                            </>
                          )}
                          {d.canAct && !a && r.result !== 'GYLDIG' && (
                            <>
                              <Action label="Dan fuldmagt" variant="small" endpoint="/api/fuldmagter" body={{ customerId: r.customerId, scope: 'GENEREL' }} />
                              <Action label="Upload papirfuldmagt" variant="small-secondary" endpoint="/api/fuldmagter/manuel" body={{ customerId: r.customerId, scope: 'GENEREL' }} title="Upload manuelt underskrevet fuldmagt (FR-09)"
                                intro="En anden kernemedarbejder skal verificere underskrifterne mod tegningsreglen, før fuldmagten kan bruges."
                                fields={[{ name: 'signedDate', label: 'Underskriftsdato', type: 'date', required: true }, { name: 'signerUnits', label: 'Underskrevet af', type: 'checkboxes', options: mgmt }, { name: 'fileName', label: 'Fil', type: 'text', required: true, initial: `Fuldmagt-${r.cvr}.pdf` }]} />
                            </>
                          )}
                          {d.canAct && r.specific.filter((x) => x.result === 'MANGLER' && !x.pending).map((x) => (
                            <Action key={x.instituteId} label={`Dan bankspecifik (${x.institute})`} variant="small-secondary" endpoint="/api/fuldmagter" body={{ customerId: r.customerId, scope: 'BANKSPECIFIK', instituteId: x.instituteId }} />
                          ))}
                          {d.canAct && r.specific.filter((x) => x.pending?.status === 'UDKAST').map((x) => (
                            <Action key={x.pending!.id} label={`Send bankspecifik (${x.institute})`} variant="small" endpoint={`/api/fuldmagter/${x.pending!.id}/signering`} />
                          ))}
                          {d.canAct && r.current && r.result === 'GYLDIG' && (
                            <Action label="Tilbagekald" variant="small-secondary" endpoint={`/api/fuldmagter/${r.current.id}/tilbagekald`} title="Kunden tilbagekalder fuldmagten (FR-07)" intro="Åbne forespørgsler stoppes, og revisor skal vurdere alternative handlinger (ISA 505.8–9)." fields={[{ name: 'reason', label: 'Begrundelse', type: 'textarea', required: true }]} />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="notice"><strong>Fuldmagtshaver.</strong> Fuldmagter til tidligere Cedra-enheder og carve-out-fuldmagter til en anden revisor er ugyldige, indtil beslutning D1 siger andet (FR-03). Fuldmagtsteksten er et udkast og kræver juridisk review før brug.</div>
      </section>
    </>
  );
}
