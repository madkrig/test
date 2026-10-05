# Cedra Bankbekræftelser – workflowprototype

Prototype af Cedras fremtidige proces for indhentelse af bankbekræftelser: AuditFlow (revisor) og Kerne (administrativ udførelse) på samme dataobjekter, statusser og hændelseslog. Bygget efter *Master build brief v1.0*. **Alle data er syntetiske.**

## Status

| Fase | Indhold | Status |
|---|---|---|
| 1 | Domænekerne: entiteter, statusmodeller, tidsplan, forretningsregler, rettigheder, fuldstændighedskontrol + unit tests | ✅ |
| 2 | API-lag, database (Prisma/SQLite), seed, eventlog, adaptere (AuditFlow/SharePoint/notifikationer) + integrationstests | ✅ |
| 3 | Next.js-skærme i demo-rækkefølge | Næste |
| 4 | E2E-tests, demo-script, screenshots, reduktionsrunde | – |

Designreference: Figma-siden *Bankbekræftelser – MVP (brief v1.0)*.

## Kom i gang

```bash
npm install            # kører også prisma generate
cp .env.example .env   # DATABASE_URL="file:./dev.db"
npm run db:push        # opretter SQLite-databasen
npm run seed           # startdata (eller: npm run seed:brief for demo-tilstanden fra briefet)
npm run dev            # http://localhost:3000
npm test               # unit + integrationstests (bruger separat prisma/test.db)
npm run typecheck      # TypeScript strict
```

`seed:brief` stiller uret til 15.01.2027: Nordhavn Teknik A/S har Danske Bank modtaget og arkiveret, Jyske Bank modtaget med afvigelse (åben beslutning) og Sydbank afventende efter 1. påmindelse.

### Prototype-auth

Der er ingen rigtig login. Brugeren angives med headeren `x-user-id` (eller cookien `cedra-user`), fx:

```bash
curl -H 'x-user-id: u-jonas' localhost:3000/api/bank-tasks
```

| Bruger | Rolle |
|---|---|
| `u-sofie`, `u-martin`, `u-katrine` | Revisor |
| `u-jonas`, `u-amalie`, `u-emil` | Kerne |
| `u-mia`, `u-lars` | Serviceejer |
| `u-henrik` | Metode og kvalitet |
| `u-admin` | Systemadministrator |

Uret kan låses med `DEMO_TODAY=åååå-mm-dd`.

## Arkitektur

```
src/domain/bank-confirmations/   rene funktioner: regler, statusser, tidsplan (ingen I/O)
src/services/                    use cases: transaktioner, adgang, eventlog, idempotens
src/services/adapters/           AuditFlow, SharePoint og notifikationer (mocks)
src/app/api/**                   tynde route handlers (Zod-validering → service)
prisma/schema.prisma             datamodel
src/db/seed.ts                   seed via de rigtige services
tests/unit/                      domænetests
tests/integration/               API-flows E2E 1–6 og kontroller
docs/                            antagelser, API-kontrakt, datamodel
```

- **API-kontrakt:** [docs/api.md](docs/api.md) (genereres af `node scripts/generate-routes.mjs` fra `scripts/routes.spec.json`).
- **Datamodel:** [docs/datamodel.md](docs/datamodel.md).
- **Antagelser:** [docs/antagelser.md](docs/antagelser.md).

Domænereglerne ligger bevidst uden for UI og API, så de kan genbruges af begge brugerflader. Alle mutationer kører i én transaktion, skriver til den append-only hændelseslog og returnerer `nextAction`/`nextOwner`.
