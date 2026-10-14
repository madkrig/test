# Modernisering: fra gamle værktøjer til webapplikation

Løsningsdesignets afsnit 12.2 beskriver, hvordan de nuværende værktøjer erstattes komponent for komponent. Denne
prototype viser slutbilledet: hver gammel komponent er en funktion i EF-service med eget API, egne data og samme
hændelseslog. Tabellen viser, hvor funktionen ligger i koden og i brugerfladen.

| # | I dag | I EF-service | Skærm | Kode |
|---|---|---|---|---|
| 1 | Banklister og bankoplysninger i Excel og Access | **Bankregister** med kanal, kanaladresse, afsenderdomæner, fuldmagtskrav, svartid, sæsonfrist, tidligst/senest afsendelse, gebyr og kilde pr. institut. Versioneret; kanal, adresse og afsenderdomæner kræver godkendelse af en anden person (4-øjne). Fusioner (Spar Nord → Nykredit) håndteres, så nye banklister bruger det overtagende institut. SLA-historikken beregnes automatisk af svarene (K4). | S09 | `services/register.ts` |
| 1b | Bankliste pr. kunde i et regneark | **Banklisteforslag** fra sidste års svar og SAF-T ved T−45, kilde pr. linje, fravalg kun med begrundelse, advarsel ved mulige mangler (VR-08), godkendelse af revisor eller delegeret. Nye kunder bekræfter deres institutter via en forudfyldt kundeformular i stedet for et Excel-ark på mail. | S03/S04 | `services/cases.ts` |
| 2 | RPA/VBA-script, der danner og sender bankmails fra Outlook | **Udsendelsesservice**: forespørgsler flettes fra skabelon B.1 med sag og bankregister, samles i batches pr. institut og kanal og sendes fra funktionspostkassen (Microsoft Graph, mock). Referencen står i emne og header. Hvert kald har en idempotensnøgle, så samme forespørgsel aldrig sendes to gange. Alle kontroller (VR-01–VR-09) køres igen lige før afsendelse. | S01 | `services/inquiries.ts`, `services/adapters` |
| 3 | Svar i personlige indbakker og manuel registrering | **Svarmodtagelse**: svar læses fra funktionspostkassen eller platformen, matches på reference – ellers CVR, institut og dato (AR-01) – afsenderen kontrolleres mod instituttets domæne (AR-02), opgørelsesdatoen kontrolleres (AR-03), og svaret arkiveres i SharePoint. Svar uden match lander i en kø. | S06, uidentificerede svar | `services/responses.ts` |
| 4 | Fuldmagter i Word sendt på mail og tjekket i hånden | **Fuldmagtsservice**: kontrol mod CVR (FR-01–FR-07) ved T−60, ved ny tegningsregel og ved afvisning; udkast fra bilag A med foreslåede underskrivere; signering i Penneo med MitID (mock); automatisk kontrol af underskrivere mod tegningsreglen på underskriftsdatoen (FR-02); påmindelser dag 5 og 10 og eskalering dag 15 (ER-05); papirfuldmagter kræver 4-øjne (FR-09). | S05 | `services/fuldmagter.ts`, `domain/ef/signing-rule.ts` |
| 5 | Afstemning af svar i Excel | **Afstemning i appen**: AI-udtræk (mock) med sikkerhed pr. linje – linjer under 95 % skal kontrolleres (AR-11) – valutaomregning med Nationalbankens kurs (AR-10), match mod bogført saldo fra SAF-T (AR-05), "kun i svaret" (AR-06), "kun i bogføringen" (AR-07), sikkerheder til noter (AR-08) og tegningsret mod CVR (AR-09). Afvigelser får klassifikation, begrundelse og beslutning; kritiske og væsentlige lukkes kun af opgaveansvarlig revisor. | S06, S07 | `domain/ef/reconciliation.ts`, `services/responses.ts` |
| 6 | Excel-skabeloner udfyldt manuelt til bulk-kanaler | **Kanaladaptere** på samme kontrakt som e-mail: webformular (kvittering gemmes), bulkfil dannet automatisk efter instituttets regel (fx PDF'er navngivet "CVR no [nummer]" i Massebesvarelse.zip) og digital platform (Circit). Manuel kanal til udenlandske institutter. | S01, S09 | `services/adapters/index.ts` |
| 7 | Frister og rykkere, som nogen skal huske | **Regelmotor og daglig kørsel**: sager oprettes ved T−60, bankliste foreslås ved T−45 med påmindelse og eskalering, afsendelse planlægges efter TR-10, rykkere foreslås ved frist +3 og +8, eskalering ved frist +13 eller P−15, påmindelse om ubehandlede afvigelser og advarsel ved P−5. Reglerne er versionerede data, som procesejeren ændrer fremadrettet. | S10, header (demo-dato) | `services/daily-job.ts`, `domain/ef/rules.ts` |
| 8 | Status og KPI samlet manuelt i regneark og mails | **Pakkesporing og KPI**: samme trin for revisor, kerneteam og ledelse; "næste handling" og "hvem har bolden" pr. sag; KPI pr. periode, afdeling og institut; kapacitetsprognose for peak; eksport af hændelsesloggen som CSV og OCEL 2.0 til procesanalyse. | S02, S03, S08, S11 | `services/queries.ts`, `services/reports.ts` |
| 9 | "Hvem gør hvad" i mailtråde | **Opgaver** (OPG-01–OPG-15) med præcis én ansvarlig og en frist, oprettet af reglerne og lukket, når betingelsen er opfyldt. Notifikationer kun, når modtageren skal handle (8.5). | S01, S03 | `services/work.ts` |

## Principper fra 12.2, som prototypen følger

- **Kontrakten først.** API'et er beskrevet som data i `src/app/api/_lib/routes.ts`; `GET /api` returnerer kontrakten.
  Integrationstestene går gennem den samme router som brugerfladen.
- **Fuldt revisionsspor.** Alle handlinger – også systemets og agentens – skrives til den uforanderlige hændelseslog
  med aktør, kilde, før/efter og begrundelse. Delegeret godkendelse logges "på vegne af".
- **Én komponent ad gangen.** Adapterne er udskiftelige bag samme kontrakt, så e-mail kan skiftes pr. institut
  (funktionsflag i bankregisteret er den naturlige næste udvidelse).

## Ikke med i prototypen

Rigtige integrationer (Graph, Penneo, SharePoint, CVR, Maconomy, SAF-T, Auditflow, Teams), Entra ID-login,
kundeportal som selvstændig side, tørløb ved siden af VBA og funktionsflag pr. institut. De er mocket bag de
kontrakter, produktionen skal bruge.
