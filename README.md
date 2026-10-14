# Cedra Bankbekræftelser – workflowprototype

Prototype af Cedras fremtidige proces for indhentelse af bankbekræftelser: AuditFlow (revisor) og Kerne (administrativ udførelse) på samme dataobjekter, statusser og hændelseslog. Bygget efter *Master build brief v1.0*. **Alle data er syntetiske.**

## Status

| Fase | Indhold | Status |
|---|---|---|
| 1 | Domænekerne: entiteter, statusmodeller, tidsplan, forretningsregler, rettigheder, fuldstændighedskontrol + unit tests | ✅ |
| 2 | API-lag, database (Prisma/SQLite), seed, eventlog, adaptere (AuditFlow/SharePoint/notifikationer) + integrationstests | ✅ |
| 3 | Next.js-skærme (F01–F13), rolleskift, fælles demodato, demo-script | ✅ |
| 4 | Playwright E2E i repoet, screenshots, reduktionsrunde | Næste |

Designreference: Figma-siden *Bankbekræftelser – MVP (brief v1.0)*.

## Kom i gang

```bash
npm install            # kører også prisma generate
cp .env.example .env   # DATABASE_URL="file:./dev.db"
npm run db:push        # opretter SQLite-databasen
npm run seed           # startdata (eller: npm run seed:brief for demo-tilstanden fra briefet)
npm run dev            # http://localhost:3000 – vælg rolle på forsiden
npm test               # unit + integrationstests (bruger separat prisma/test.db)
npm run typecheck      # TypeScript strict
```

`seed:brief` stiller uret til 15.01.2027: Nordhavn Teknik A/S har Danske Bank modtaget og arkiveret, Jyske Bank modtaget med afvigelse (åben beslutning) og Sydbank afventende efter 1. påmindelse.

Gennemgang af demoen: [docs/demo-script.md](docs/demo-script.md).

## Skærme

| Rute | Rolle | Figma |
|---|---|---|
| `/` | alle | Rollevalg, demodato og nulstilling |
| `/auditflow` | Revisor | Mine revisioner |
| `/auditflow/:engagementId` | Revisor | F01–F03, F07, F09, F10, F12b |
| `/auditflow/portfolio` | Revisor | F11, F11b |
| `/kerne` | Kerne, Service Owner | F04 arbejdskø + populationer at klargøre |
| `/kerne/population/:subtaskId` | Kerne | Klargør og indsend populationsforslag |
| `/kerne/bank-tasks/:id` | Kerne | F05, F06, F08 workbench |
| `/kerne/completeness` | Service Owner | F12 |
| `/admin/banks` | Kerne (læse), Service Owner | F13 |

Skærmene er server-komponenter, der læser via services. Handlinger kalder API'et fra små klientkomponenter (`src/ui/client`), og fejl vises med årsag, ejer og recovery action.

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

I browseren gemmes den valgte bruger i cookien `cedra-user`.

**Demodato:** Datoen er fælles for alle brugere og gemmes i databasen (`Setting.demoToday`). Seeden sætter den til scenariets dato. Den ændres i topbjælken eller med `POST /api/demo/clock`. Uden gemt dato bruges `DEMO_TODAY` eller dags dato.

## Arkitektur

```
src/domain/bank-confirmations/   rene funktioner: regler, statusser, tidsplan (ingen I/O)
src/services/                    use cases: transaktioner, adgang, eventlog, idempotens
src/services/adapters/           AuditFlow, SharePoint og notifikationer (mocks)
src/app/api/**                   tynde route handlers (Zod-validering → service)
src/app/(auditflow|kerne|admin)  skærme (server-komponenter)
src/ui/                          fælles visning, labels og klientkomponenter
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
