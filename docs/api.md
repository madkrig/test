# API-kontrakt

Genereret fra `scripts/routes.spec.json`. Alle kald kræver headeren `x-user-id` (prototype-auth).
Mutationer returnerer `{ data, nextAction, nextOwner }`. Fejl returnerer `{ error: { code, message, reasons?, owner?, recovery?, existingId? } }`.
Udsendelse, påmindelse, modtagelse og upload kræver headeren `Idempotency-Key`.

| Metode | Sti | Beskrivelse | Body |
|---|---|---|---|
| GET | `/api/engagements/:id/bank-confirmations` | AuditFlow-visning: subopgave, population, bankopgaver, beslutninger | – |
| POST | `/api/engagements/:id/bank-confirmations/activate` | Aktivér bankbekræftelser (dublet → 409 med existingId) | `activate` |
| GET | `/api/bank-confirmations/:id/population` | Populationsversioner; ændringer sorteret først | – |
| POST | `/api/bank-confirmations/:id/population/items` | Tilføj bank (ny kladdeversion hvis nødvendigt) | `item` |
| PATCH | `/api/bank-confirmations/:id/population/items/:itemId` | Ret eller fjern bank (fjernelse kræver begrundelse) | `itemPatch` |
| POST | `/api/bank-confirmations/:id/population/submit` | Kerne indsender populationsforslag til revisor | – |
| POST | `/api/bank-confirmations/:id/population/approve` | Revisor godkender konkret version → én BankTask pr. bank | `version` |
| POST | `/api/bank-confirmations/:id/population/reject` | Revisor returnerer version med begrundelse | `reject` |
| POST | `/api/bank-confirmations/:id/population/delta` | Ny bank efter godkendelse → delta-version | `delta` |
| POST | `/api/bank-confirmations/:id/conclusion` | Revisors faglige konklusion | `conclusion` |
| POST | `/api/bank-confirmations/:id/complete` | Kerne fuldfører subopgaven (afslutningsblokering) | – |
| POST | `/api/bank-confirmations/:id/review-notes/resolve` | Luk én åben review note | – |
| GET | `/api/review-package/:id` | Beslutningsklar reviewpakke | – |
| GET | `/api/bank-tasks` | Prioriteret arbejdskø (server-side filtrering/pagination) | – |
| POST | `/api/bank-tasks/assign` | Bulk-tildeling | `assign` |
| GET | `/api/bank-tasks/:id` | Workbench: opgave, metode, autorisation, svar, log | – |
| PATCH | `/api/bank-tasks/:id` | Tildel ejer | `patchTask` |
| POST | `/api/bank-tasks/:id/four-eyes` | Fire-øjne-kontrol (reviewer ≠ performer) | `fourEyes` |
| POST | `/api/bank-tasks/:id/send` | Send anmodning (kræver Idempotency-Key) | – |
| POST | `/api/bank-tasks/:id/remind` | Standardpåmindelse (maks. 2, kræver Idempotency-Key) | – |
| POST | `/api/bank-tasks/:id/receive` | Registrér banksvar (kræver Idempotency-Key) | `receive` |
| POST | `/api/bank-tasks/:id/administrative-check` | Administrativ kontrol + upload til SharePoint (mock) | `check` |
| POST | `/api/bank-tasks/:id/escalate` | Eskalér undtagelse som beslutning til revisor | `escalate` |
| POST | `/api/bank-tasks/:id/complete` | Afslut operationel bankopgave | – |
| POST | `/api/decisions/:id/decide` | Revisor træffer faglig beslutning | `decide` |
| POST | `/api/jobs/escalation-check` | T-10-kontrol (system/Kerne) | – |
| GET | `/api/authorizations` | Autorisationer | – |
| POST | `/api/authorizations` | Registrér autorisation, der dækker én eller flere BankTasks | `authorization` |
| PATCH | `/api/authorizations/:id` | Ret autorisation | `authorizationPatch` |
| GET | `/api/banks` | Bankregister (forældede/ufuldstændige først) | – |
| GET | `/api/banks/:id/methods` | Metodeversioner og påvirkede åbne BankTasks | – |
| POST | `/api/banks/:id/methods` | Opret metodeudkast (kræver begrundelse) | `method` |
| POST | `/api/bank-methods/:id/approve` | Fire-øjne-godkendelse af metode | – |
| POST | `/api/bank-methods/:id/activate` | Aktivér godkendt metode | – |
| GET | `/api/completeness-runs` | Kørsler af fuldstændighedskontrol | – |
| POST | `/api/completeness-runs/run` | Kør månedlig fuldstændighedskontrol | `run` |
| POST | `/api/completeness-items/:id/decide` | Tilvælg / fravælg med begrundelse | `clarification` |
| GET | `/api/reviewer/portfolio` | Revisorens populationer til godkendelse | – |
| POST | `/api/reviewer/bulk-approve` | Massegodkendelse (separat approval event pr. engagement) | `bulkApprove` |
| GET | `/api/events` | Uforanderlig hændelseslog | – |
| GET | `/api/notifications` | Notifikationer for aktuel bruger/rolle | – |

Body-skemaer er defineret med Zod i `src/app/api/_lib/schemas.ts`.

## Fejlkoder

| Kode | HTTP | Betydning |
|---|---|---|
| VALIDATION | 400 | Ugyldige eller manglende data |
| FORBIDDEN | 403 | Rollen eller engagementstilknytningen giver ikke adgang (logges) |
| NOT_FOUND | 404 | Objektet findes ikke |
| CONFLICT | 409 | Dublet eller allerede udført |
| INVALID_STATE | 409 | Forudsætning mangler – `reasons` angiver hvilke |
| INTEGRATION | 502 | Integrationsfejl (fx SharePoint) – tilstanden er gemt med recovery action |
