# Antagelser og begrænsninger

## Valgte defaults

| # | Spørgsmål | Valgt default | Hvor |
|---|---|---|---|
| 1 | Hvem underskriver hvad | Årsrapport: direktion + bestyrelse. Ledelseserklæring: direktion. Revisionsprotokollat: bestyrelse. Revisor underskriver ikke i dette flow | `catalog.ts` |
| 2 | Hvilke personer fra stamdata | Aktive personer med ydelsens roller. Fratrådte udelades | `signers.ts` |
| 3 | Manglende stamdata | Mangler e-mail, eller har kunden ingen med rollen, blokeres forløbet med en konkret besked. Det rettes i stamdata, ikke i dialogen | `signers.ts` |
| 4 | Øjebliksbillede | Underskriverne kopieres til opgaven ved afsendelse. Senere ændringer i stamdata påvirker ikke et igangværende forløb | `SigningRequestSigner` |
| 5 | Dokument | Ét PDF-dokument pr. forløb, maks. 10 MB. Uden upload genereres et demodokument | `signing-service.ts` |
| 6 | Dokumenttitel | "{Ydelse} {år før underskriftsåret} – {kunde}". Kan rettes i dialogen | `catalog.ts` |
| 7 | Rækkefølge | Alle underskrivere får anmodningen samtidig | Penneo-adapter |
| 8 | Arkivering | Det forseglede dokument fra Penneo gemmes som `{fil}_underskrevet.pdf` i `/Kunder/{kundeId}/E-signering` med SHA-256-hash | `sharepoint-adapter.ts` |
| 9 | Fejl i SharePoint | Underskriften rulles ikke tilbage. Opgaven står som "Arkivering fejlede" hos revisor med en genforsøgsknap. Kun første fejl giver en notifikation | `signing-service.ts` |
| 10 | Fejl i Penneo ved afsendelse | Intet gemmes, og der er ikke sendt noget til underskriverne. Samme Idempotency-Key kan bruges igen | `signing-service.ts` |
| 11 | Adgang | Revisorer ser kun kunder, hvor de er ansvarlige. Afvisninger logges | `access.ts` |

## Kendte begrænsninger

- **Penneo er en mock.** Interfacet følger Penneos begreber, men kaldene er ikke kørt mod Penneo. Se [penneo.md](penneo.md).
- **Ikke-atomisk på tværs af systemer:** lykkes Penneo-kaldet, men databaseskrivningen fejler, ligger der en sag i Penneo uden opgave hos os. Kendt og accepteret i prototypen.
- **Prototype-auth:** brugeren angives med `x-user-id`/cookie. Ingen SSO.
- **Webhook-sikkerhed:** delt token i URL'en i stedet for verifikation af `x-event-signature`.
- **Opgaver opdateres ved polling** (hvert 4. sekund), ikke push.
- **Fejlkontakterne** (`setPenneoFailure`, `setSharePointFailure`) bruges i test. De findes ikke i UI'et.
