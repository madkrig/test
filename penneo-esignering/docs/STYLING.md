# Stylingbrief – Cedra revisorværktøjer

Brug dette brief, når en ny feature skal se ud og opføre sig som **Cedra Stikprøveberegner** og **E-signering via Penneo**. Det beskriver udtrykket, tokens, komponenter og skærmmønstre, så en ny feature kan bygges uden at gætte.

- **Kilde:** `frontend/src/style.css` i [madkrig/cedra-stikproeveberegner](https://github.com/madkrig/cedra-stikproeveberegner) (branch `codex/stikproeveberegner-mvp`).
- **Referenceimplementering:** [`src/app/globals.css`](../src/app/globals.css) i dette projekt. Filen er selvstændig (ingen Tailwind, ingen UI-bibliotek) og kan kopieres direkte.
- **Eksempler i koden:** ramme i [`AppShell.tsx`](../src/app/_components/AppShell.tsx), guide i [`PenneoSigningModal.tsx`](../src/app/_components/PenneoSigningModal.tsx), oversigt i [`opgaver/page.tsx`](../src/app/opgaver/page.tsx), katalog i [`markedsplads/page.tsx`](../src/app/markedsplads/page.tsx), forløbsdiagram i [`WorkflowDiagram.tsx`](../src/app/_components/WorkflowDiagram.tsx) og [`forloeb/page.tsx`](../src/app/forloeb/page.tsx).
- **Skærmbilleder:** [`docs/screenshots/`](screenshots/).

---

## 1. Udtryk

Rolig, faglig og dokumenterende. Værktøjet skal føles som et arbejdspapir, ikke som en app med effekter.

1. **Ét hvidt kort pr. opgave** på en lys grå-grøn baggrund. Ingen farvede flader ud over status og beskeder.
2. **Én primær handling ad gangen**, altid nederst til højre i kortet. Alt andet er sekundært.
3. **Trin og status er synlige**: topline over kortet ("Trin 2 af 3", "1 aktive · 2 fuldførte") og nummereret navigation i siden.
4. **Fagligt indhold først, teknik bagerst**: id'er, hashes og systemreferencer ligger i en lukket `details`.
5. **Forklar konsekvensen**: blokeringer og forbehold skrives som hele sætninger i en `notice`, ikke som røde felter alene.
6. **Dansk, kort og præcist.** Se afsnit 8.

---

## 2. Farver (tokens)

Alle farver er CSS-variabler på `:root`. Indfør ikke nye farver i en feature uden at tilføje et token her og i `globals.css`.

| Token | Værdi | Bruges til |
|---|---|---|
| `--bg` | `#f6f7f5` | Sidebaggrund, dialogens sidepanel |
| `--ink` | `#15363b` | Overskrifter, vigtig tekst, tal i nøgletal |
| `--ink-strong` | `#163b40` | Ordmærket "cedra", `theme-color` |
| `--text` | `#6b8078` | Brødtekst (`p`) |
| `--text-muted` | `#7e9085` | `small`, hjælpetekst under felter |
| `--label` | `#4f6960` | Feltlabels |
| `--eyebrow` | `#63847a` | Eyebrow og topline (versaler) |
| `--primary` | `#176459` | Primærknap, aktiv navigation, links, fremdriftsbjælke |
| `--primary-hover` | `#0e5046` | Hover på primærknap |
| `--secondary-text` / `--secondary-border` | `#315158` / `#cad7d3` | Sekundærknap |
| `--card-border` | `#e3e9e5` | Kort, dialog, dropdown |
| `--line` | `#e8ede9` | Skillelinje over handlingslinjen |
| `--input-border` | `#ccd9d1` | Input, select, textarea |
| `--soft` / `--soft-border` | `#f4f8f4` / `#e5ede5` | Nøgletal, udfoldet tabelrække, ulæst notifikation |
| `--soft-active` | `#e1eee7` | Aktivt menupunkt, aktivt trin, aktivt filter |
| `--th-bg` / `--th-text` / `--td-text` | `#eff5f0` / `#46645a` / `#526d62` | Tabeller |
| `--ok-bg` / `--ok-text` | `#e9f5eb` / `#2d785a` | Fuldført, kvittering (`result-tag`) |
| `--warn-bg` / `--warn-line` / `--warn-text` | `#f8f5e9` / `#c5b375` / `#716333` | Afventer, blokering, fagligt forbehold |
| `--err-bg` / `--err-line` / `--err-text` | `#fff0eb` / `#ecc5b7` / `#a44328` | Fejl, afvist, manglende data, badge |

Øvrige faste værdier: fokusring `#6faa91`, backdrop `#15363b59`, drop-zone `#a7c2b4` (stiplet) på `#f9fbf9`.

---

## 3. Typografi

Skrift: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` med `font-synthesis: none`. Inter indlæses ikke i dag, så systemfonten bruges. Skal udtrykket være ens på alle maskiner, så self-host Inter i projektet. Brug ikke en ekstern CDN: værktøjerne skal kunne køre lokalt uden eksterne kald.

| Element | Størrelse / vægt | Øvrigt |
|---|---|---|
| Ordmærke `.brand` | 32px / 750 | letter-spacing −1.8px, altid "cedra" med småt |
| `h1` (kun i aside) | 31px / 550 | line-height 1.16, letter-spacing −0.9px |
| `h2` (kortets titel) | 27px / 580 | letter-spacing −0.6px; 24px på mobil |
| `h3` (afsnit i kortet) | 16px / 650 | margin 28px over, 16px under |
| Brødtekst `p` | 14px / 400 | line-height 1.65, farve `--text` |
| Feltlabel | 12px / 600 | farve `--label` |
| Eyebrow / topline | 11px / 650 | VERSALER via CSS, letter-spacing 1.3px |
| Tabel | 12px | `th` 650 i `--th-text`, `td` i `--td-text`, navne i `strong` |
| Nøgletal | 20px / 600 | label 11px over tallet |
| `small`, hjælp | 11–12px | farve `--text-muted` |
| Knapper | 14px / 600 | små knapper 12px |

Skriv eyebrow, topline og `result-tag` med almindelige bogstaver i koden. CSS sætter versaler, og skærmlæsere læser det normalt.

---

## 4. Layout og ramme

```
┌──────────────────────────── header 88px, hvid, sticky ───────────────────────────┐
│ cedra │ Produktnavn                       [Prototype · …] [🔔] [Bruger ▾]        │
└──────────────────────────────────────────────────────────────────────────────────┘
  max-width 1450px · padding 45px 48px · kolonner 300px + resten · gap 50px
┌─ aside ──────────────┐   ┌─ main ─────────────────────────────────────────────┐
│ EYEBROW              │   │ TOPLINE VENSTRE                     TOPLINE HØJRE  │
│ Kort udsagn          │   │ ┌─ section.card (hvid, radius 12, padding 34) ───┐ │
│ med punktum.         │   │ │ h2 Titel                                        │ │
│ Én sætning om        │   │ │ p  Hvad gør man her, og hvad sker der bagefter. │ │
│ formålet.            │   │ │ … indhold …                                     │ │
│ (1) Menupunkt        │   │ │ ─────────────────────────────────────────────── │ │
│ (2) Menupunkt        │   │ │                          [Sekundær] [Primær]   │ │
│ ──────────────       │   │ └─────────────────────────────────────────────────┘ │
│ Note om metode       │   │        Metadata · Metadata · Metadata (footer)     │
└──────────────────────┘   └────────────────────────────────────────────────────┘
```

- **Header:** `<a class="brand">cedra<span>Produktnavn</span></a>` til venstre. Til højre et `.local`-mærke ("Lokalt revisionsværktøj", "Prototype · syntetiske data") og evt. notifikationer og bruger.
- **Aside:** eyebrow med featurens navn, `h1` som et kort udsagn med punktum ("Et dokumenteret grundlag.", "Underskrevet og arkiveret."), én sætning om formålet, nummereret navigation og en `aside-note` om metode eller det, der sker automatisk.
- **Navigationscirkler (`<b>`):** tal for trin (1, 2, 3), antal for lister (aktive opgaver) og "+" for "bestil ny".
- **Topline:** venstre = hvor man er ("Trin 2 af 4", "Opgaver"), højre = kontekst ("Population og spørgsmål", "1 aktive · 2 fuldførte").
- **Footer:** én linje metadata adskilt af " · " ("CSV / XLSX · DKK · Versionsstyret PPS").

Afstande: kortet har padding 34px (25px under 1000px, 22/18px under 750px). Feltgitteret har gap 18px × 22px. Handlingslinjen har 28px over og 22px padding. Radius: 12 på kort og dialog, 9 på drop-zone og katalogkort, 7 på knapper, nøgletal og tabelramme, 6 på felter, 4 på mærker. Skygger er næsten usynlige på kort (`0 4px 24px #163b4004`) og kun tydelige på dropdown og dialog.

---

## 5. Komponenter

| Komponent | Klasse | Regel |
|---|---|---|
| Primærknap | `button`, `a.button` | Én pr. handlingslinje, yderst til højre. Verbum først |
| Sekundærknap | `.secondary` | "Annullér", "Tilbage", "Luk", demo- og genforsøgshandlinger |
| Lille knap | `.small` | I tabeller og lister. Brydes aldrig over to linjer |
| Tekstknap | `.link` | Sjældent; til sekundære links i tekst |
| Felt | `label.field > span + input/select/textarea + small` | Label over feltet, hjælp under. `.wide` spænder begge kolonner |
| Feltgitter | `.grid` | To kolonner; én på mobil |
| Upload | `label.drop > strong + span + input[type=file]` | Overskrift siger, hvad der skal vælges; span siger format og grænse |
| Handlingslinje | `.actions` | Højrestillet, linje over. `.spacer` skubber til venstre |
| Tabel | `.table-wrap > table` | Sticky `th`. `table.stack` + `data-label` på `td` stabler på mobil |
| Klikbar række | `tr.row` (+ `.open`, `.highlight`) | Udfoldning i `tr.detail > td[colSpan]` |
| Nøgletal | `.stats > .stat > span + strong` | 2 pr. række, `.stats.four` til oversigter |
| Fagligt forbehold / blokering | `.notice` | Gul venstrekant. Hele sætninger, evt. punktliste |
| Fejl | `.error` med `role="alert"` | Hvad skete + årsager + hvad man gør nu |
| Kvittering | `.result-tag` over `h2` | "Låst grundlag", "Sendt til Penneo" |
| Statusmærke | `.tag.waiting / .ok / .failed / .neutral` | Se afsnit 7 |
| Fremdrift | `.bar > div[style=width]` | Under statusmærket, fx 1/3 underskrevet |
| Nøgle–værdi | `dl > dt + dd` | Opsummeringer og identifikation |
| Teknik | `details > summary` | "Identifikation og metode": id'er, hash, seed, versioner |
| Filter | `.filters[role=tablist] > button.active` | Aktive / Fuldførte / Alle |
| Hændelseslog | `ol.timeline > li` | `b` = hændelse, tekst = ændring, `small` = tid · aktør |
| Tom tilstand | `.empty` | Siger, hvor man starter, med link |
| Arbejder | `.progress[role=status]` | "Arbejder …", "Sender til Penneo …" |
| Liste med status | `ul.signer-list > li > .who + .tag/knap` | Person eller post til venstre, status eller handling til højre |
| Katalogkort | `.catalog > article.offer` (`.muted` = ikke tilgængelig) | Eyebrow-kategori, `h3`, `p`, fod med handling |
| Forløbsdiagram | `<WorkflowDiagram>` (`.wf-scroll > .wf-canvas`) | Tegnes ud fra trin og ruter; vandret scroll. Grå flade = automatisk, stiplet = integration, hvid = person. Udfald i piller på kanterne. Se [forloebsdiagram.md](forloebsdiagram.md) |
| Trin-tabel | `<WorkflowSteps>` (`table.stack.wf-steps`) | # · Trin (ikon, navn, `nøgle` · type) · Hvem (+ frister) · Ruter (`udfald` → trin). Rækker har `id="step-<nøgle>"` |

### Markup – felt, upload og handlingslinje

```tsx
<div className="grid">
  <label className="field">
    <span>Kunde</span>
    <select value={clientId} onChange={…}><option value="">Vælg …</option>…</select>
    <small>Kun kunder, hvor du er ansvarlig revisor.</small>
  </label>
  <label className="field wide">
    <span>Besked til underskriverne</span>
    <textarea value={message} onChange={…} />
  </label>
</div>

<label className="drop">
  <strong>Vælg årsrapport som PDF</strong>
  <span>PDF, højst 10 MB</span>
  <input aria-label="Dokument (PDF)" type="file" accept=".pdf" />
</label>

<div className="actions">
  <button className="secondary">Tilbage</button>
  <button disabled={!klar}>Send til underskrift</button>
</div>
```

### Markup – fejl og blokering

```tsx
<div className="error" role="alert">
  <strong>Underskriftsforløbet kan ikke startes.</strong>
  <ul><li>Søren Mikkelsen (Bestyrelsesformand) mangler e-mail i stamdata.</li></ul>
  <div>Ret kundens underskrivere i stamdata, og prøv igen.</div>
</div>

<div className="notice">
  <strong>Forløbet kan ikke startes endnu.</strong>
  <ul><li>Kunden har ingen aktive underskrivere med rollen bestyrelsesformand.</li></ul>
</div>
```

---

## 6. Skærmmønstre

**Guide (flere trin).** Bruges til alt, hvor revisor tager stilling trin for trin (upload → spørgsmål → lås, eller ydelse → dokument → send).
- Som hel side: aside-navigationen er trinene. Som dialog: `.backdrop > .dialog > .dialog-side (eyebrow, h2, nav.steps) + .dialog-main (.dialog-body + .actions)`.
- Trin-knapper har tre tilstande: `.active` (grøn cirkel), `.done` (✓ i lysegrøn) og deaktiveret, når trinnet ligger foran. Når resultatet er låst eller sendt, deaktiveres alle trin, men det aktive står stadig fuldt optrukket.
- Topline: "Trin x af n" til venstre (og luk-knap i dialog).
- Hvert trin: `h2` som handling ("Vælg ydelse og kunde", "Kontrollér populationen"), én `p` om hvorfor, indhold, og så `.actions`.
- Før en uigenkaldelig handling: vis en opsummering i `dl` med alt, der indgår.

**Kvittering.** `.result-tag` → `h2` i datid ("Stikprøvegrundlag klar", "Underskriftsforløbet er startet") → `p` om hvad der sker nu → `.stats` med 2–3 nøgletal → `dl` → handlinger ("Luk" / "Gå til Opgaver", "Download …").

**Oversigt.** `.section-head` med `h2` + `p` til venstre og `.filters` til højre → `.stats.four` (fx aktive, afventer, kræver handling, fuldført) → `table.stack` med klikbare rækker → udfoldet detalje i to kolonner (`.detail-grid`): handlinger og data til venstre, hændelseslog til højre, teknik i `details`.

**Blokering.** Knappen til næste trin er deaktiveret, og en `.notice` forklarer præcist hvad der mangler, og hvor det rettes. Felter i tabeller, der mangler data, vises med `.missing` ("Mangler e-mail").

**Fejl fra serveren.** Vis `message`, `reasons` som punktliste og `recovery` som sidste linje i `.error`. API'et returnerer `{ error: { code, message, reasons?, owner?, recovery? } }`, og UI'et viser teksterne uden at omformulere dem.

**Tom tilstand.** `.empty` med én sætning og et link til stedet, hvor man starter ("Start et e-signeringsforløb fra Markedspladsen").

**Forløb.** Et forløb vises som diagram i ét kort og trin-tabel i det næste. Klik i diagram eller tabel markerer trinnet begge steder og opdaterer `?step=<nøgle>#step-<nøgle>`. For et konkret forløb (fx i Opgaver) fremhæves det aktuelle trin med "Her nu", vejen dertil er grøn, og trin, der ikke er nået, dæmpes.

---

## 7. Status

Brug samme fire farvefamilier i alle features. Status skrives med ord, aldrig kun farve.

| Betydning | Klasse | Eksempler |
|---|---|---|
| Venter på nogen | `.tag.waiting` (gul) | "Afventer underskrift · 1/3", "Afventer bank" |
| Systemet arbejder | `.tag.neutral` (grå-grøn) | "Underskrevet – arkiveres", "Beregner" |
| Kræver handling / fejl | `.tag.failed` (rød) | "Arkivering fejlede", "Afvist" |
| Færdig | `.tag.ok` (grøn) | "Fuldført", "Låst grundlag" |

Vis "hvem venter vi på" i en egen kolonne (navne, rolle eller "System") og fremdrift med `.bar`, når der er en tæller.

---

## 8. Tekst og tone

- **Dansk** i hele brugerfladen, inkl. fejl og tomme tilstande.
- **Knapper starter med et verbum** og siger, hvad der sker: "Fortsæt til dokument", "Send til underskrift", "Lås og udvælg stikprøve", "Prøv arkivering igen". Undgå "OK", "Næste" og "Submit".
- **`h1` er et udsagn med punktum.** **`h2` er en handling** eller i kvitteringen et resultat.
- **Én forklarende sætning under `h2`**, maks. to.
- **Ventetekster** med mellemrum og ellipse-tegn: "Sender …", "Henter …", "Vælg …".
- **Datoer** `dd.mm.åååå tt:mm`, **beløb** med `Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK' })`, **tom værdi** "–".
- **Fejl** siger hvad der skete, hvorfor og hvad man gør nu – og ejer: "SharePoint svarede ikke. Dokumentet er underskrevet, men ikke arkiveret. Prøv arkiveringen igen fra Opgaver."
- **Faglige forbehold** skrives ud i en `.notice`. Påstå aldrig, at værktøjet godkender revisionen eller dokumenterer ISA-compliance. Kald output ved sit faglige navn ("Stikprøvegrundlag", "Underskrevet dokument").
- **Syntetiske data** markeres i `.local` og footer, så længe der ikke bruges rigtige kundedata.

---

## 9. Responsivt

| Bredde | Ændring |
|---|---|
| > 1000px | Fuld ramme: aside 300px, dialog med sidepanel 240px |
| ≤ 1000px | Aside 220px, mindre padding. `.stats.four` → 2 kolonner, `.catalog` og `.detail-grid` → 1. Dialogens trin ligger som en række øverst |
| ≤ 750px | Header 70px, `.local` skjules. Aside bliver en vandret fanerække; `h1`, intro og note skjules. Felter i én kolonne, nøgletal i to. `table.stack` bliver kort med `data-label`. Dialogen fylder hele skærmen og viser kun trinnumre |

Sidenavigation med 3 punkter eller færre beholder teksten på mobil. Trin i en guide viser kun numrene på mobil (som stikprøveberegnerens fire trin); trinnets navn står i `h2`. Der må aldrig være vandret scroll på siden; test ved 390px.

---

## 10. Tilgængelighed

- Fokusring på alle interaktive elementer: `outline: 2px solid #6faa91; outline-offset: 2px`. Fjern den aldrig.
- `role="alert"` på fejl, `role="status"` på "Arbejder …", `role="dialog" aria-modal="true" aria-labelledby` på dialoger. Escape og klik på baggrunden lukker dialogen.
- Ikonknapper (🔔, ×) har `aria-label`. Trin-knapper har `aria-label="Trin 2: Dokument og besked"`, fordi teksten skjules på mobil.
- Status må aldrig kun være farve: mærket har altid tekst.
- **Kontrast (kendt svaghed, arvet fra stikprøveberegneren):** overskrifter, labels, tabeltekst, knapper og statusmærker består WCAG AA. Brødtekst og de små grå tekster gør ikke:

  | Tekst | Nu | Forhold | AA-variant | Forhold |
  |---|---|---|---|---|
  | Brødtekst `--text` | `#6b8078` | 4,21 | `#677b73` | 4,51 |
  | `small` / `--text-muted` | `#7e9085` | 3,38 | `#6b7a71` | 4,52 |
  | Eyebrow / topline | `#63847a` | 3,82 | `#59776e` | 4,56 |
  | Footer / aside-note | `#92a296` / `#798c83` | 2,50 / 3,32 | `#64746d` | 4,59 |
  | Nøgletalslabel | `#788e81` | 3,27 | `#64766b` | 4,51 |

  AA-varianterne er næsten umulige at skelne visuelt. Skift dem i begge projekter på én gang, så udtrykket forbliver ens.

---

## 11. Gør / gør ikke

| Gør | Gør ikke |
|---|---|
| Ét kort pr. opgave, én primærknap | Flere primærknapper eller farvede kort |
| Brug eksisterende klasser og tokens | Inline-farver, nye grå nuancer, Tailwind-klasser blandet ind |
| Forklar blokeringer i en `.notice` | Deaktivér en knap uden forklaring |
| Læg id'er, hash og versioner i `details` | Vis tekniske id'er som hovedindhold |
| Lad API'ets `recovery` stå som sidste linje i fejlen | Generiske fejl som "Noget gik galt" |
| Tabeller med `table.stack` + `data-label` | Tabeller, der klippes eller scroller vandret på mobil |
| Ikoner sparsomt: 🔔, ✓, × og trintype-ikonerne i `StepIcon.tsx` | Ikonbiblioteker, illustrationer, animationer |

---

## 12. Tjekliste før aflevering

- [ ] Header med "cedra" + produktnavn, aside med eyebrow, udsagn, navigation og note.
- [ ] Topline over hvert kort; `h2` + forklarende `p` øverst i kortet.
- [ ] Én primærknap pr. handlingslinje, yderst til højre, med verbum.
- [ ] Felter i `.grid` med label over og hjælp under.
- [ ] Blokeringer i `.notice`; serverfejl i `.error` med årsager og recovery.
- [ ] Status som `.tag` med tekst; "afventer hvem" vist.
- [ ] Teknik i `details`; opsummering i `dl` før uigenkaldelige handlinger.
- [ ] Ingen nye farver uden token; ingen inline-stile ud over beregnede mål (bredden på `.bar`, positioner i forløbsdiagrammet).
- [ ] Testet ved 1440px og 390px uden vandret scroll; dialog og tabeller fungerer på mobil.
- [ ] Fokusring synlig; `role="alert"`/`role="status"` og `aria-label` på ikonknapper.
- [ ] Dansk tekst, datoer `dd.mm.åååå`, ingen påstande om godkendelse eller compliance.

---

## 13. Genbrug i en anden kodebase

1. Kopiér `src/app/globals.css`. Kun afsnittet *Katalog (markedspladsen)* er featurespecifikt og kan slettes; *Notifikationer i headeren* kan slettes, hvis featuren ikke har notifikationer. Resten er fælles.
2. Byg rammen som `AppShell.tsx` (header + `.layout` med aside og `main`). Sider leverer selv `.topline` og `section.card`.
3. Featurespecifikke stile lægges i et nyt afsnit nederst i CSS-filen og bruger kun tokens fra afsnit 2.
4. Bruger projektet Tailwind, så definér de samme tokens i temaet med samme navne (`primary`, `ink`, `warn-bg` …) og byg komponenterne med de mål, der står i afsnit 3–5. Bland ikke de to systemer i samme skærm.

### Kort prompt til en kodeagent

> Byg brugerfladen efter `docs/STYLING.md` (Cedra-stil fra Cedra Stikprøveberegner). Genbrug klasserne og tokens fra `globals.css`; tilføj ikke nye farver. Rammen er header med "cedra"-ordmærke, aside med eyebrow, et kort udsagn med punktum, nummereret navigation og en note, og indholdet som topline + ét hvidt `section.card` med `h2`, én forklarende sætning og `.actions` nederst med én primærknap til højre. Flertrinsforløb bygges som guide med "Trin x af n". Blokeringer vises i `.notice`, serverfejl i `.error` med årsager og recovery, status som `.tag` med tekst, og teknik i `details`. Al tekst på dansk; knapper starter med et verbum. Test ved 1440px og 390px uden vandret scroll.
