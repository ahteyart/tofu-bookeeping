-- Starter schema (PostgreSQL). Draft.
create table firm   (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz default now());
create table app_user (id uuid primary key default gen_random_uuid(), firm_id uuid references firm, email text unique not null, role text not null check (role in ('admin','accountant','reviewer')));
create table client (id uuid primary key default gen_random_uuid(), firm_id uuid references firm, name text not null, base_currency char(3) not null, auto_approve_threshold numeric(3,2) default 0.95);

create table ledger_connection (id uuid primary key default gen_random_uuid(), client_id uuid references client, provider text not null default 'bukku', external_tenant_id text, subdomain text, access_token_enc bytea, status text default 'active');
create table account  (id uuid primary key default gen_random_uuid(), client_id uuid references client, code text, name text, type text, external_id text);
create table tax_rate (id uuid primary key default gen_random_uuid(), client_id uuid references client, name text, rate numeric(6,3), external_id text);
create table contact  (id uuid primary key default gen_random_uuid(), client_id uuid references client, name text, external_id text);

create table document (
  id uuid primary key default gen_random_uuid(), client_id uuid references client,
  kind text not null check (kind in ('invoice','receipt','bank_statement')),
  source text, storage_path text not null, sha256 text not null,
  status text not null default 'received' check (status in ('received','extracted','coded','needs_review','approved','posted','failed')),
  created_at timestamptz default now(), unique (client_id, sha256));
create table extraction (id uuid primary key default gen_random_uuid(), document_id uuid references document, language text, supplier text, doc_number text, doc_date date, currency char(3), total numeric(14,2), tax_total numeric(14,2), confidence numeric(3,2), raw jsonb);
create table extracted_line (id uuid primary key default gen_random_uuid(), extraction_id uuid references extraction, description text, qty numeric, unit_price numeric(14,2), amount numeric(14,2));

create table coding_rule (id uuid primary key default gen_random_uuid(), client_id uuid references client, match jsonb not null, account_id uuid references account, tax_rate_id uuid references tax_rate, contact_id uuid references contact, source text default 'manual');
create table suggestion (id uuid primary key default gen_random_uuid(), extracted_line_id uuid references extracted_line, account_id uuid references account, tax_rate_id uuid references tax_rate, contact_id uuid references contact, confidence numeric(3,2));
create table feedback_event (id uuid primary key default gen_random_uuid(), suggestion_id uuid references suggestion, accepted boolean, corrected_to jsonb, user_id uuid references app_user, created_at timestamptz default now());

create table posting (id uuid primary key default gen_random_uuid(), document_id uuid references document, external_id text, status text default 'pending', error text, idempotency_key text unique, posted_at timestamptz);
create table bank_line (id uuid primary key default gen_random_uuid(), document_id uuid references document, line_date date, description text, amount numeric(14,2), matched_posting_id uuid references posting);
create table audit_log (id bigserial primary key, firm_id uuid, actor uuid, action text, entity text, entity_id uuid, detail jsonb, at timestamptz default now());
create table usage_record (id bigserial primary key, firm_id uuid references firm, period date, docs_processed int);
