# Antagelser og forenklinger

Prototypen følger løsningsdesignet v0.95. Hvor designet er åbent eller skal afklares, er der truffet et valg, som er
nemt at ændre. Valgene står her, så de kan valideres.

## Regler og frister

- **Hverdage** er mandag–fredag uden danske helligdage (påske beregnet). Datoer relativt til T flyttes til næste
  hverdag, frister relativt til P til forrige hverdag (som i designets eksempel for T−60 = 2.11.2026).
- **Forudbestilling** (negativ "tidligst afsendelse", fx Nordea) gælder for alle balancedage. Svarfristen for en
  forudbestilling regnes fra balancedagen, ikke fra afsendelsen; sæsonfristen bruges ved balancedag 31.12, hvis den er længere (ER-01).
- **Eskalering** (ER-03) sker ved den tidligste af frist + 13 hverdage og P−15. Revisors beslutning "ny frist" eller
  "kunden kontakter banken" nulstiller eskaleringen; rykkere sendes højst to gange.
- **"Bør fornyes"** (FR-05) kan bruges til at sende, men giver en advarsel og en opgave om fornyelse.
- **Fuldmagter til tidligere Cedra-enheder** behandles som ugyldige, indtil beslutning D1 siger andet (FR-03).
- **Konklusion** kræver, at alle forespørgsler er afsluttet eller annulleret, at alle afvigelser er lukket, og at den
  forventede population er afstemt (K2). Konklusion låser og arkiverer sagen straks (OPG-15).

## Roller og adgang

- Kernemedarbejdere og kerneteamleder ser alle sager undtagen ved habilitetsspærring eller fortrolighed.
  Revisorer, revisionsmedarbejdere, procesejer og agent ser kun sager, hvor de har en rolle (10.4).
- Kernemedarbejderen på en sag vælges efter afdeling (Øst/Vest) og springer habilitetsspærrede over.
- En agent er tilknyttet et opgaveteam for at kunne læse sagen. Agentens forslag (fx en bankliste-linje) er en kladde,
  som en bruger skal tage med.

## Data og integrationer

- Kildesystemer (Maconomy, CVR, SAF-T, Auditflow, Nationalbanken) er mock-tabeller med præfikset `Src`.
  Pengeinstitutternes svar dannes af `SrcBankStatement` via demo-simulatoren.
- Historik fra sidste år er migreret som låste sager ("fase 0") og bruges kun som grundlag for banklisteforslaget.
  De indgår ikke i KPI'erne.
- AI-udtrækket er simuleret: linjer markeret som svære at læse får 82 % sikkerhed, resten 99 %.
- Beløb gemmes i øre. Bank og bogføring har samme fortegn (gæld negativ); difference = bank − bogføring.
- Grænsen for klart ubetydelige beløb hentes pr. opgave; differencer under grænsen lukkes automatisk som uvæsentlige.
- Referencen er `EF-ÅÅÅÅ-nnnnnn`, hvor året er året for planlagt afsendelse.
- Bankregisterets startdata følger bilag C. CVR-numre for institutterne er fiktive, og institutter uden for bilag C
  (Lindholm Sparekasse, Bølgebanken, Ostsee Handelsbank) er opdigtede.
- Fuldmagtsteksten (bilag A) er et udkast og kræver juridisk review før brug.

## Demo

- Systemdatoen er en indstilling. "Flyt datoen" kører den daglige kørsel for hver dag imellem (højst 120 dage ad gangen)
  og kan kun gå fremad, fordi hændelsesloggen er uforanderlig.
- Notifikationer via Teams og e-mail logges som integrationskald og vises i brugerfladen.
