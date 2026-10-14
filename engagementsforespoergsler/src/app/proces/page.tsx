import Link from 'next/link';
import { ProcessDiagram } from './ProcessDiagram';

export const dynamic = 'force-dynamic';

/** Det gamle værktøj → den nye funktion (løsningsdesign 12.2) med link til skærmen, hvor den bruges. */
const MODERNISATION = [
  { old: 'Banklister og bankoplysninger i Excel og Access', now: 'Bankregister med kanal, adresse, fuldmagtskrav og SLA pr. institut – versioneret, og kanalændringer kræver 4-øjne. Banklisten foreslås automatisk fra sidste års svar og SAF-T; nye kunder bekræfter via en forudfyldt kundeformular.', where: [{ href: '/bankregister', label: 'Bankregister' }, { href: '/sager', label: 'Sag → Bankliste' }], ref: '12.2 #1 · K4' },
  { old: 'RPA/VBA-script, der danner og sender bankmails fra Outlook', now: 'Udsendelsesservice: batch pr. institut og kanal, idempotent afsendelse fra funktionspostkassen via Microsoft Graph, reference i emne og header, kvittering pr. forespørgsel i sagen.', where: [{ href: '/koe', label: 'Arbejdskø' }], ref: '12.2 #2 · P07' },
  { old: 'Excel-skabeloner udfyldt manuelt til bulk-kanaler', now: 'Kanaladaptere på samme kontrakt: webformular, bulkfil dannet automatisk efter instituttets regel (fx "CVR no [nummer]" i Massebesvarelse.zip) og digital platform.', where: [{ href: '/bankregister', label: 'Bankregister → kanal' }], ref: '12.2 #6' },
  { old: 'Svar i personlige indbakker og manuel registrering', now: 'Svarmodtagelse fra funktionspostkassen: match på reference (AR-01), afsenderkontrol mod instituttets domæne (AR-02), datokontrol (AR-03), arkivering i SharePoint og en kø for uidentificerede svar.', where: [{ href: '/svar/uidentificerede', label: 'Uidentificerede svar' }], ref: '12.2 #3 · P09' },
  { old: 'Fuldmagter i Word sendt på mail og tjekket i hånden', now: 'Fuldmagtsservice: skabelon (bilag A), Penneo-signering med MitID, automatisk kontrol af underskrivere mod tegningsreglen i CVR (FR-02), påmindelser og 4-øjne ved papirfuldmagter.', where: [{ href: '/fuldmagter', label: 'Fuldmagter' }], ref: '12.2 #4 · P04–P05' },
  { old: 'Afstemning af svar i Excel', now: 'Afstemning i appen: AI-udtræk med sikkerhed pr. linje (AR-11), valutaomregning (AR-10), automatisk match mod bogført saldo, afvigelser med klassifikation, begrundelse og beslutning – alle tal ét klik fra kilden.', where: [{ href: '/koe?bucket=VERIFIKATION&view=ALLE', label: 'Svar og afstemning' }], ref: '12.2 #5 · S06–S07' },
  { old: 'Frister og rykkere, som nogen skal huske', now: 'Regler som data (TR, VR, AR, ER, FR) med versioner, og en daglig kørsel, der opretter opgaver, rykkere, eskaleringer og notifikationer – med én ansvarlig og en frist pr. opgave.', where: [{ href: '/regler', label: 'Regler' }], ref: 'Kap. 6 · K3 · K5' },
  { old: 'Status og KPI samlet manuelt i regneark og mails', now: 'Pakkesporing pr. sag, live KPI pr. periode, afdeling og institut, kapacitetsprognose for peak og eksport af hændelsesloggen (CSV og OCEL 2.0) til procesanalyse.', where: [{ href: '/rapporter', label: 'Rapporter' }, { href: '/aarshjul', label: 'Årshjul' }], ref: 'K6 · K7 · S08 · S11' },
];

const STEPS = [
  ['P01', 'Opret sag', 'Automatisk ved T−60 for opgaver med forespørgselspligt.', 'TR-01, TR-02'],
  ['P02', 'Foreslå bankliste', 'Fra sidste års svar og SAF-T; nye kunder bekræfter selv.', 'TR-03, TR-05, VR-08'],
  ['P03', 'Godkend bankliste', 'Opgaveansvarlig revisor (eller delegeret) godkender.', 'VR-03, ER-06'],
  ['P04', 'Kontrollér fuldmagt', 'FR-01–FR-07 mod CVR.', 'TR-04, FR'],
  ['P05', 'Indhent og verificér fuldmagt', 'Penneo med MitID; underskrivere mod tegningsreglen.', 'FR-02, ER-05'],
  ['P06', 'Generér forespørgsler', 'Én pr. institut med unik reference og funktionspostkassen som svarmodtager.', 'VR-01–VR-09'],
  ['P07', 'Afsend', 'Batch pr. institut og kanal.', 'TR-10, ER-01'],
  ['P08', 'Overvåg frist og ryk', 'Rykkere +3/+8, afvisninger inden 2 hverdage, eskalering +13 eller P−15.', 'ER-02–ER-04'],
  ['P09', 'Modtag og registrér svar', 'Match, afsender, dato, arkiv – og afstemning mod bogføringen.', 'AR-01–AR-11'],
  ['P10', 'Evaluér og forbedr', 'KPI og hændelseslog som grundlag.', '–'],
  ['P11', 'Arkivér og opdatér grundlag', 'Sagen låses; bankliste og fuldmagtsstatus fremskrives.', '–'],
];

export default function ProcessPage() {
  return (
    <>
      <div className="topline"><span>Proces og modernisering</span><span>Løsningsdesign v0.95</span></div>
      <section className="card">
        <h2>Fra regneark og scripts til én webapplikation</h2>
        <p>De gamle værktøjer er erstattet af funktioner i EF-service. Hver funktion skriver til den samme hændelseslog, så hele forløbet kan genskabes.</p>
        <div className="table-wrap">
          <table className="stack dense">
            <thead><tr><th>I dag</th><th>I EF-service</th><th>Hvor</th><th>Design</th></tr></thead>
            <tbody>
              {MODERNISATION.map((m) => (
                <tr key={m.old}>
                  <td data-label="I dag"><strong>{m.old}</strong></td>
                  <td data-label="I EF-service">{m.now}</td>
                  <td data-label="Hvor">{m.where.map((w) => <Link key={w.href} href={w.href} style={{ display: 'block' }}>{w.label}</Link>)}</td>
                  <td data-label="Design">{m.ref}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <h2>Forespørgslens forløb</h2>
        <p>Statusmodellen (figur 4) tegnet ud fra trin og ruter. Grå flade = EF-service, stiplet = integration, hvid = en person. Klik på et trin for at finde det i tabellen.</p>
        <ProcessDiagram />
      </section>
      <section className="card">
        <h2>Procestrin P01–P11</h2>
        <div className="table-wrap">
          <table className="stack dense">
            <thead><tr><th>Trin</th><th>Hvad sker der</th><th>Regler</th></tr></thead>
            <tbody>{STEPS.map(([id, title, text, rules]) => <tr key={id}><td data-label="Trin"><strong>{id}</strong> {title}</td><td data-label="Hvad">{text}</td><td data-label="Regler">{rules}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}
