# Module design (draft)

> Source note: derived from public Xero App Store descriptions of Tofu (gotofu.com was not
> reachable when drafting). Validate against the real product before building.

## Core flow

```
Ingest -> Extract -> Code/Classify -> Review -> Post -> Reconcile
              ^                          |
              +------ Learning <---------+
```

## Modules

| # | Module | Responsibility | Key entities |
|---|--------|----------------|--------------|
| 1 | **Firm & Client Management** | Firm (tenant), staff users/roles, client companies, per-client settings (base currency, tax regime, coding rules). | firm, user, client |
| 2 | **Ledger Connector** | Two-way sync with the accounting system (Xero first; pluggable adapter). Pull chart of accounts, tax rates, currencies, contacts. Push bills, expenses, bank statement lines. | ledger_connection, account, tax_rate, contact |
| 3 | **Document Ingestion** | Upload / email-in / API intake of invoices, receipts, bank statements (PDF, image, CSV). Dedupe by hash, store originals. | document, document_source |
| 4 | **Extraction (OCR/AI)** | Multilingual (200+ languages) field extraction: supplier, date, number, currency, line items, tax, totals; confidence scores. Bank statement parsing to lines. | extraction, extracted_line |
| 5 | **Coding & Classification** | Map extracted data to contact, account, tax rate, tracking category. Rules first, ML suggestion second, with confidence. | coding_rule, suggestion |
| 6 | **Learning Engine** | Learns from approved/corrected transactions and historical ledger data per client; promotes repeated corrections into rules. | feedback_event, learned_pattern |
| 7 | **Review Workspace** | Queue of items by confidence/exception, side-by-side document vs. proposed entry, bulk approve, comments, audit trail. | review_item, comment |
| 8 | **Posting** | Create bill/expense/bank transaction in ledger, attach source file, idempotent retries, error handling. | posting, posting_error |
| 9 | **Bank Reconciliation Assist** | Match statement lines to posted bills/expenses; flag unmatched. | bank_line, match |
| 10 | **Reporting & Dashboard** | Throughput, automation rate, time saved, exceptions, per-client status. | (views) |
| 11 | **Audit & Security** | Immutable activity log, RBAC, encryption, data retention per firm. | audit_log |
| 12 | **Billing & Admin** | Plans, usage metering (docs processed), invoices to firms. | plan, usage_record |

## Suggested build order (MVP)

1. Firm/Client + Ledger Connector (read-only sync)
2. Ingestion + Extraction
3. Coding + Review Workspace
4. Posting
5. Learning, Reconciliation, Reporting, Billing

## Document state machine

`received -> extracted -> coded -> needs_review | auto_approved -> approved -> posted | failed`

Auto-approve only when extraction and coding confidence both exceed a per-client threshold.

## Open questions

- Ledgers beyond Xero (QuickBooks, MYOB)? Drives the adapter interface.
- Auto-post vs. always-human-approve default?
- Where does the extraction model run (hosted API vs. self-hosted)?
