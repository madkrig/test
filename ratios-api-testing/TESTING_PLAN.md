# Ratios API — Test Plan

Purpose: validate the Ratios REST API for a **filesharing/client-portal integration** that will
lean heavily on automation — user sync, client sync, client creation, task creation, and
ongoing two-way sync. This plan covers what to test, in what order, and what to set up locally
(Postman + Python) to test it safely.

Companion files in this folder:
- `postman/` — Postman collection + environment
- `python/` — reusable API client + pytest test suite
- `README.md` — setup instructions for both

---

## 1. What we know about the API (from the docs provided)

- Base URL: `https://api.ratios.dk`
- Auth: Supabase-style — `POST /auth/v1/token?grant_type=password` returns a JWT, used as
  `Authorization: Bearer <token>`. Every request also needs a public `apikey` header.
- The authenticated user **must** have the `API-adgang` system role, or every call 403s.
- Every resource call requires `tenant_id` as a query param (except `GET /functions/v1/api/tenants`,
  which lists the tenants/roles the authenticated user belongs to).
- CRUD is uniform per resource: `GET /api/{resource}`, `POST /api/{resource}`,
  `PATCH /api/{resource}/{id}`, `DELETE /api/{resource}/{id}` (soft delete).
- Pagination: `page`, `per_page` (default 50, **max 200**).
- Filtering: `filter.<column>=<op>.<value>` (`eq, neq, gt, gte, lt, lte, like, ilike, is, in`).
- Ordering: `order_by`, `order_dir`.
- Field selection: `select=col1,col2`.
- ~40 resources are documented (clients, leads, invoices, tasks, projects, time_reg, profiles,
  departments, contracts, etc.) but the **Resources** doc only gives one example call per
  resource — no field lists, required-field lists, or enum values are documented. This is the
  single biggest gap and needs to be closed empirically (see §4).
- Special composite endpoint: `POST /profiles/create-user` creates auth user + profile + tenant
  membership in one call (admin/owner only) — this is almost certainly the endpoint for "user sync".
- Separate **Partner OAuth2** flow exists (`/partner-token-exchange`) for third-party integrations
  acting on behalf of a tenant admin, with `read` / `write` / `delete` scopes. This is a different
  auth model from the per-user JWT flow and matters if Ratios positions you as a registered
  "partner" rather than just an internal user with API access.

### Open questions to resolve with Ratios before/during testing
Ask these — they materially change the test plan and the automation design:
1. Is there a **sandbox/test tenant**, or do we test in a live tenant? (Strongly prefer sandbox.)
2. Are there **rate limits**? (Not documented — needs empirical discovery, see §7.)
3. Does the user-auth endpoint (`/auth/v1/token`) support `grant_type=refresh_token` the same way
   Supabase GoTrue normally does? Only the *partner* flow documents refresh explicitly.
4. Is there an **upsert** or dedup mechanism for `clients`/`leads`, or must our sync logic dedupe
   client-side (e.g. by `email`/CVR/company name) before POSTing? This matters a lot for "client sync".
5. What does **soft delete** actually do to `GET` list/detail responses — excluded by default,
   or returned with a `deleted_at`/`is_deleted` flag? Confirm before writing sync logic that reacts
   to deletions.
6. Are there **webhooks** for outbound sync (Ratios → us), or is polling the only option?
7. Full field lists / required fields / enum values (`status`, `role`, etc.) per resource — the
   docs' "Available Fields" sections are empty; get a schema dump or ask for OpenAPI/Postman
   collection from Ratios if one exists.
8. Whether the intended integration model is **per-user JWT** (a dedicated Ratios user with
   `API-adgang`) or **Partner OAuth2** (registered partner acting on behalf of tenant admins).
   This is a business decision, not just a technical one — see §8.

---

## 2. Test environment & account setup

