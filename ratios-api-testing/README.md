# Ratios API — Testing Toolkit

Setup + tooling for testing the Ratios API ahead of building automation for user sync,
client sync, client creation, task creation, etc. Start with **`TESTING_PLAN.md`** for the
full plan and rationale; this file is just the "how to run it" instructions.

This toolkit is **Postman-only** by design — one place to install, one collection encoding
every confirmed request/response assumption, nothing to keep in sync across two tools.

## Prerequisites

- A Ratios test/service account with the `API-adgang` role assigned by an admin.
- Ideally a **sandbox tenant** — ask Ratios before running any write requests against a real one.
- Postman (desktop app or web).
- (Optional, for CI) Node.js + [Newman](https://www.npmjs.com/package/newman) to run the
  collection headlessly.

## 1. Import & configure

1. Open Postman → **Import** → select both files in `postman/`:
   - `Ratios_API.postman_collection.json`
   - `Ratios_API.postman_environment.json`
2. Select the **"Ratios API - Sandbox"** environment (top-right environment picker).
3. Fill in the environment's secret values (`apikey`, `email`, `password`) directly in Postman
   — don't paste them into the collection itself, and don't commit an environment export that
   has real values filled in. `.env.example` in this folder documents the same values, useful as
   a reference and for Newman's `--env-var` flags (see §4).
4. Run **01 - Authentication → Get JWT Token**. Its Tests script writes `access_token`/
   `refresh_token` into the environment automatically; every other request in the collection
   uses `{{access_token}}` via the collection-level Bearer auth, so no manual copying is needed.
5. Run **01 - Authentication → List Tenants** and copy the right `tenant_id` into the
   environment.

## 2. Run order

- **`00 - Smoke Test (core happy path)`** — run this first, and any time you want a fast "is
  auth + the API still behaving" check. It creates a client, updates it, creates a linked project
  (standing in for a "client workspace" — see the request description), creates and updates a
  task, then deletes everything it created. Fully self-contained; safe to re-run repeatedly.
- **`01 - Authentication`** — connectivity/auth checks, including negative cases (wrong password,
  missing `apikey` header, foreign `tenant_id`).
- **`02 - Clients`**, **`03 - Tasks`**, **`04 - Users (Profiles)`** — CRUD per resource, each
  including a validation-error case (e.g. missing required field).
- **`03b - Pagination & Filtering Edge Cases`** — one request per filter operator plus pagination
  boundary cases (default/max/over-max `per_page`, page past the end, ordering, field selection).
  Best run as a batch via **Collection Runner** (see below).
- **`05 - Partner OAuth2 (optional)`** — only relevant if/when the Partner OAuth2 model is the
  chosen integration approach (see `TESTING_PLAN.md` §8).
- **`06 - Sync Patterns`** — a self-looping pagination-walk request (pages through *all* `clients`
  using `pm.execution.setNextRequest`), an incremental-sync example filtered on `updated_at`, and
  the rate-limit probe procedure (read its description before running).
- **`99 - Cleanup`** — run after an interrupted run, or periodically; lists any leftover records
  matching `{{test_prefix}}` so they can be deleted.

## 3. Using the Collection Runner

For anything meant to run as a batch (the `03b` edge-case folder, the pagination-walk request,
the rate-limit probe): open **Collection Runner**, pick the folder (or the whole collection),
select the **Ratios API - Sandbox** environment, and run. For the rate-limit probe specifically,
set an explicit inter-request delay (e.g. 250ms) and a small iteration count (e.g. 20) — see the
request description in `06 - Sync Patterns` for the full procedure.

## 4. Headless / CI runs with Newman

```bash
npm install -g newman
newman run postman/Ratios_API.postman_collection.json \
  -e postman/Ratios_API.postman_environment.json \
  --env-var apikey=$RATIOS_API_KEY \
  --env-var email=$RATIOS_EMAIL \
  --env-var password=$RATIOS_PASSWORD \
  --env-var tenant_id=$RATIOS_TENANT_ID
```

Run just the `00 - Smoke Test` folder as a fast scheduled health check:

```bash
newman run postman/Ratios_API.postman_collection.json \
  -e postman/Ratios_API.postman_environment.json \
  --folder "00 - Smoke Test (core happy path)" \
  --env-var apikey=$RATIOS_API_KEY --env-var email=$RATIOS_EMAIL \
  --env-var password=$RATIOS_PASSWORD --env-var tenant_id=$RATIOS_TENANT_ID
```

Keep real secrets out of source control — pass them as CI secret-store environment variables
(as above via `--env-var`), never committed into the environment JSON.

## 5. Folder layout

```
ratios-api-testing/
├── TESTING_PLAN.md          # full test plan (read this first)
├── README.md                # this file
├── .env.example              # reference list of required config/secrets
├── .gitignore
└── postman/
    ├── Ratios_API.postman_collection.json
    └── Ratios_API.postman_environment.json
```

## 6. A note on production automation

This toolkit is for **testing and confirming API behavior**, not for the production sync jobs
themselves. Once the phases in `TESTING_PLAN.md` are worked through and the open questions
(§1) are resolved, the actual client sync / user sync / task creation automation is a separate
build — in whatever language/runtime fits your infrastructure — informed by what gets confirmed
here (real field names, pagination behavior, dedup semantics, rate limits, etc).
