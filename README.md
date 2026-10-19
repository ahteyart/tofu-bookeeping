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
npm test          # 11 tests
npm run typecheck
npm run demo      # shows a supplier becoming touchless after 2 confirmations
```

Requires Node >= 22.18 (runs TypeScript directly; no build step).

## Layout - one folder per module (`src/modules/`)

| # | Module | Folder | Status |
|---|--------|--------|--------|
| 1 | Firm & client management | `firm/` | done (no auth layer yet) |
| 2 | Ledger connector | `ledger/` | interface + sync + fake done; **Bukku adapter written against unverified endpoints** |
| 3 | Document ingestion | `ingestion/` | done (hash dedupe, plan limit); file upload/email-in not built |
| 4 | Extraction | `extraction/` | text heuristic extractor; **plug in OCR/LLM via `Extractor`** |
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
- Storage is in-memory (`core/store.ts`); `db/schema.sql` is the intended Postgres model.
- No HTTP API, UI, file storage, auth, or real OCR yet.
- Docs: [docs/modules.md](docs/modules.md), [docs/bukku-connector.md](docs/bukku-connector.md).
