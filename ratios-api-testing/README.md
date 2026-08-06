# Ratios API — Testing Toolkit

Setup + tooling for testing the Ratios API ahead of building automation for user sync,
client sync, client creation, task creation, etc. Start with **`TESTING_PLAN.md`** for the
full plan and rationale; this file is just the "how to run it" instructions.

## Prerequisites

- A Ratios test/service account with the `API-adgang` role assigned by an admin.
- Ideally a **sandbox tenant** — ask Ratios before running any write tests against a real one.
- Postman (desktop app or web) for exploratory testing.
- Python 3.10+ for the automated test suite.

## 1. Shared configuration (`.env`)

Both Postman and Python setups read from the same values. Start here:

```bash
cd ratios-api-testing
cp .env.example .env
```

Fill in `.env` with:
- `RATIOS_API_KEY` — the public `apikey` header value from the Authentication docs.
- `RATIOS_EMAIL` / `RATIOS_PASSWORD` — your dedicated test account.
- `RATIOS_TENANT_ID` — leave blank at first; get it by authenticating once and calling
  `GET /functions/v1/api/tenants` (Postman's "List Tenants" request does this for you).

`.env` is git-ignored — never commit it.

## 2. Postman setup

1. Open Postman → **Import** → select both files in `postman/`:
   - `Ratios_API.postman_collection.json`
   - `Ratios_API.postman_environment.json`
2. Select the **"Ratios API - Sandbox"** environment (top-right environment picker).
3. Fill in the environment's secret values (`apikey`, `email`, `password`) directly in Postman
   — don't paste them into the collection itself, and don't commit an environment export that
   has real values filled in.
4. Run **01 - Authentication → Get JWT Token**. Its Tests script writes `access_token`/
   `refresh_token` into the environment automatically; every other request in the collection
   uses `{{access_token}}` via the collection-level Bearer auth, so no manual copying is needed.
5. Run **01 - Authentication → List Tenants** and copy the right `tenant_id` into the
   environment.
6. Work through the folders in order (`02 - Clients`, `03 - Tasks`, `04 - Users`,
   `05 - Partner OAuth2`) per `TESTING_PLAN.md`.

**Headless/CI runs** (optional, once the collection is stable):
```bash
npm install -g newman
newman run postman/Ratios_API.postman_collection.json \
  -e postman/Ratios_API.postman_environment.json \
  --env-var apikey=$RATIOS_API_KEY \
  --env-var email=$RATIOS_EMAIL \
  --env-var password=$RATIOS_PASSWORD \
  --env-var tenant_id=$RATIOS_TENANT_ID
```

## 3. Python setup

```bash
cd ratios-api-testing
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Run the test suite (reads `.env` from the folder above via `python-dotenv`):

```bash
cd python
pytest -v                     # everything, including tests that pre-check env vars and skip if unset
pytest -v -m "not writes"     # read-only smoke tests only -- safe to run anytime
pytest -v -m writes           # data-creating tests -- run deliberately, sandbox only
```

Tests are skipped automatically (not failed) if required `.env` values are missing, so it's
safe to run `pytest` before configuration is complete.

### Reference automation prototypes

`scripts/` contains standalone examples for the Phase 4 use cases, built on the same
`RatiosClient`:

```bash
python scripts/sync_clients_example.py                    # full client sync
python scripts/sync_clients_example.py --since 2026-01-01 # incremental sync
python scripts/create_task_example.py --client-id <uuid> --title "Review uploaded documents"
```

These are starting points for the real integration code, not finished production scripts —
add logging, error alerting, and idempotency checks (per `TESTING_PLAN.md` §4) before
scheduling them for real.

## 4. Folder layout

```
ratios-api-testing/
├── TESTING_PLAN.md          # full test plan (read this first)
├── README.md                # this file
├── .env.example              # copy to .env, fill in, never commit .env
├── requirements.txt
├── postman/
│   ├── Ratios_API.postman_collection.json
│   └── Ratios_API.postman_environment.json
├── python/
│   ├── ratios_client.py      # shared API client (auth, CRUD, pagination)
│   ├── conftest.py           # pytest fixtures (client, cleanup, test_prefix)
│   ├── pytest.ini
│   ├── test_auth.py          # Phase 0
│   ├── test_clients.py       # Phase 2
│   ├── test_tasks.py         # Phase 2
│   ├── test_users.py         # Phase 2
│   └── test_pagination_filtering.py  # Phase 3
└── scripts/
    ├── sync_clients_example.py   # Phase 4 prototype
    └── create_task_example.py    # Phase 4 prototype
```
