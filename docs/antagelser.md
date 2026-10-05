# Antagelser og defaults

Briefet (v1.0, 5. oktober 2026) er styrende. Hvor briefet er åbent eller tvetydigt, har vi valgt følgende defaults. Alle er konfigurerbare i `src/domain/bank-confirmations/config.ts` eller udskiftelige funktioner.

## Afklarede tvetydigheder

| # | Spørgsmål | Valgt default | Hvor |
|---|---|---|---|
| 1 | Statusmodellen bruges både for subopgaven og BankTask | Samme seks hovedstatusser, men **to separate overgangsmaskiner**. BankTask starter i *Afventer Kerne* (oprettes først efter godkendelse). | `statuses.ts` |
| 2 | To tidsakser | Statusdato driver T-2 mdr., T-6, T-5 og T-4 uger. Revisors faglige deadline driver T-10 arbejdsdage. Begge er obligatoriske felter på revisionsopgaven. | `timeline.ts` |
| 3 | Dato på ikke-arbejdsdag | Flyttes til **forudgående** arbejdsdag (konservativt for frister). Den oprindelige regel og regeldato gemmes og vises. | `config.timeline.nonWorkdayPolicy` |
| 4 | Påmindelsestidspunkt | Bankens forventede svartid tælles i arbejdsdage **efter statusdato**, da banker typisk først kan bekræfte saldi efter statusdato. Maks. 2 standardpåmindelser (håndhævet i fase 1; selve påmindelsesdatoen beregnes i fase 2). | `config.reminders`, bankmetode |
| 5 | Fire-øjne ved e-mailmetode | Alle opgaver med manuel e-mail kræver fire-øjne (bevidst accepteret kapacitetsomkostning). Kan slås fra pr. trigger. | `config.fourEyes` |
| 6 | Autorisation uden kundeportal | Kerne registrerer en modtaget autorisation (upload/registrering) i Kernesystemet. Den arkiveres ikke i SharePoint. | `entities.Authorization` |
| 7 | Vindue for månedlig kontrol | Statusdatoer fra kørselsdato og **3 måneder frem**, så T-2-aktiveringen fanges i tide. | `config.completenessControl.lookaheadMonths` |
| 8 | Seeddata | Nordhavn Teknik A/S har Danske Bank, Sydbank og Jyske Bank (som i briefet). | fixtures/seed |

## Øvrige defaults (brief afsnit 23)

- Erklæringstyper i porteføljekontrollen: Revision og Udvidet gennemgang.
- Helligdagskalender: danske officielle helligdage 2026–2027 (store bededag afskaffet). Udskiftelig via `createCalendar()`.
- Bankmetodens reviewinterval: 12 måneder; ældre markeres som forældet.
- Massegodkendelse: kun rollen Revisor, kun egne opgaver uden åbne spørgsmål.
- Populationskilder: sidste år, R75 (skatteoplysninger), ERP, kunde og revisor.
- SharePoint-mappe: `/Kunder/{customerId}/{engagementId}/Bankbekræftelser`.

## Kendte begrænsninger (fase 1)

- Kun domænelag og unit tests. API, database, UI og E2E-tests kommer i fase 2–4.
- Ingen reelle integrationer (AuditFlow, SharePoint, notifikationer) – kommer som adaptere med mocks.
