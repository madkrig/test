# Cedra Kundestyringsværktøj

A Cedra-branded client management web app for auditors, inspired by an
internal "KUNDEOVERBLIK" dashboard. It has two parts:

- **Overblik** (`/`) — a portfolio dashboard: clients per balance date,
  tasks by status, task status broken down by phase, and status broken
  down by office or by person, all driven by filters (statement type,
  intern audit involvement, region, role).
- **Kunder** (`/kunder`) — the actual client management screen: search
  and filter clients, create new engagements, and open a client to edit
  its details or update the status of each audit task (Stamdata,
  Planlægning, Løbende, Afslutning).

Data is generated as a deterministic demo dataset on first load and then
persisted to the browser's `localStorage`, so adding, editing, or
deleting clients and tasks sticks across reloads. There is no backend —
this is a front-end prototype.

## Stack

- React 19 + TypeScript, built with Vite
- Tailwind CSS v4 for styling
- React Router for the two views
- No chart library — the bar/stacked-bar visuals are hand-rolled to
  match the reference dashboard's layout exactly

## Getting started

```bash
npm install
npm run dev      # start the dev server
npm run build    # type-check and produce a production build in dist/
npm run preview  # preview the production build locally
```

## Branding

No official Cedra brand guide was available, so this uses a placeholder
palette (deep cedar teal + a warm gold accent, defined in
`src/index.css`) and a simple geometric wordmark (`src/components/Logo.tsx`).
Swap the `--color-cedra-*` / `--color-gold-*` tokens and the logo mark to
match real brand assets when available.