- **Never test against a production tenant with real client data.** Request a sandbox/test tenant
  from Ratios (open question #1). If none exists, use a low-stakes real tenant and prefix every
  record you create with `ZZ_TEST_` or similar so it's identifiable and safe to bulk-clean.
- Create a **dedicated service account** for automated testing (e.g. `api-test@yourcompany.dk`),
  not a personal login. Have a Ratios admin grant it the `API-adgang` role.
  Also create a **second account without `API-adgang`** to test the 403 path deliberately.
- Have an admin/owner-role account available too, since `profiles/create-user` and some other
  writes require it — test with both an `admin` and a `member` role to confirm permission
  boundaries match the docs.
- Record and store, per environment (sandbox/prod):
  - `apikey` (public key — safe to store in repo config, still keep in env var for consistency)
  - test account email/password (secret — env var / password manager only)
  - `tenant_id` (get via `GET /api/tenants` after first login)
  - Partner `client_id`/`client_secret` if/when testing the OAuth2 partner flow (secret)

## 3. Secrets & credential hygiene (best practice)

- `.env` file, **never committed** (`.gitignore` already covers it in this folder).
- Postman: store secrets in an **Environment**, not the collection; mark `password`,
  `client_secret`, `access_token`, `refresh_token` as type **secret** so Postman masks them and
  excludes them from "share collection" exports.
- Rotate the test account password and partner `client_secret` if either is ever pasted into a
  chat, ticket, or shared doc — `client_secret` is shown only once by design.
- Don't log full JWTs or `client_secret` values in CI output; if you must log for debugging,
  truncate (`token[:8] + "…"`).

## 4. Test phases

### Phase 0 — Connectivity & auth smoke test
- Get a JWT with valid credentials → 200 + token.
- Get a JWT with wrong password → expect 400/401 (confirm exact code/shape).
- Call any resource without the `apikey` header → expect 401/403 (confirm).
- Call any resource with a valid JWT but a user **lacking `API-adgang`** → expect 403 (confirm
  this is enforced per-request, not just at login).
- Call `GET /api/tenants` → confirm it's the only endpoint that doesn't need `tenant_id`, and
  returns the expected `tenant_id`/`role` pairs.
- Call any resource with a `tenant_id` the user does **not** belong to → expect 403.

### Phase 1 — Resource discovery (fills the doc gap)
For each resource you'll actually automate (start with: `clients`, `profiles`, `tasks`, plus
lookup tables `task_statuses`, `task_types`, `task_priorities`, `departments`):
- `GET` with `per_page=1` and no filters, inspect the full JSON shape of one record to build a
  real field list (docs don't provide one).
- Try `POST` with an intentionally incomplete body → capture the validation error shape (field
  names, error format) so the sync code can parse it.
- Try `POST` with a full body → confirm which fields round-trip vs. are ignored/server-generated
  (`id`, `created_at`, `tenant_id`, etc.).
- Try `PATCH` with a partial body → confirm partial update semantics (only sent fields change).
- Try `DELETE` then `GET` the same id, and `GET` the list → confirm soft-delete visibility
  behavior (open question #5). Check if there's a `filter.deleted_at=is.null`-style way to
  exclude/include soft-deleted rows.

### Phase 2 — CRUD correctness per core resource
Run full create → read → update → delete cycles for the resources central to the use cases:
- **Clients** (`clients`): create, list+filter (by `city`, `company_name`), update, soft-delete,
  confirm uniqueness/dedup behavior on repeated creates with the same identifying fields.
- **Users/Profiles** (`profiles`, `profiles/create-user`): create a user with profile in one call,
  confirm `send_welcome_email` behavior (test with `false` in automated runs to avoid spamming
  real inboxes), list profiles, confirm sensitive fields (SSN) are hidden as documented, update
  role, and — if supported — deactivate/remove a user from a tenant.
- **Tasks** (`tasks`): create (after first pulling valid `task_statuses`/`task_types`/
  `task_priorities`/assignee ids so foreign keys are valid), update status/deadline, list+filter+
  order, delete.
- **Projects** (`projects`) and **Client Contact Persons** since they're likely needed alongside
  client sync (a client often needs a contact person attached).

### Phase 3 — Filtering, pagination, ordering, field selection
- Every operator (`eq, neq, gt, gte, lt, lte, like, ilike, is, in`) against at least one field of
  the right type (string, date, number, null).
- `per_page` boundary: 1, 50 (default), 200 (max, should succeed), 201 (should be rejected or
  clamped — confirm which).
- `page` beyond the last page → confirm empty `data` array, not an error.
- Combine multiple `filter.*` params (implicit AND?) — confirm.
- `order_by` + `order_dir=asc/desc` on a date and a string field.
- `select=id,...` → confirm only requested fields are returned, and that `id` is safe to omit if
  not requested (you'll usually need it, so include it explicitly).
- Confirm the `pagination` object shape returned alongside `data` (total count, total pages?) —
  needed to build a "walk all pages" sync loop reliably.

### Phase 4 — Automation-shaped use cases (the actual point of this integration)
These are scripted, end-to-end flows mirroring what production automation will do:
- **Full client sync**: paginate through *all* `clients` (and `leads` if in scope), page by page,
  until `pagination` says no more pages; measure time and record count for capacity planning.
- **Incremental client sync**: use `filter.updated_at=gte.<last_sync_timestamp>` (confirm the
  field is actually called `updated_at` from Phase 1) to pull only changed records; this is the
  pattern production polling will use if no webhooks exist.
- **Client creation from an external event**: simulate "new client signs up on our filesharing
  site" → POST to `clients`, then POST a linked `contact_persons` + `client_contact_persons` row,
  confirm the relationship reads back correctly.
- **User sync**: simulate "new staff member added internally" → `profiles/create-user`, then
  confirm the created user can itself authenticate and is scoped to the right tenant.
- **Task creation from an external trigger**: create a task against a real client with a valid
  status/type/priority/assignee, confirm it shows up correctly in list views with expected
  filters (e.g. `filter.client_id=eq....`).
- **Idempotency check**: run the same "create client" automation twice with the same input →
  document whether you get a duplicate, a conflict error, or an update. This determines whether
  your sync code needs to check-before-create.

### Phase 5 — Error handling & resilience
- 401 on expired/invalid token → confirm shape, build re-auth logic around it.
- 403 on wrong tenant / missing role / insufficient scope (partner flow).
- 404 on unknown resource id.
- 422/400 on validation errors → confirm the app can parse the error body to log something
  actionable, not just "request failed."
- Network-level: timeouts, connection resets — confirm retry-with-backoff is safe (i.e., is the
  API idempotent enough that a retried POST after a timeout won't double-create? Test explicitly —
  likely not idempotent, so design safe retries around GET/PATCH/DELETE and check-before-create
  for POST).
- Rate limiting — send a burst of requests and observe (open question #2); if a `429` with
  `Retry-After` appears, build backoff around it; if nothing documented shows up, still throttle
  client-side out of courtesy and to avoid getting flagged/blocked.

### Phase 6 — Partner OAuth2 flow (only if that's the intended integration model)
- Full authorization code flow end-to-end with a real tenant admin consenting.
- `state` param round-trip / CSRF check.
- Token exchange, then call a resource with the partner access token.
- Refresh flow — confirm old refresh token is rotated/revoked as documented (try reusing it →
  should fail).
- Introspection (`action: validate`) — confirm returned `tenant_id`/`scopes` match the grant.
- Scope enforcement — request `read` only, then attempt a `POST` → expect 403; confirm `delete`
  really is gated separately from `write`.
- Revocation — revoke the grant from the tenant admin UI, confirm the access token stops working
  immediately (not just at next expiry).

### Phase 7 — Non-functional
- Concurrency: two sync jobs (e.g. client sync + task sync) running at once against the same
  tenant — confirm no cross-interference, no unexpected locking errors.
- Data volume: if the sandbox/test tenant can hold enough rows, test pagination performance at
  realistic scale (hundreds–thousands of clients) before relying on it in production sync jobs.
- Clock/timezone handling on date filters (`billing_date`, `start_time`, etc.) — confirm whether
  the API expects UTC or local time, and what format (`YYYY-MM-DD` vs full ISO 8601 with offset).

---

## 5. Tooling to set up locally

### Postman
- Use it for **exploratory/manual** testing during Phase 0–3 (discovering real field shapes,
  poking at edge cases) and as living documentation of confirmed request/response shapes.
- Collection + environment provided in `postman/`. Environment variables: `base_url`, `apikey`,
  `tenant_id`, `email`, `password`, `access_token`, `refresh_token`.
- The login request's **Tests** tab auto-writes `access_token`/`refresh_token` into the active
  environment, so subsequent requests just work — no manual copy/paste of tokens.
- For CI, the same collection can be run headlessly with **Newman**
  (`newman run postman/Ratios_API.postman_collection.json -e postman/Ratios_API.postman_environment.json`)
  once secrets are supplied via `--env-var` or a CI-only environment file.

### Python
- Use it for the **repeatable, scripted** test suite (Phases 0–5) and as the basis for the actual
  production sync scripts later — testing and production automation should share the same client
  library so what you validate in tests is what runs in prod.
- `python/ratios_client.py` — small `requests`-based client: handles the `apikey`/`Authorization`
  headers, login, generic CRUD, and a `paginate()` generator that walks all pages of a resource.
- `python/test_*.py` — `pytest` suite covering Phases 0–3 with real assertions; data-creating
  tests clean up after themselves (soft-delete what they created).
- See `README.md` in this folder for exact setup commands (venv, `pip install -r requirements.txt`,
  `.env`, running `pytest`).

### Best practices applied in both
- Config via environment variables / `.env`, never hardcoded — same test code runs against
  sandbox or prod tenant by swapping `.env`.
- All test-created records use a recognizable naming prefix (`ZZ_QA_` / `pytest-<uuid>`) so they
  can be found and purged even if a test crashes before cleanup runs.
- Assert on **status code + response shape**, not just "did it 200" — catches silent schema drift.
- Treat `DELETE` responses as soft-delete verification, not just "no error" — assert the expected
  visibility behavior once Phase 1 confirms it.
- Keep write-tests (`POST`/`PATCH`/`DELETE`) clearly separated (folder/marker) from read-only
  tests, so read-only smoke tests can run frequently/safely (e.g. in CI on a schedule) without
  risk of mutating tenant data, while write tests are run deliberately against the sandbox only.

## 6. Suggested execution order

1. Manual pass in Postman through Phase 0 and Phase 1 for `clients`, `profiles`, `tasks` — get
   real field shapes and error formats, resolve open questions #3, #5, #7 empirically.
2. Encode confirmed behavior into the Python client (`ratios_client.py`) and pytest suite.
3. Run Phase 2–3 pytest suite against the sandbox tenant; fix client/tests as real behavior
   diverges from docs.
4. Write and run the Phase 4 use-case scripts (`scripts/` — client sync, user sync, task
   creation) — these double as prototypes for the production automation.
5. Phase 5 resilience tests once the happy paths are solid.
6. Phase 6 only if/when the Partner OAuth2 model is confirmed as the integration approach (§8).
7. Phase 7 before go-live, at realistic data volume.

## 7. Rate limit discovery (since undocumented)

Run a small controlled burst (e.g. 20 requests in 5 seconds against a cheap `GET` endpoint) from
the Python suite and log status codes + any `Retry-After`/`X-RateLimit-*` headers. Do this against
the sandbox, not production, and stop immediately if you see `429`s or errors — report findings
back into this doc and to Ratios support rather than guessing.

## 8. Per-user JWT vs. Partner OAuth2 — decide before building production sync

- **Per-user JWT** (what most of this plan assumes): simplest to set up, ties automation to one
  service-account user's permissions, access token is short-lived (need to confirm refresh
  behavior — open question #3), and if that user is ever disabled the automation breaks. Fine for
  a single-tenant internal integration.
- **Partner OAuth2**: proper machine-to-machine model with documented refresh, scoped
  `read`/`write`/`delete` grants, and tenant-admin-controlled revocation — the right choice if
  you'll eventually connect **multiple tenants'** Ratios accounts to your filesharing platform, or
  want tenant admins to control access without sharing a login. Requires being registered as a
  partner by a Ratios superadmin first.

Given the stated goal ("filesharing site for clients" with "extended use of the API" across
multiple use cases), lean toward clarifying with Ratios whether Partner OAuth2 is available/
appropriate now, even if initial testing uses the simpler per-user JWT flow.
