# API

Prototype-auth: brugeren angives med headeren `x-user-id` (eller cookien `cedra-user`). Fejl returneres som `{ error: { code, message, reasons?, owner?, recovery? } }`. Mutationer returnerer `{ data, nextAction, nextOwner }`.

| Metode | Sti | Formål |
|---|---|---|
| GET | `/api/users` | Revisorer til brugervælgeren (ingen login) |
| GET | `/api/signing-services` | Ydelser: Årsrapport, Ledelseserklæring, Revisionsprotokollat |
| GET | `/api/clients` | Revisors egne kunder (dropdown) |
| GET | `/api/clients/{id}/signers?service=ANNUAL_REPORT` | Underskrivere fra stamdata + blokeringer + forslag til titel og besked |
| POST | `/api/signing-requests` | Start forløb i Penneo. **Kræver `Idempotency-Key`.** Body: `{ clientId, serviceType, documentTitle?, message?, document?: { fileName, contentBase64 } }` |
| GET | `/api/signing-requests?scope=active\|completed\|all` | Opgaver |
| GET | `/api/signing-requests/{id}` | Opgave med underskrivere og hændelseslog |
| POST | `/api/signing-requests/{id}/archive` | Genforsøg arkivering i SharePoint |
| POST | `/api/webhooks/penneo` | Penneos webhooks (ingen bruger; `x-event-id` dedupliceres; `?token=` hvis `PENNEO_WEBHOOK_TOKEN` er sat) |
| POST | `/api/demo/penneo/sign` | Demo: simulér underskrift `{ requestId, signerId }` (kun `PENNEO_MODE=mock`) |
| GET | `/api/notifications` | Notifikationer for aktuel bruger |
| POST | `/api/notifications/read` | Markér alle som læst |

Eksempel:

```bash
curl -H 'x-user-id: u-sofie' 'localhost:3000/api/clients/c-nordhavn/signers?service=ANNUAL_REPORT'

curl -X POST localhost:3000/api/signing-requests \
  -H 'x-user-id: u-sofie' -H 'content-type: application/json' -H 'idempotency-key: 1' \
  -d '{"clientId":"c-nordhavn","serviceType":"ANNUAL_REPORT"}'

# Som Penneo: sagen er færdigunderskrevet
curl -X POST localhost:3000/api/webhooks/penneo -H 'content-type: application/json' -H 'x-event-id: evt-1' \
  -d '{"topic":"casefile","eventType":"completed","payload":{"id":<penneoCaseFileId>,"status":5}}'
```
