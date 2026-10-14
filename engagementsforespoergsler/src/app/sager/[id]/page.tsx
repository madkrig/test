import Link from 'next/link';
import { notFound } from 'next/navigation';
import { REJECTION_REASON_LABELS } from '@/domain/ef';
import { caseDetail, DomainError } from '@/services';
import { Action } from '../../_components/Action';
import { Deadline, Empty, Tag, Tracking } from '../../_components/bits';
import { fmtDate, fmtDateTime, fmtKr } from '../../_lib/format';
import { currentActor, prisma } from '../../_lib/server';

export const dynamic = 'force-dynamic';

type Detail = Awaited<ReturnType<typeof caseDetail>>;

const TABS = [
  { key: 'forespoergsler', label: 'Forespørgsler' },
  { key: 'bankliste', label: 'Bankliste' },
  { key: 'fuldmagt', label: 'Fuldmagt' },
  { key: 'svar', label: 'Svar og afstemning' },
  { key: 'opgaver', label: 'Opgaver' },
  { key: 'historik', label: 'Historik' },
  { key: 'dokumenter', label: 'Dokumenter' },
];

const ACTION_LABELS: Record<string, string> = {
  'sag.oprettet': 'Sag oprettet', 'bankliste.foreslaaet': 'Bankliste foreslået', 'bankliste.godkendt': 'Bankliste godkendt', 'bankliste.linje_tilfoejet': 'Institut tilføjet',
  'bankliste.linje_fravalgt': 'Institut fravalgt', 'bankliste.linje_medtaget': 'Institut medtaget', 'bankliste.kunde_bekraeftet': 'Kunden har bekræftet banklisten', 'bankliste.paamindelse': 'Påmindelse om bankliste',
  'bankliste.eskaleret': 'Bankliste eskaleret til kerneteamleder', 'forespoergsel.oprettet': 'Forespørgsel oprettet', 'forespoergsel.klar': 'Klar til afsendelse', 'forespoergsel.tilbage_til_kladde': 'Tilbage til kladde',
  'forespoergsel.sendt': 'Sendt', 'forespoergsel.rykket': 'Rykker sendt', 'forespoergsel.afvist': 'Afvist af institut', 'forespoergsel.svar_modtaget': 'Svar modtaget', 'forespoergsel.afventer_revisor': 'Afvigelser sendt til revisor',
  'forespoergsel.afsluttet': 'Afsluttet', 'forespoergsel.annulleret': 'Annulleret', 'forespoergsel.uden_svar': 'Uden svar – alternative handlinger', 'forespoergsel.eskaleret': 'Eskaleret til revisor (ER-03)',
  'forespoergsel.ny_frist': 'Ny frist', 'forespoergsel.kunde_kontakter': 'Kunden kontakter instituttet', 'forespoergsel.adhoc_anmodet': 'Ad hoc-forespørgsel anmodet', 'forespoergsel.adhoc_godkendt': 'Ad hoc-forespørgsel godkendt',
  'forespoergsel.alternative_dokumenteret': 'Alternative handlinger dokumenteret', 'afvigelse.oprettet': 'Afvigelse', 'afvigelse.lukket': 'Afvigelse lukket', 'afvigelse.lukket_automatisk': 'Afvigelse lukket automatisk',
  'afvigelse.vurderet': 'Afvigelse vurderet', 'afvigelser.sendt_til_revisor': 'Afvigelser sendt til revisor', 'sag.status': 'Status ændret', 'sag.konkluderet': 'Konkluderet', 'sag.laast': 'Låst og arkiveret',
  'sag.genaabnet': 'Genåbnet', 'sag.delegeret': 'Godkendelse delegeret', 'opgave.oprettet': 'Opgave oprettet', 'opgave.lukket': 'Opgave lukket', 'opgave.annulleret': 'Opgave annulleret', 'svar.udtraek_godkendt': 'Udtræk godkendt',
  'svar.afsender_afvist': 'Svar afvist: ukendt afsender', 'svar.udtrukket': 'Svar udtrukket (AI)', 'svarlinje.rettet': 'Udtræk rettet', 'svarlinje.kontrolleret': 'Linje kontrolleret', 'sag.advarsel_p5': 'Advarsel: ikke konkluderet (ER-08)',
  'primo.tilvalgt': 'Primo-forespørgsel tilvalgt', 'primo.fravalgt': 'Primo-forespørgsel fravalgt', 'sag.migreret': 'Migreret fra Excel',
};

const statusTone = (s: string) => (s === 'AFSLUTTET' ? 'ok' : s === 'AFVIST' || s === 'RYKKET' ? 'failed' : s === 'KLAR' || s === 'SVAR_MODTAGET' ? 'ok' : s === 'KLADDE' || s === 'AFVENTER_REVISOR' || s === 'UDEN_SVAR' ? 'waiting' : 'neutral');

