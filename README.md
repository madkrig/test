# Cedra Bankbekræftelser – workflowprototype

Prototype af Cedras fremtidige proces for indhentelse af bankbekræftelser: AuditFlow (revisor) og Kerne (administrativ udførelse) på samme dataobjekter, statusser og hændelseslog. Bygget efter *Master build brief v1.0*. **Alle data er syntetiske.**

## Status

| Fase | Indhold | Status |
|---|---|---|
| 1 | Domænekerne: entiteter, statusmodeller, tidsplan, forretningsregler, rettigheder, fuldstændighedskontrol + unit tests | ✅ |
| 2 | API-lag, database (Prisma/SQLite), seed, eventlog, adaptere (AuditFlow/SharePoint/notifikationer) | Næste |
| 3 | Next.js-skærme i demo-rækkefølge | – |
| 4 | E2E-tests, demo-script, screenshots, reduktionsrunde | – |

Designreference: Figma-siden *Bankbekræftelser – MVP (brief v1.0)*.

## Kom i gang

```bash
npm install
npm test          # unit tests (Vitest)
npm run typecheck # TypeScript strict
```

## Struktur

```
src/domain/bank-confirmations/
  dates.ts         kalenderdatoer uden tidszone, dd.mm.åååå
  calendar.ts      udskiftelig arbejdsdagskalender (danske helligdage)
  config.ts        konfigurerbare regler med defaults (brief afsnit 23)
  timeline.ts      T-2 mdr., T-6/T-5/T-4 uger, T-10 arbejdsdage
  entities.ts      domæneobjekter (brief afsnit 5)
  statuses.ts      seks hovedstatusser; separate overgange for subopgave og BankTask
  rules.ts         BR-01 … BR-10, udsendelse, fire-øjne, massegodkendelse
  completeness.ts  separat månedlig fuldstændighedskontrol
  permissions.ts   rolle → handlinger
tests/unit/        Vitest
docs/antagelser.md valgte defaults og kendte begrænsninger
```

Domænereglerne ligger bevidst uden for UI og API, så de kan genbruges af begge brugerflader.
