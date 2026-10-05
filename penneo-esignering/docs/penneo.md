# Penneo-integrationen

Prototypen kører mod en mock (`src/services/adapters/penneo-adapter.ts`), men interfacet og datamodellen følger Penneos egne begreber ([Penneo core concepts](https://developer.penneo.com/docs/penneo-core-concepts)), så en rigtig adapter kan sættes ind uden at ændre services eller UI.

## Penneos begreber → prototypen

| Penneo | Betydning | I prototypen |
|---|---|---|
| **Case file** | Beholder for dokumenter og underskrivere | Én pr. `SigningRequest` (`penneoCaseFileId`). Vores id sendes med som reference/metadata |
| **Document** | PDF'en, der skal underskrives | Revisors upload eller et genereret demodokument (`penneoDocumentId`) |
| **Signer** | Personen, der underskriver | Én pr. person fra kundens stamdata (`SigningRequestSigner.penneoSignerId`) |
| **Signature line** | Kobler underskriver og dokument med en rolle | Rollen fra stamdata: *Direktør*, *Bestyrelsesformand*, *Bestyrelsesmedlem* |
| **Signing request** | E-mailen til underskriveren (emne, tekst) | *Besked til underskriverne* fra dialogen |
| **Case file status** | 0 new · 1 pending · 2 rejected · 3 deleted · 4 signed · 5 completed | `penneoStatus` (vises i Opgaver). Dokumenter hentes først ved 5 |
| **Webhooks** | Penneo kalder os ved hændelser | `POST /api/webhooks/penneo` |

## Trin for trin – hvad en rigtig adapter skal kalde

`PenneoAdapter` har to metoder. Kaldene nedenfor er Penneos *direkte oprettelse*. Alternativt kan hele sagen oprettes i ét multipart-kald med Penneos *Simple case file creation* (filer + én JSON med case file, dokumenter og underskrivere).

**`createAndSendCaseFile(input)`**

1. Opret case file med titel og reference – `POST /casefiles`
2. Tilføj dokumentet – `POST /api/v3/document-from-file`
3. Tilføj hver underskriver – `POST /casefiles/{caseFileId}/signers`
4. Opret en signaturlinje pr. underskriver med rollen, og kobl underskriveren på – `POST /documents/{documentId}/signaturelines`
5. Sæt e-mailemne og -tekst på hver underskrivers signing request
6. Send sagen – Penneo udsender e-mails til underskriverne

Returnér `caseFileId`, `documentId` og `signerId` pr. underskriver (vores `ref` → Penneos id). Webhooks matches på disse id'er.

**`downloadSignedDocument(documentId)`**

- `GET /api/v3/documents/{documentId}/content` – returnerer det forseglede dokument som base64-PDF. Kaldes kun, når sagen er *completed* (5). Dokument-id'erne kan også hentes med `GET /casefiles/{caseFileId}`.

## Webhooks

Penneo sender fx:

```json
{
  "topic": "casefile",
  "eventType": "completed",
  "eventTime": { "date": "2026-10-05 13:01:55.517791", "timezone_type": 3, "timezone": "UTC" },
  "payload": { "id": 531, "status": 5 }
}
```

med headerne `x-event-type`, `x-event-id` og `x-event-signature`.

| Hændelse (`topic.eventType`) | `payload.id` | Prototypen gør |
|---|---|---|
| `signer.signed` | signer-id | Markerer underskriveren, opdaterer "Afventer underskrift (n/m)" |
| `casefile.completed` | case file-id | Status *Underskrevet*, henter dokumentet, arkiverer i SharePoint, giver revisor besked |
| `casefile.rejected` | case file-id | Status *Afvist*, giver revisor besked |
| alt andet | – | Kvitteres med 2xx og ignoreres, så Penneo ikke genforsøger |

Vi styrer efter `eventType` frem for `payload.status`: i Penneos eksempler stemmer status-feltet ikke altid med hændelsen. Hændelser dedupliceres på `x-event-id`, og hver handler er idempotent. Går en `signer.signed` tabt, markerer `casefile.completed` alle resterende underskrivere som underskrevet.

## Før en rigtig adapter kan bygges

- [ ] **OAuth-klient** i Penneo (Configure → OAuth Clients). Brug *API Keys grant* til en hovedløs integration. Klienter er miljøspecifikke: sandbox (`sandbox.penneo.com`) og produktion er adskilt.
- [ ] **Verificér endpoints og felter i sandboxen** (`https://sandbox.penneo.com/api/docs/`). Det gælder især oprettelse af case file, koblingen mellem underskriver og signaturlinje, afsendelse og token-endpointet. Kaldene ovenfor bygger på Penneos offentlige dokumentation og SDK'er, men er ikke kørt mod Penneo.
- [ ] **Webhook-abonnement** for `signer.signed`, `casefile.completed` og `casefile.rejected` mod `https://<host>/api/webhooks/penneo`.
- [ ] **Signaturverifikation:** erstat prototypens delte token (`PENNEO_WEBHOOK_TOKEN`) med verifikation af `x-event-signature` efter Penneos dokumentation.
- [ ] **Identitet:** skal underskriverne identificeres med MitID/CPR eller CVR? Det sættes på signeren i Penneo og kræver de felter i stamdata.
- [ ] **Underskriftsrækkefølge:** prototypen sender til alle på én gang. Penneo understøtter rækkefølge (fx direktion før bestyrelse), hvis det ønskes.
- [ ] Skift `adapters.penneo` i `src/services/adapters/index.ts` til den rigtige adapter, og sæt `PENNEO_MODE=live` (slår demo-simulatoren fra).
