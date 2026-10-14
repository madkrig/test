# Demo-script · Bankbekræftelser

Ca. 15 minutter. Følger Figma-siden *Bankbekræftelser – MVP (brief v1.0)*, F01–F13. Alle data er syntetiske.

**Forberedelse**

```bash
npm install
npm run setup     # .env, database og starttilstand (demodato 12.11.2026)
npm run dev       # http://localhost:3000
```

Brugeren skiftes i rullemenuen øverst til højre. Demodatoen ændres i datofeltet ved siden af. Datoen er fælles for alle brugere. Forsiden kan nulstille data til start- eller brief-tilstand.

| # | Dato | Bruger | Skærm | Gør dette | Pointe |
|---|---|---|---|---|---|
| 1 | 12.11.2026 | Sofie Lund (revisor) | Mine revisioner → Nordhavn Teknik (F01) | Se populationen: Sydbank er ny (ERP), Danske og Jyske er uændrede | Ændringer først; historik er kun reference |
| 2 | | Sofie | Godkend population (F02) | Læs konsekvensen, og godkend version 1 | Én BankTask pr. bank; version og tidspunkt logges |
| 3 | | Sofie | Samlet status (F03) | Se tre BankTasks hos Kerne og tidsplanen | Samme status i AuditFlow og Kerne |
| 4 | 20.11.2026 | Jonas Mikkelsen (Kerne) | Arbejdskø (F04) | Se prioriteringen; åbn Sydbank | Køen sorteres efter, hvad der kræver handling |
| 5 | | Jonas | Workbench Sydbank | Registrér autorisation, der dækker alle tre banker | Én autorisation kan dække flere opgaver |
| 6 | 03.12.2026 | Jonas | Workbench Sydbank (F05) | Send anmodning; gør det samme for Jyske | Kontrol før udsendelse; dobbelt udsendelse forhindres |
| 7 | | Jonas → Amalie Sørensen | Workbench Danske Bank | Jonas kan ikke sende (fire-øjne). Skift til Amalie, og godkend som reviewer. Skift tilbage, og send | Reviewer ≠ udfører |
| 8 | 08.01.2027 | Jonas | Danske Bank (F08) | Registrér svar, udfør administrativ kontrol, og arkivér | Kun banksvaret går til SharePoint (mock) med hash |
| 9 | 12.01.2027 | Jonas | Jyske Bank | Registrér svar; skriv afvigelsen "Uventet garanti på 2.000.000 kr." | Afvigelser bliver en faglig beslutning hos revisor |
| 10 | 15.01 og 22.01.2027 | Jonas | Sydbank | Send påmindelse 1 og 2 (knappen er spærret før bankens svartid) | Maks. to standardpåmindelser |
| 11 | 01.02.2027 | Jonas | Arbejdskø → Kør T-10-kontrol; Sydbank (F06) | Se beslutningsopgaven | T-10 arbejdsdage før faglig deadline; ingen partnereskalation |
| 12 | | Sofie | Nordhavn (F07/F09) | Sydbank: *Iværksæt alternative revisionshandlinger*. Jyske: *Opret review note* | Valg, begrundelse, ejer og deadline logges |
| 13 | | Jonas | Hver bankopgave | Afslut bankopgave × 3 | Operationel afslutning hos Kerne |
| 14 | | Sofie | Nordhavn (F09) | Luk review note; skriv faglig konklusion | Kerne kan ikke konkludere |
| 15 | | Jonas | Workbench | Fuldfør subopgave | Afslutningsblokering er løst |
| 16 | | Sofie | Portefølje (F11/F11b) | Massegodkend de klare populationer; Solbakken kan ikke vælges | Én approval event pr. engagement; delvise fejl pr. record |
| 17 | | Martin Friis (revisor) | Skovly Foods (F10) | Se delta version 2 (Nordea) og konsekvensen | Eksisterende opgaver fortsætter uændret |
| 18 | | Mia Kragh (Service Owner) | Fuldstændighed (F12) | Se Fjord & Form (tilvalgt) og Havbryn Holding (åben) | Afklaringer – aldrig automatiske bankforespørgsler |
| 19 | | Martin | Havbryn Holding (F12b) | Fravælg med begrundelse, eller tilvælg | Fravalg kræver begrundelse |
| 20 | | Mia → Lars Bech | Bankregister (F13) | Mia ændrer en metode; Lars godkender; Mia aktiverer | Fire-øjne på metoder; åbne opgaver beholder deres version |

**Genvej:** `npm run seed:brief` (eller *Nulstil til brief-tilstand* på forsiden) starter ved trin 10 med demodato 15.01.2027.