function nextLink(d: Detail): string {
  const n = d.nextForMe;
  if (n?.deviationId) return `/afvigelser/${n.deviationId}`;
  if (!n?.type) return '#';
  if (n.type === 'OPG-04') return `?fane=bankliste`;
  if (n.type.startsWith('OPG-05')) return '/fuldmagter';
  if (n.type === 'OPG-09' || n.type === 'OPG-10') {
    const r = d.inquiries.find((i) => i.id === n.inquiryId)?.responseId;
    return r ? `/svar/${r}` : '?fane=svar';
  }
  if (n.type === 'OPG-14') return '#konklusion';
  return '?fane=forespoergsler';
}

export default async function CasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await currentActor();
  let d: Detail;
  try {
    d = await caseDetail(prisma, actor, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === 'NOT_FOUND') notFound();
    throw e;
  }
  const tab = TABS.some((t) => t.key === sp.fane) ? sp.fane! : 'forespoergsler';
  const p = d.permissions;
  const openDeviations = d.deviations.filter((x) => x.status !== 'LUKKET');
  const critical = openDeviations.filter((x) => x.severity === 'KRITISK');
  const instituteOptions = d.institutesForAdhoc.map((i) => ({ value: i.id, label: i.name }));
  const waiting = d.inquiries.filter((i) => i.status === 'SENDT' || i.status === 'RYKKET');

  return (
    <>
      <div className="topline"><span>Sag · {d.case.statusLabel}</span><span>Kerneteam: {d.case.core}</span></div>
      <section className="card">
        <div className="case-head">
          <div>
            <h2>{d.customer.name}</h2>
            <p>CVR {d.customer.cvr} · {d.case.type} · Balancedag {fmtDate(d.case.balanceDate)} · Opgaveansvarlig: {d.case.responsible} · Planlagt påtegning {fmtDate(d.case.plannedSignOff)}</p>
          </div>
          <div className="chips">
            {d.case.isNewCustomer && <span className="chip kunde">Ny kunde (TR-03)</span>}
            {d.customer.confidential && <span className="chip">Fortrolig</span>}
            {d.case.lockedAt && <span className="chip">Låst {fmtDate(d.case.lockedAt)}</span>}
            <span className="chip" title="Sagen evalueres med det regelsæt, der gjaldt ved oprettelsen (6.8)">Regler pr. {fmtDate(d.case.rulesAsOf)}</span>
          </div>
        </div>
      </section>
      <div style={{ marginTop: 16 }}><Tracking steps={d.tracking} /></div>

      <div className="case-grid">
        <div>
          <nav className="tabs" aria-label="Sagens faneblade">
            {TABS.map((t) => (
              <Link key={t.key} href={`?fane=${t.key}`} className={tab === t.key ? 'active' : ''} aria-current={tab === t.key ? 'page' : undefined}>
                {t.label}
                {t.key === 'svar' && openDeviations.length > 0 && <small className="missing">{openDeviations.length}</small>}
                {t.key === 'opgaver' && <small>{d.tasks.filter((x) => x.type !== 'OPG-01').length}</small>}
              </Link>
            ))}
          </nav>
          <section className="card">
            {tab === 'forespoergsler' && <Inquiries d={d} />}
            {tab === 'bankliste' && <BankList d={d} />}
            {tab === 'fuldmagt' && <Authorization d={d} />}
            {tab === 'svar' && <Responses d={d} />}
            {tab === 'opgaver' && <Tasks d={d} />}
            {tab === 'historik' && <History d={d} />}
            {tab === 'dokumenter' && <Documents d={d} />}
          </section>
          {tab === 'forespoergsler' && d.notes.length > 0 && (
            <section className="card">
              <h3 style={{ marginTop: 0 }}>Sikkerhedsstillelser og garantier fra svarene</h3>
              <p>{d.notes.map((n) => `${n.description}, ${n.institute} – ${fmtKr(n.amountDkkOre)} kr.`).join(' · ')}</p>
              <small>Overføres til revisor som input til noteoplysninger (AR-08): eventualforpligtelser og sikkerhedsstillelser.</small>
            </section>
          )}
          {tab === 'forespoergsler' && (
            <section className="card">
              <h3 style={{ marginTop: 0 }}>Historik (uddrag)</h3>
              <ol className="timeline">
                {d.history.filter((h) => !h.action.startsWith('opgave.')).slice(0, 5).map((h) => (
                  <li key={h.id}><b>{ACTION_LABELS[h.action] ?? h.action}</b>{h.reason ? ` – ${h.reason}` : ''}<small className="ev-meta">{fmtDateTime(h.at)} · {h.actor}</small></li>
                ))}
              </ol>
              <Link href="?fane=historik">Se hele historikken</Link>
            </section>
          )}
        </div>

        <div className="side-panel">
          {d.nextForMe ? (
            <div className="panel next-panel">
              <p className="eyebrow">Næste handling for dig</p>
              <h3>{d.nextForMe.deviationId && critical.length ? `${d.nextForMe.title} (${critical.length} kritisk${critical.length > 1 ? 'e' : ''})` : d.nextForMe.title}</h3>
              <p>{d.nextForMe.deviationId ? d.deviations.find((x) => x.id === d.nextForMe!.deviationId)?.description : d.nextForMe.dueDate ? `Frist ${fmtDate(d.nextForMe.dueDate)}.` : d.case.nextAction}</p>
              {(d.nextForMe.type || d.nextForMe.deviationId) && <Link className="button" href={nextLink(d)}>{d.nextForMe.deviationId ? 'Åbn afvigelse' : 'Åbn'}</Link>}
            </div>
          ) : (
            <div className="panel">
              <p className="eyebrow">Hvem har bolden</p>
              <h3>{d.case.nextOwner}</h3>
              <p>{d.case.nextAction}</p>
            </div>
          )}

          <div className="panel" id="konklusion">
            <h3>Konklusion</h3>
            {d.case.lockedAt ? (
              <>
                <p>Konkluderet {fmtDate(d.case.concludedAt)} af {d.case.concludedBy}. Sagen er låst som revisionsbevis.</p>
                <details><summary>Læs konklusionen</summary><pre className="text">{d.case.conclusion}</pre></details>
                {p.reopen && <Action label="Genåbn sagen" variant="secondary" endpoint={`/api/sager/${d.case.id}/genaabn`} fields={[{ name: 'reason', label: 'Begrundelse', type: 'textarea', required: true }]} intro="Genåbning logges og kræver begrundelse (P11)." />}
              </>
            ) : (
              <>
                <p>Kan afgives, når alle svar er afstemt eller alternative handlinger er dokumenteret.</p>
                {d.conclusion.ready && p.conclude ? (
                  <Action
                    label="Konkludér og lås"
                    endpoint={`/api/sager/${d.case.id}/konkluder`}
                    title="Konkludér og dokumentér"
                    intro="Udkastet er dannet af svarene, afvigelserne og de alternative handlinger. Ret teksten, før du godkender. Sagen låses og arkiveres (P11)."
                    fields={[{ name: 'conclusion', label: 'Konklusion', type: 'textarea', initial: d.conclusion.draft ?? '', required: true }]}
                    submitLabel="Godkend konklusion"
                  />
                ) : (
                  <button disabled>Konkludér ({d.conclusion.resolved} af {d.conclusion.total} klar)</button>
                )}
              </>
            )}
          </div>

          {!d.case.lockedAt && (
            <div className="panel">
              <h3>Andre handlinger</h3>
              <div className="stack-actions">
                {p.requestAdhoc && (
                  <Action label="+ Ad hoc-forespørgsel" variant="secondary" endpoint={`/api/sager/${d.case.id}/adhoc`} title="Anmod om ad hoc-forespørgsel"
                    intro={actor.role === 'OR' ? 'Du er opgaveansvarlig, så anmodningen er godkendt med det samme (SOP-EF-09).' : 'Opgaveansvarlig revisor godkender anmodningen, før kerneteamet sender den (SOP-EF-09).'}
                    fields={[{ name: 'instituteId', label: 'Pengeinstitut', type: 'select', options: instituteOptions, required: true }, { name: 'statementDate', label: 'Opgørelsesdato', type: 'date', required: true, initial: d.case.balanceDate }, { name: 'reason', label: 'Begrundelse', type: 'textarea', required: true }]} />
                )}
                {p.decide && waiting.map((i) => (
                  <Action key={i.id} label={`Bed kunden kontakte ${i.institute}`} variant="secondary" endpoint={`/api/forespoergsler/${i.id}/beslutning`} body={{ decision: 'KUNDE_KONTAKTER' }} title="Bed kunden kontakte banken"
                    intro="Kunden får en mail fra funktionspostkassen. Svaret skal stadig komme direkte fra banken (ISA 505)."
                    fields={[{ name: 'newDeadline', label: 'Ny frist', type: 'date', help: 'Standard: 5 hverdage' }, { name: 'note', label: 'Bemærkning', type: 'text' }]} />
                ))}
                {p.delegate && d.team.length > 0 && !d.case.bankListApprovedAt && (
                  <Action label={d.case.delegate ? `Delegeret til ${d.case.delegate.name}` : 'Delegér godkendelse af bankliste'} variant="secondary" endpoint={`/api/sager/${d.case.id}/delegering`} title="Delegér godkendelse af banklisten"
                    intro="Revisionsmedarbejderen kan godkende banklisten på dine vegne. Hændelsesloggen viser, at det sker på dine vegne."
                    fields={[{ name: 'delegateId', label: 'Revisionsmedarbejder', type: 'select', options: d.team.map((u) => ({ value: u.id, label: u.name })), required: true }, { name: 'until', label: 'Gælder til og med', type: 'date' }]} />
                )}
                {d.tasks.some((t) => t.type === 'OPG-12') && p.decide && (
                  <>
                    <Action label="Tilvælg primo-forespørgsel" variant="secondary" endpoint={`/api/sager/${d.case.id}/primo`} body={{ accept: true }} />
                    <Action label="Fravælg primo-forespørgsel" variant="secondary" endpoint={`/api/sager/${d.case.id}/primo`} body={{ accept: false }} fields={[{ name: 'reason', label: 'Begrundelse', type: 'textarea', required: true }]} />
                  </>
                )}
              </div>
              <details style={{ marginTop: 14 }}>
                <summary>Se sidste års forespørgsler</summary>
                {d.lastYear ? (
                  <dl className="kv" style={{ marginTop: 10 }}>
                    <dt>Balancedag</dt><dd>{fmtDate(d.lastYear.balanceDate)}</dd>
                    <dt>Institutter</dt><dd>{d.lastYear.institutes.join(', ') || '–'}</dd>
                    <dt>Konklusion</dt><dd>{d.lastYear.conclusion}</dd>
                  </dl>
                ) : <p>Ingen tidligere sag – ny kunde.</p>}
              </details>
            </div>
          )}

          <div className="panel">
            <h3>Årshjul for sagen</h3>
            <dl className="kv">
              <dt>T−60</dt><dd>{fmtDate(d.timeline.create)} sag og fuldmagtskontrol</dd>
              <dt>T−45</dt><dd>{fmtDate(d.timeline.proposal)} forslag til bankliste</dd>
              <dt>T−30</dt><dd>{fmtDate(d.timeline.approvalDeadline)} bankliste godkendt</dd>
              <dt>T−10</dt><dd>{fmtDate(d.timeline.authDeadline)} fuldmagter klar</dd>
              <dt>T+1</dt><dd>{fmtDate(d.timeline.standardSend)} afsendelse</dd>
              <dt>P−10</dt><dd>{fmtDate(d.timeline.alternativesDeadline)} afvigelser afsluttet</dd>
              <dt>P−5</dt><dd>{fmtDate(d.timeline.conclusionDeadline)} konklusion</dd>
            </dl>
          </div>
        </div>
      </div>
    </>
  );

  function Inquiries({ d }: { d: Detail }) {
    const pop = d.population;
    return (
      <>
        <div className="section-head">
          <div><h2>Forespørgsler</h2><p>Én forespørgsel pr. institut med unik reference. Svaret går altid til funktionspostkassen.</p></div>
        </div>
        <p><small>K2 – forventet population: {pop.expected} institutter på banklisten · {pop.actual} forespørgsler · {pop.sent} sendt{pop.missing.length ? ` · ${pop.missing.length} mangler` : ''}{pop.duplicates.length ? ` · ${pop.duplicates.length} dobbelte` : ''}</small></p>
        {d.inquiries.length === 0 ? <Empty>Forespørgslerne dannes, når banklisten er godkendt (P06). <Link href="?fane=bankliste">Gå til banklisten</Link>.</Empty> : (
          <div className="table-wrap">
            <table className="stack dense">
              <thead><tr><th>Pengeinstitut</th><th>Kilde</th><th>Fuldmagt</th><th>Status</th><th>Frist</th><th>Afstemning</th></tr></thead>
              <tbody>
                {d.inquiries.map((i) => (
                  <InquiryRow key={i.id} i={i} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  function InquiryRow({ i }: { i: Detail['inquiries'][number] }) {
    const km = p.kerneteam;
    const overdue = !!i.responseDeadline && i.responseDeadline < d.today;
    return (
      <>
        <tr>
          <td data-label="Pengeinstitut"><strong>{i.institute}</strong><span className="ref">{i.reference} · {i.channel}{i.type !== 'AARLIG' ? ` · ${i.type === 'PRIMO' ? 'Primo' : 'Ad hoc'}` : ''}</span></td>
          <td data-label="Kilde">{i.source}</td>
          <td data-label="Fuldmagt">{i.fuldmagt}</td>
          <td data-label="Status"><Tag tone={statusTone(i.status)}>{i.status === 'RYKKET' ? `Rykket (${i.reminderCount}.)` : i.statusLabel}</Tag>{i.escalatedAt && <span className="ref missing">Eskaleret {fmtDate(i.escalatedAt)}</span>}</td>
          <td data-label="Svar / frist">
            {i.status === 'KLADDE' || i.status === 'KLAR' ? <>Planlagt {fmtDate(i.plannedSendDate)}</> : i.responseDeadline ? <><Deadline date={i.responseDeadline} tone={overdue && (i.status === 'SENDT' || i.status === 'RYKKET') ? 'overdue' : null} />{i.expectedResponseDate && i.expectedResponseDate !== i.responseDeadline && <span className="ref">Forventet {fmtDate(i.expectedResponseDate)} (K1)</span>}</> : '–'}
          </td>
          <td data-label="Afstemning">{i.responseId && (i.status === 'SVAR_MODTAGET' || i.status === 'AFVENTER_REVISOR' || i.status === 'AFSLUTTET') ? <Link href={`/svar/${i.responseId}`} className={i.reconTone === 'failed' ? 'missing' : ''}>{i.recon}</Link> : <span className={i.reconTone === 'failed' ? 'missing' : ''}>{i.recon}</span>}</td>
        </tr>
        {(i.blockers.length > 0 || i.warnings.length > 0 || i.rejection || i.adhocReason || i.alternativeActions || i.cancelReason || hasActions(i)) && (
          <tr className="detail">
            <td colSpan={6}>
              {i.blockers.length > 0 && <div className="notice"><strong>Kan ikke sendes endnu.</strong><ul>{i.blockers.map((b) => <li key={b}>{b}</li>)}</ul></div>}
              {i.warnings.length > 0 && <div className="notice"><ul>{i.warnings.map((b) => <li key={b}>{b}</li>)}</ul></div>}
              {i.rejection && i.status === 'AFVIST' && <div className="error"><strong>Afvist: {i.rejection}.</strong> Ret og genfremsend inden 2 hverdage (ER-04).</div>}
              {i.adhocReason && <p><small>{i.type === 'PRIMO' ? 'Primo' : 'Ad hoc'}: {i.adhocReason}{i.requestedBy ? ` · anmodet af ${i.requestedBy}` : ''}{i.approvedBy ? ` · godkendt af ${i.approvedBy}` : ' · afventer godkendelse'}</small></p>}
              {i.alternativeActions && <p><small>Alternative handlinger: {i.alternativeActions}</small></p>}
              {i.cancelReason && <p><small>Annulleret: {i.cancelReason}</small></p>}
              <div className="inline-actions">
                {km && i.status === 'KLAR' && i.blockers.length === 0 && <Action label="Send nu" variant="small" endpoint="/api/afsendelser/batch" body={{ inquiryIds: [i.id] }} idempotent />}
                {km && (i.status === 'SENDT' || i.status === 'RYKKET') && overdue && i.reminderCount < 2 && <Action label={`Send ${i.reminderCount + 1}. rykker`} variant="small" endpoint={`/api/forespoergsler/${i.id}/rykker`} />}
                {km && (i.status === 'SENDT' || i.status === 'RYKKET') && (
                  <Action label="Registrér afvisning" variant="small-secondary" endpoint={`/api/forespoergsler/${i.id}/afvisning`} title="Registrér afvisning fra instituttet" fields={[{ name: 'reason', label: 'Årsag', type: 'select', required: true, options: Object.entries(REJECTION_REASON_LABELS).map(([value, label]) => ({ value, label })) }, { name: 'note', label: 'Bemærkning', type: 'textarea' }]} />
                )}
                {km && i.status === 'AFVIST' && (
                  <Action label="Ret og genfremsend" variant="small" endpoint={`/api/forespoergsler/${i.id}/genfremsend`} idempotent title="Ret og genfremsend" intro="Kontrollerne (VR-01–VR-09) køres igen. Frist og rykkere nulstilles."
                    fields={[{ name: 'note', label: 'Hvad er rettet?', type: 'textarea', required: true }, ...(i.rejection?.includes('dato') ? [{ name: 'statementDate', label: 'Opgørelsesdato', type: 'date' as const, initial: i.statementDate }] : [])]} />
                )}
                {p.decide && (i.status === 'SENDT' || i.status === 'RYKKET') && (i.escalatedAt || overdue) && (
                  <Action label="Beslut næste skridt" variant="small" endpoint={`/api/forespoergsler/${i.id}/beslutning`} title={`Manglende svar fra ${i.institute}`} intro="ER-03: Kunden kontakter instituttet, ny frist – eller alternative handlinger (ISA 505.12)."
                    fields={[{ name: 'decision', label: 'Beslutning', type: 'select', required: true, options: [{ value: 'KUNDE_KONTAKTER', label: 'Bed kunden kontakte banken' }, { value: 'NY_FRIST', label: 'Giv ny frist' }, { value: 'ALTERNATIVE', label: 'Alternative handlinger' }] }, { name: 'newDeadline', label: 'Ny frist', type: 'date', help: 'Standard: 5 hverdage' }, { name: 'note', label: 'Bemærkning', type: 'textarea' }]} />
                )}
                {p.documentAlternatives && i.status === 'UDEN_SVAR' && (
                  <Action label={i.alternativeActions ? 'Ret alternative handlinger' : 'Dokumentér alternative handlinger'} variant="small" endpoint={`/api/forespoergsler/${i.id}/alternative`} fields={[{ name: 'text', label: 'Udførte handlinger og konklusion', type: 'textarea', required: true, initial: i.alternativeActions ?? '' }]} />
                )}
                {p.decide && i.status === 'UDEN_SVAR' && i.alternativeActions && <Action label="Godkend alternative handlinger" variant="small" endpoint={`/api/forespoergsler/${i.id}/alternative/godkend`} />}
                {p.approveAdhoc && i.type !== 'AARLIG' && !i.approvedBy && i.status === 'KLADDE' && <Action label="Godkend ad hoc" variant="small" endpoint={`/api/forespoergsler/${i.id}/adhoc/godkend`} />}
                {p.demo && i.sentAt && (i.status === 'SENDT' || i.status === 'RYKKET' || i.status === 'UDEN_SVAR') && (
                  <Action label="Demo: simulér svar" variant="small-secondary" endpoint={`/api/forespoergsler/${i.id}/simuler-svar`} title="Simulér svar fra pengeinstituttet" intro="Svaret lægges i funktionspostkassen eller på platformen og gennemgår match, afsenderkontrol og udtræk."
                    fields={[{ name: 'variant', label: 'Svar', type: 'select', required: true, initial: 'NORMAL', options: d.replyVariants.map((v) => ({ value: v.key, label: v.label })) }]} />
                )}
                {(km || p.decide) && ['KLADDE', 'KLAR', 'SENDT', 'RYKKET', 'AFVIST'].includes(i.status) && (
                  <Action label="Annullér" variant="small-secondary" endpoint={`/api/forespoergsler/${i.id}/annuller`} fields={[{ name: 'reason', label: 'Begrundelse', type: 'textarea', required: true }]} />
                )}
              </div>
            </td>
          </tr>
        )}
      </>
    );
  }

  function hasActions(i: Detail['inquiries'][number]) {
    return (p.kerneteam || p.decide || p.documentAlternatives) && !['AFSLUTTET', 'ANNULLERET', 'SVAR_MODTAGET', 'AFVENTER_REVISOR'].includes(i.status);
  }

  function BankList({ d }: { d: Detail }) {
    const approvalPending = d.bankList.some((l) => l.pendingApproval);
    return (
      <>
        <div className="section-head">
          <div><h2>Bankliste</h2><p>Forslaget er dannet af sidste års svar og bogføringen (SAF-T) – ikke af et Excel-ark. Fravalg kræver en begrundelse.</p></div>
        </div>
        {d.case.bankListApprovedAt ? (
          <div className="notice ok-notice"><strong>Godkendt</strong> {fmtDateTime(d.case.bankListApprovedAt)} af {d.case.bankListApprovedBy}.{approvalPending && ' Et institut er tilføjet efter godkendelsen og skal godkendes (TR-06).'}</div>
        ) : (
          <p><small>Godkendelsesfrist {fmtDate(d.timeline.approvalDeadline)} (T−30). {d.case.delegate ? `Delegeret til ${d.case.delegate.name}${d.case.delegate.until ? ` til ${fmtDate(d.case.delegate.until)}` : ''}.` : ''}</small></p>
        )}
        {d.bankListWarnings.length > 0 && <div className="notice"><strong>Banklisten kan være ufuldstændig.</strong><ul>{d.bankListWarnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
        {d.bankList.length === 0 ? <Empty>Ingen institutter endnu. Kunden bekræfter sine pengeinstitutter via kundeformularen (OPG-03).</Empty> : (
          <div className="table-wrap">
            <table className="stack dense">
              <thead><tr><th>Institut</th><th>Kilde</th><th>Kanal</th><th>Med</th><th>Forespørgsel</th><th></th></tr></thead>
              <tbody>
                {d.bankList.map((l) => (
                  <tr key={l.id} className={l.included ? '' : 'deselected'}>
                    <td data-label="Institut"><strong>{l.institute}</strong>{l.authRequirement === 'BANKSPECIFIK' && <span className="ref">Kræver bankspecifik fuldmagt</span>}</td>
                    <td data-label="Kilde"><span className="chips">{l.sources.map((s) => <span key={s.key} className={`chip ${s.key === 'AGENT' ? 'agent' : s.key === 'KUNDE' ? 'kunde' : ''}`}>{s.label}</span>)}{l.customerConfirmed && <span className="chip kunde">Bekræftet af kunden</span>}</span></td>
                    <td data-label="Kanal">{l.channel}</td>
                    <td data-label="Med" className="keep">{l.included ? (l.pendingApproval ? <Tag tone="waiting">Afventer godkendelse</Tag> : 'Ja') : <span>Fravalgt<span className="ref">{l.deselectReason}</span></span>}</td>
                    <td data-label="Forespørgsel">{l.inquiryStatus ?? '–'}</td>
                    <td className="keep">
                      {p.editBankList && (!d.case.bankListApprovedAt || l.addedAfterApproval) && (l.included
                        ? <Action label="Fravælg" variant="small-secondary" endpoint={`/api/banklistelinjer/${l.id}`} method="PATCH" body={{ included: false }} fields={[{ name: 'reason', label: 'Begrundelse (VR-08)', type: 'textarea', required: true, help: 'Fx "Engagement ophørt 03.2026 – bekræftet af kunden".' }]} />
                        : <Action label="Tag med" variant="small-secondary" endpoint={`/api/banklistelinjer/${l.id}`} method="PATCH" body={{ included: true }} />)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="actions">
          {(p.editBankList || p.proposeBankList) && (
            <Action label={p.proposeBankList ? 'Foreslå institut' : 'Tilføj institut'} variant="secondary" endpoint={`/api/sager/${d.case.id}/bankliste`} title="Tilføj institut fra bankregisteret"
              intro={d.case.bankListApprovedAt ? 'Banklisten er godkendt. Et nyt institut kræver ny godkendelse og bliver en ad hoc-forespørgsel (TR-06).' : p.proposeBankList ? 'Agentens forslag er en kladde, som en bruger skal tage med (10.5).' : undefined}
              fields={[{ name: 'instituteId', label: 'Institut', type: 'select', required: true, options: instituteOptions }, { name: 'note', label: 'Hvor er instituttet fundet?', type: 'text' }]} />
          )}
          {p.kerneteam && !d.case.bankListApprovedAt && (
            <Action label="Registrér kundens bekræftelse" variant="secondary" endpoint={`/api/sager/${d.case.id}/bankliste/kunde`} title="Kundens bekræftelse af pengeinstitutter"
              intro="Kunden bekræfter via kundeformularen (forudfyldt liste) i stedet for et Excel-ark på mail. Registrér svaret her."
              fields={[{ name: 'instituteIds', label: 'Institutter, kunden har bekræftet', type: 'checkboxes', options: instituteOptions }, { name: 'note', label: 'Bemærkning', type: 'text' }]} />
          )}
          <span className="spacer" />
          {p.approveBankList && (!d.case.bankListApprovedAt || approvalPending) && (
            <Action label={approvalPending ? 'Godkend tilføjet institut' : 'Godkend bankliste'} endpoint={`/api/sager/${d.case.id}/bankliste/godkend`} acknowledgeKey="acknowledgeWarnings" />
          )}
        </div>
      </>
    );
  }

  function Authorization({ d }: { d: Detail }) {
    return (
      <>
        <div className="section-head">
          <div><h2>Fuldmagt</h2><p>Kontrolleres automatisk mod CVR (FR-01–FR-07). Indhentes via Penneo med MitID – ikke i Word og på mail.</p></div>
          {(p.kerneteam || actor.role === 'OR') && <Link className="button secondary" href="/fuldmagter">Håndtér i Fuldmagter</Link>}
        </div>
        <div className="stats three">
          <div className="stat"><span>Fuldmagtskontrol</span><strong>{d.auth.label}</strong></div>
          <div className="stat"><span>Regel</span><strong>{d.auth.ruleId ?? '–'}</strong></div>
          <div className="stat"><span>Frist (T−10)</span><strong>{fmtDate(d.timeline.authDeadline)}</strong></div>
        </div>
        <p>{d.auth.reason}</p>
        {d.auth.specific.map((s) => <div key={s.institute} className={s.result === 'GYLDIG' ? 'notice ok-notice' : 'notice'}><strong>{s.institute}:</strong> {s.label} – {s.reason}</div>)}
        <div className="two-col">
          <div>
            <h3>Tegningsregel (CVR)</h3>
            <p>{d.customer.signingRule}</p>
          </div>
          <div>
            <h3>Ledelse i dag</h3>
            <ul className="signer-list">{d.management.map((m) => <li key={m.unitNumber}><span className="who"><strong>{m.name}</strong><small>{m.roleLabel}</small></span></li>)}</ul>
          </div>
        </div>
        <h3>Fuldmagter</h3>
        {d.fuldmagter.length === 0 ? <Empty>Ingen fuldmagter for kunden.</Empty> : (
          <div className="table-wrap">
            <table className="stack dense">
              <thead><tr><th>Status</th><th>Omfang</th><th>Underskrevet</th><th>Underskrivere</th><th>Fuldmagtshaver</th><th>Dokument</th></tr></thead>
              <tbody>
                {d.fuldmagter.map((f) => (
                  <tr key={f.id}>
                    <td data-label="Status"><Tag tone={f.status === 'GYLDIG' ? 'ok' : f.status === 'UGYLDIG' || f.status === 'SKAL_FORNYES' || f.status === 'TILBAGEKALDT' ? 'failed' : f.status === 'INAKTIV' ? 'neutral' : 'waiting'}>{f.statusLabel}</Tag>{f.invalidReason && <span className="ref">{f.invalidReason}</span>}</td>
                    <td data-label="Omfang">{f.scope === 'GENEREL' ? 'Generel' : `Bankspecifik · ${f.institute}`}</td>
                    <td data-label="Underskrevet">{fmtDate(f.signedDate)}<span className="ref">{f.source === 'PENNEO' ? 'Penneo (MitID)' : 'Manuel – 4-øjne'}</span></td>
                    <td data-label="Underskrivere">{f.signers.map((x) => x.name).join(', ') || '–'}</td>
                    <td data-label="Fuldmagtshaver">{f.holderName}<span className="ref">CVR {f.holderCvr}</span></td>
                    <td data-label="Dokument">{f.documentRef ? <span className="ref">{f.documentRef.split('/').pop()}</span> : f.penneoCaseId ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  function Responses({ d }: { d: Detail }) {
    return (
      <>
        <h2>Svar og afstemning</h2>
        <p>Svar læses fra funktionspostkassen og matches på reference. Afstemningen mod bogføringen sker i appen – ikke i et regneark.</p>
        {d.responses.length === 0 ? <Empty>Der er ikke modtaget svar endnu.</Empty> : (
          <div className="table-wrap">
            <table className="stack dense">
              <thead><tr><th>Modtaget</th><th>Institut</th><th>Afsender</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {d.responses.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Modtaget">{fmtDateTime(r.receivedAt)}</td>
                    <td data-label="Institut">{r.institute}</td>
                    <td data-label="Afsender">{r.sender}{!r.senderVerified && <span className="ref missing">Ikke verificeret (AR-02)</span>}</td>
                    <td data-label="Status">{r.invalidReason ? <Tag tone="failed">Afvist</Tag> : r.approved ? <Tag tone="ok">Udtræk godkendt</Tag> : <Tag tone="waiting">Til verifikation</Tag>}{r.invalidReason && <span className="ref">{r.invalidReason}</span>}</td>
                    <td><Link href={`/svar/${r.id}`}>Åbn</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <h3>Afvigelser</h3>
        {d.deviations.length === 0 ? <Empty>Ingen afvigelser.</Empty> : (
          <ul className="signer-list">
            {d.deviations.map((x) => (
              <li key={x.id}>
                <span className="who"><strong><Link href={`/afvigelser/${x.id}`}>{x.type}</Link></strong><small>{x.description}</small>{x.decision && <small>Beslutning: {x.decision} – {x.justification}</small>}</span>
                <Tag tone={x.status === 'LUKKET' ? 'ok' : x.severity === 'KRITISK' ? 'failed' : 'waiting'}>{x.severityLabel} · {x.status === 'LUKKET' ? 'Lukket' : x.status === 'UNDER_VURDERING' ? 'Under vurdering' : 'Åben'}</Tag>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  function Tasks({ d }: { d: Detail }) {
    return (
      <>
        <h2>Opgaver</h2>
        <p>Reglerne opretter kun de opgaver, der skal løses. Hver opgave har én ansvarlig og en frist (K3).</p>
        {d.tasks.length === 0 ? <Empty>Ingen åbne opgaver.</Empty> : (
          <div className="table-wrap">
            <table className="stack dense">
              <thead><tr><th>Opgave</th><th>Ansvarlig</th><th>Frist</th><th>Oprettet af regel</th></tr></thead>
              <tbody>
                {d.tasks.map((t) => (
                  <tr key={t.id}>
                    <td data-label="Opgave">{t.mine ? <strong>{t.title}</strong> : t.title}<span className="ref">{t.type}</span></td>
                    <td data-label="Ansvarlig">{t.assignee}</td>
                    <td data-label="Frist"><Deadline date={t.dueDate} tone={t.deadlineTone} /></td>
                    <td data-label="Regel">{t.createdByRule ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  }

  function History({ d }: { d: Detail }) {
    return (
      <>
        <h2>Historik</h2>
        <p>Hændelsesloggen er uforanderlig (K6). Sagens fulde forløb kan genskabes herfra – også hvem der handlede på hvis vegne.</p>
        <ol className="timeline">
          {d.history.map((h) => (
            <li key={h.id}>
              <b>{ACTION_LABELS[h.action] ?? h.action}</b>{h.reason ? ` – ${h.reason}` : ''}
              <small className="ev-meta">{fmtDateTime(h.at)} · {h.actor}{h.onBehalfOf ? ` på vegne af ${h.onBehalfOf}` : ''} · {h.source === 'SYSTEM' ? 'System' : h.source === 'AGENT' ? 'Agent' : 'Bruger'} · {h.objectType}</small>
            </li>
          ))}
        </ol>
      </>
    );
  }

  function Documents({ d }: { d: Detail }) {
    return (
      <>
        <h2>Dokumenter</h2>
        <p>Arkiveret automatisk i SharePoint: forespørgsler, svar, fuldmagter og konklusion.</p>
        {d.documents.length === 0 ? <Empty>Ingen dokumenter endnu.</Empty> : (
          <ul className="signer-list">
            {d.documents.map((x) => <li key={x.id}><span className="who"><strong>{x.title}</strong><small>{x.ref}</small></span><span className="chip">{x.kind}</span></li>)}
          </ul>
        )}
      </>
    );
  }
}
