# Datamodel

Prisma/SQLite (`prisma/schema.prisma`). SQLite har ikke enums eller arrays: statusser gemmes som strenge og valideres i domænelaget (`src/domain/bank-confirmations`), lister gemmes som JSON-tekst eller i koblingstabeller. Datoer er ISO-strenge (`åååå-mm-dd`) uden tidszone. **Alle data er syntetiske.**

## Overblik

```
Customer 1─* Engagement 1─* Subtask 1─* PopulationVersion 1─* PopulationItem
                              │
                              ├─* BankTask *─1 BankMethodVersion *─1 Bank
                              │      ├─1 BankResponse
                              │      └─* AuthorizationCoverage *─1 Authorization
                              └─* Decision

CompletenessRun 1─* CompletenessItem      Event (append-only)
Notification   IdempotencyKey   IntegrationCall   User
```

## Entiteter

| Model | Formål | Vigtige felter / regler |
|---|---|---|
| `User` | Syntetiske brugere og roller | `role`: AUDITOR, KERNE, SERVICE_OWNER, METHOD_QUALITY, SYSTEM_ADMIN, SYSTEM |
| `Customer` | Kunde | `responsibleAuditorId`, `hasHistory` (tidligere bankbekræftelser) |
| `Engagement` | Revisionsopgave | `statusDate` (driver T-2 mdr./T-6/T-5/T-4 uger), `professionalDeadline` (driver T-10), `team` (JSON) |
| `Subtask` | Én bankbekræftelses-subopgave pr. engagement og periode | `status` afledes af BankTasks (`deriveSubtaskStatus`), `nextAction`/`nextOwner`, `openQuestions`, `openReviewNotes`, faglig konklusion |
| `PopulationVersion` | Versioneret population (FULL eller DELTA) | `status` DRAFT → SUBMITTED → APPROVED/REJECTED. `approvalSnapshot` gemmer det grundlag, revisor godkendte. Unik på `(subtaskId, version)` |
| `PopulationItem` | Én bankrelation i en version | `change` (PROPOSED, ADDED, CHANGED, REMOVED, UNCHANGED), `sources` (JSON), `removalReason` er påkrævet ved fjernelse |
| `Bank` | Bank i bankregistret | – |
| `BankMethodVersion` | Versioneret bankmetode | DRAFT → ACTIVE → RETIRED. Fire-øjne: `createdBy ≠ approvedBy`. Åbne BankTasks beholder deres version |
| `BankTask` | Én opgave pr. bank i godkendt population | Unik på `(subtaskId, bankId)`. Separate flag-kolonner (`flagBlocked`, `flagDeadlineExceeded`, `flagMissingAuthorization`, `flagException`, `flagProfessionalAction`, `flagFourEyesRequired`) genberegnes ved hver ændring |
| `Authorization` / `AuthorizationCoverage` | Kundens fuldmagt og hvilke BankTasks den dækker | Registreres i Kerne, arkiveres ikke i SharePoint |
| `BankResponse` | Modtaget banksvar | `administrativeCheckStatus`, `checks`, `deviations`, SharePoint-reference og `integrityHash`. Kun banksvar arkiveres i SharePoint |
| `Decision` | Faglig beslutning for revisor | `type`: MISSING_RESPONSE (T-10), EXCEPTION (afvigelse), DELTA_APPROVAL. `options` (JSON), valgt option, begrundelse, opfølgning |
| `CompletenessRun` / `CompletenessItem` | Månedlig fuldstændighedskontrol | Afklaring OPEN → OPT_IN (aktiverer subopgave) eller OPT_OUT (kræver begrundelse) |
| `Event` | Hændelseslog | **Append-only**: applikationslaget eksponerer kun `appendEvent` og `listEvents`. Afviste adgangsforsøg logges efter rollback |
| `Notification` | Notifikationer | `recipient` er bruger-id eller rolle (`ROLE:KERNE`, `ROLE:SERVICE_OWNER`) |
| `IdempotencyKey` | Idempotente kald | Udsendelse, påmindelse, modtagelse og administrativ kontrol returnerer det gemte svar ved gentagelse |
| `IntegrationCall` | Simulerede kald til AuditFlow og SharePoint | Bruges til demo og test af fejl/genforsøg |

## Statusser

Seks hovedstatusser, delt af subopgave og BankTask, men med separate overgangsmaskiner (`statuses.ts`):

`INITIATED_KERNE` · `AWAITING_AUDITOR` · `AWAITING_KERNE` · `AWAITING_BANK` · `RECEIVED` · `COMPLETED`

Flag gemmes separat fra status, så en opgave fx kan være *Afventer bank* og samtidig *overskredet frist*.
