import { registerOverview } from '@/services';
import { Action, type FieldDef } from '../_components/Action';
import { Tag } from '../_components/bits';
import { fmtDate, fmtDateTime } from '../_lib/format';
import { currentActor, prisma } from '../_lib/server';

export const dynamic = 'force-dynamic';

const offset = (n: number | null) => (n === null ? '–' : n < 0 ? `T${n}` : `T+${n}`);

/** S09 Bankregister – eneste kilde til institutdata (K4). Erstatter banklister i Excel og Access. */
export default async function RegisterPage() {
  const actor = await currentActor();
  const d = await registerOverview(prisma, actor);
  const pending = d.changes.filter((c) => c.status === 'PENDING');
  const channelOptions = d.channels.map((c) => ({ value: c.key, label: c.label }));
  const editFields = (i: (typeof d.institutes)[number]): FieldDef[] => [
    { name: 'channel', label: 'Kanal (4-øjne)', type: 'select', initial: i.channel, options: channelOptions },
    { name: 'channelAddress', label: 'Kanaladresse (4-øjne)', type: 'text', initial: i.channelAddress, wide: true },
    { name: 'senderDomains', label: 'Afsenderdomæner til AR-02 (4-øjne)', type: 'list', initial: i.senderDomains.join(', '), help: 'Kommasepareret', wide: true },
    { name: 'authRequirement', label: 'Fuldmagtskrav', type: 'select', initial: i.authRequirement, options: [{ value: 'GENEREL', label: 'Generel fuldmagt' }, { value: 'BANKSPECIFIK', label: 'Bankspecifik fuldmagt' }] },
    { name: 'authMaxAgeMonths', label: 'Maks. alder på fuldmagt (mdr.)', type: 'number', initial: i.authMaxAgeMonths?.toString() ?? '' },
    { name: 'responseWorkdays', label: 'Svartid (hverdage)', type: 'number', initial: String(i.responseWorkdays) },
    { name: 'seasonDeadline', label: 'Sæsonfrist ved 31.12 (MM-DD)', type: 'text', initial: i.seasonDeadline ?? '' },
    { name: 'earliestSendOffset', label: 'Tidligst afsendelse (dage fra T)', type: 'number', initial: String(i.earliestSendOffset), help: 'Negativ = forudbestilling' },
    { name: 'latestSendOffset', label: 'Senest afsendelse (dage fra T)', type: 'number', initial: i.latestSendOffset?.toString() ?? '' },
    { name: 'fee', label: 'Gebyr', type: 'text', initial: i.fee ?? '' },
    { name: 'bulkFileRule', label: 'Krav til bulkfil', type: 'textarea', initial: i.bulkFileRule ?? '' },
  ];
  return (
    <>
      <div className="topline"><span>Bankregister</span><span>{d.institutes.length} institutter · {pending.length} ændringer afventer godkendelse</span></div>
      <section className="card">
        <div className="section-head">
          <div>
            <h2>Bankregister</h2>
            <p>Ét register med kanal, adresse, fuldmagtskrav, SLA og skabelon pr. institut – i stedet for banklister i Excel og Access. Alle ændringer er versionerede og logget. Kanal, adresse og afsenderdomæner kræver godkendelse af en anden person.</p>
          </div>
          {d.permissions.edit && (
            <Action label="Opret institut" variant="secondary" endpoint="/api/bankregister" title="Opret institut"
              fields={[{ name: 'name', label: 'Navn', type: 'text', required: true }, { name: 'cvr', label: 'CVR', type: 'text', required: true }, { name: 'channel', label: 'Kanal', type: 'select', required: true, options: channelOptions }, { name: 'channelAddress', label: 'Kanaladresse', type: 'text', required: true }, { name: 'senderDomains', label: 'Afsenderdomæner', type: 'list' }, { name: 'responseWorkdays', label: 'Svartid (hverdage)', type: 'number', required: true, initial: '10' }, { name: 'source', label: 'Kilde', type: 'text', initial: 'Oprettet manuelt' }]} />
          )}
        </div>
        {pending.length > 0 && (
          <div className="notice">
            <strong>Ændringer, der afventer 4-øjne</strong>
            <ul className="signer-list" style={{ marginTop: 10 }}>
              {pending.map((c) => (
                <li key={c.id}>
                  <span className="who"><strong>{c.institute}: {c.field}</strong><small>{c.oldValue || '–'} → {c.newValue}</small><small>Anmodet af {c.requestedBy} {fmtDateTime(c.requestedAt)}</small></span>
                  {d.permissions.approve && !c.mine ? (
                    <span className="inline-actions">
                      <Action label="Godkend" variant="small" endpoint={`/api/bankregister/aendringer/${c.id}`} body={{ approve: true }} />
                      <Action label="Afvis" variant="small-secondary" endpoint={`/api/bankregister/aendringer/${c.id}`} body={{ approve: false }} />
                    </span>
                  ) : <Tag tone="waiting">{c.mine ? 'Afventer en anden' : 'Afventer kerneteamleder'}</Tag>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="table-wrap">
          <table className="stack dense">
            <thead><tr><th>Institut</th><th>Kanal og adresse</th><th>Fuldmagt</th><th>Svartid og frister</th><th>SLA-historik (K4)</th><th>Kilde og verifikation</th><th></th></tr></thead>
            <tbody>
              {d.institutes.map((i) => (
                <tr key={i.id} className={i.active ? '' : 'deselected'}>
                  <td data-label="Institut"><strong>{i.name}</strong><span className="ref">CVR {i.cvr} · v{i.version}{i.counterpartyType === 'UDENLANDSK' ? ' · udenlandsk' : ''}</span>{i.mergedInto && <span className="ref missing">Fusioneret ind i {i.mergedInto}</span>}</td>
                  <td data-label="Kanal">{i.channelLabel}<span className="ref">{i.channelAddress}</span><span className="ref">Afsender: {i.senderDomains.join(', ') || '–'}</span>{i.bulkFileRule && <span className="ref">{i.bulkFileRule}</span>}</td>
                  <td data-label="Fuldmagt">{i.authRequirement === 'BANKSPECIFIK' ? 'Bankspecifik' : 'Generel'}{i.authMaxAgeMonths ? <span className="ref">Maks. {i.authMaxAgeMonths} mdr. (FR-06)</span> : null}</td>
                  <td data-label="Svartid">{i.responseWorkdays} hverdage{i.seasonDeadline && <span className="ref">Sæsonfrist {i.seasonDeadline.split('-').reverse().join('.')}</span>}<span className="ref">Afsendelse {offset(i.earliestSendOffset)}{i.latestSendOffset !== null ? ` til ${offset(i.latestSendOffset)}` : ''}</span>{i.fee && <span className="ref">Gebyr: {i.fee}</span>}</td>
                  <td data-label="SLA">{i.slaSampleSize ? <>{i.slaDeviationWorkdays > 0 ? `+${String(i.slaDeviationWorkdays).replace('.', ',')}` : String(i.slaDeviationWorkdays).replace('.', ',')} hverdage<span className="ref">n = {i.slaSampleSize} svar</span></> : <span className="muted">Ingen svar endnu</span>}<span className="ref">{i.openInquiries} åbne forespørgsler</span></td>
                  <td data-label="Kilde"><span className="ref" style={{ marginTop: 0 }}>{i.source}</span>{i.verifiedAt ? <span className="ref">Verificeret {fmtDate(i.verifiedAt)} af {i.verifiedBy}</span> : <Tag tone="waiting">Skal verificeres</Tag>}{i.pending > 0 && <span className="ref missing">{i.pending} ændring(er) afventer</span>}</td>
                  <td>
                    <div className="inline-actions">
                      {d.permissions.edit && <Action label="Ret" variant="small-secondary" endpoint={`/api/bankregister/${i.id}`} method="PATCH" title={`Ret ${i.name}`} intro="Felter markeret 4-øjne gemmes som en ændring, en anden person skal godkende. Øvrige felter gemmes med det samme som ny version." fields={editFields(i)} />}
                      {d.permissions.edit && !i.verifiedAt && <Action label="Verificér" variant="small-secondary" endpoint={`/api/bankregister/${i.id}/verificer`} />}
                      {d.permissions.approve && i.active && <Action label="Fusionér" variant="small-secondary" endpoint={`/api/bankregister/${i.id}/fusion`} title={`Fusionér ${i.name}`} intro="Instituttet bliver inaktivt. Nye banklister bruger det overtagende institut, og åbne kladder får en blokering (VR-05)." fields={[{ name: 'intoId', label: 'Overtaget af', type: 'select', required: true, options: d.institutes.filter((x) => x.id !== i.id && x.active).map((x) => ({ value: x.id, label: x.name })) }]} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="notice">Startdata fra bilag C er hentet fra institutternes offentlige sider 5.10.2026 og skal verificeres, før de bruges (SOP-EF-10). SLA-historikken opdateres automatisk af den daglige kørsel og bruges til forventet modtagelse (K1).</div>
      </section>
      {d.changes.filter((c) => c.status !== 'PENDING').length > 0 && (
        <section className="card">
          <h3 style={{ marginTop: 0 }}>Behandlede ændringer</h3>
          <ol className="timeline">
            {d.changes.filter((c) => c.status !== 'PENDING').map((c) => <li key={c.id}><b>{c.institute}: {c.field}</b> {c.oldValue} → {c.newValue} · {c.status === 'APPROVED' ? 'godkendt' : 'afvist'} af {c.decidedBy}<small className="ev-meta">{fmtDateTime(c.decidedAt)} · anmodet af {c.requestedBy}</small></li>)}
          </ol>
        </section>
      )}
    </>
  );
}
