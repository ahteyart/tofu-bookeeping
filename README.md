# tofu-bookeeping

AI-assisted bookkeeping automation for accounting firms, modelled on Tofu (gotofu.com), targeting **Bukku** as the ledger.

```
Ingest -> Extract -> Code -> Review -> Post -> Reconcile
                       ^        |
                       +-Learn--+
```

## Run

```bash
npm install
npm test          # 18 tests
npm run typecheck
npm run demo      # shows a supplier becoming touchless after 2 confirmations
npm run serve     # API + review UI at http://localhost:3000 (fake ledger unless Bukku env vars set)
```

Server env (all optional):

| Var | Purpose |
|-----|---------|
| `PORT`, `DATA_FILE`, `UPLOAD_DIR` | listen port; JSON snapshot (default `data.json`); original-file folder (default `uploads/`) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first-run admin (password >= 10 chars; if unset one is generated and printed once) |
| `ANTHROPIC_API_KEY` (+ `CLAUDE_MODEL`) | enables PDF/image extraction with Claude; without it only pasted text/CSV works |
| `SERVICE_TOKEN` | optional all-firms bearer token for scripts; prefer user logins |
| `BUKKU_BASE_URL`, `BUKKU_SUBDOMAIN`, `BUKKU_TOKEN` | use the Bukku adapter instead of the fake ledger |

Users sign in with email + password (scrypt-hashed, 5-attempt lockout, 12h sessions). Every API call is scoped
to the caller's firm; another firm's data returns 404.

Requires Node >= 22.18 (runs TypeScript directly; no build step).

## Layout - one folder per module (`src/modules/`)

| # | Module | Folder | Status |
|---|--------|--------|--------|
| 1 | Firm & client management | `firm/` | done (no auth layer yet) |
| 2 | Ledger connector | `ledger/` | interface + sync + fake done; **Bukku adapter written against unverified endpoints** |
| 3 | Document ingestion | `ingestion/` | done (hash dedupe, plan limit); file upload/email-in not built |
| 4 | Extraction | `extraction/` | text parser + Claude PDF/image reader (**untested against the live API**) |
| 5 | Coding & classification | `coding/` | rules > learned > history, contact matching |
| 6 | Learning engine | `learning/` | promotes a mapping to a rule after 2 confirmations |
| 7 | Review workspace | `review/` | exception rules, queue, approve with corrections, reject (API only, no UI) |
| 8 | Posting | `posting/` | idempotent, retries, manual re-post |
| 9 | Bank reconciliation | `reconcile/` | amount + date-window matching |
| 10 | Reporting | `reporting/` | counts, automation rate, match rate |
| 11 | Audit | `audit/` | append-only log |
| 12 | Billing | `billing/` | plan limits and usage metering (no payments) |

`src/workflow/pipeline.ts` wires them: `process()` runs a document to either `posted` (touchless)
or `needs_review`; a human `approve()` then `postApproved()` finishes it.

## Known gaps

- **Bukku**: `src/modules/ledger/bukku.ts` has the structure, but endpoint paths, auth header, payloads and
  pagination are placeholders (`BUKKU_ENDPOINTS`, marked TBD) because developers.bukku.my was blocked in the build
  sandbox. Check them against the docs before connecting a real company. Tested only against a mocked transport.
- Storage is in-memory with a JSON snapshot (`core/persist.ts`), single process only; `db/schema.sql` is the intended Postgres model.
- Claude extraction is tested only against a mocked API; try it on real invoices before trusting it. Bank statements are CSV only.
- Accounts and tax codes come from the ledger cache; no UI yet to add users/clients (use the store/seed script).
- Uploaded files live on local disk; sessions are stored in plain text in the snapshot file (mode 600). Use HTTPS in front of the server.
- Docs: [docs/modules.md](docs/modules.md), [docs/bukku-connector.md](docs/bukku-connector.md).
