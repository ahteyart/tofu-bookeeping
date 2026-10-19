import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approve, queue } from '../src/modules/review/review.ts';
import { PROMOTE_AFTER } from '../src/modules/learning/learning.ts';
import { reconcile } from '../src/modules/reconcile/reconcile.ts';
import { summary } from '../src/modules/reporting/reporting.ts';
import { usageFor, PLAN_LIMITS } from '../src/modules/billing/billing.ts';
import { postApproved, process } from '../src/workflow/pipeline.ts';
import { invoice, setup } from './helpers.ts';

test('new supplier goes to review, approval posts, learning promotes a rule, then touchless', async () => {
  const { store, ledger, client, user, deps } = await setup();

  // 1st & 2nd invoices: no history -> manual review (no account suggestion)
  for (const n of ['INV-1', 'INV-2']) {
    const doc = await process(deps, client.id, 'invoice', `${n}.txt`, invoice({ supplier: 'Tenaga Nasional Berhad', no: n }));
    assert.equal(doc.status, 'needs_review');
    const [item] = queue(store, client.id);
    // first time: no suggestion at all; second: history only (below threshold), still reviewed
    assert.ok(item.reasons.some((r) => (n === 'INV-1' ? r.includes('no account suggestion') : r.includes('low coding confidence'))));
    approve(store, item.id, user.id, { lines: [{ accountId: 'a-util', taxRateId: 't-none' }] });
    const p = await postApproved(deps, doc.id);
    assert.equal(p.status, 'posted');
  }
  assert.equal(ledger.bills.size, 2);
  assert.ok([...store.rules.values()].some((r) => r.source === 'learned'), `rule learned after ${PROMOTE_AFTER} confirmations`);

  // 3rd: learned rule applies, auto-approved and posted with no human
  const doc3 = await process(deps, client.id, 'invoice', 'INV-3.txt', invoice({ supplier: 'Tenaga Nasional Berhad', no: 'INV-3' }));
  assert.equal(doc3.status, 'posted');
  assert.equal(doc3.autoApproved, true);
  assert.equal(ledger.bills.size, 3);
  assert.equal(summary(store, client.id).automationRate, 1 / 3);
});

test('duplicate upload is ignored', async () => {
  const { store, client, deps } = await setup();
  const text = invoice({ supplier: 'Popular Bookstore', no: 'P-1' });
  const a = await process(deps, client.id, 'invoice', 'a.txt', text);
  const b = await process(deps, client.id, 'invoice', 'b.txt', text);
  assert.equal(a.id, b.id);
  assert.equal(store.documents.size, 1);
});

test('totals mismatch and unknown supplier are flagged', async () => {
  const { client, deps, store } = await setup();
  const doc = await process(deps, client.id, 'invoice', 'x.txt', invoice({ supplier: 'Unknown Co', no: 'U-1', total: 999 }));
  assert.equal(doc.status, 'needs_review');
  const reasons = queue(store)[0].reasons.join('|');
  assert.match(reasons, /low extraction confidence/);
  assert.match(reasons, /supplier not found/);
});

test('posting retries transient failures and never double-posts', async () => {
  const { store, ledger, client, user, deps } = await setup();
  const doc = await process(deps, client.id, 'invoice', 'r.txt', invoice({ supplier: 'Popular Bookstore', no: 'P-9' }));
  approve(store, queue(store)[0].id, user.id, { lines: [{ accountId: 'a-off', taxRateId: 't-none' }] });
  ledger.failNext = 2;
  const p = await postApproved(deps, doc.id);
  assert.equal(p.status, 'posted');
  assert.equal(p.attempts, 3);
  await postApproved(deps, doc.id);
  assert.equal(ledger.bills.size, 1);
});

test('posting gives up after max attempts and marks failed', async () => {
  const { store, ledger, client, user, deps } = await setup();
  const doc = await process(deps, client.id, 'invoice', 'f.txt', invoice({ supplier: 'Popular Bookstore', no: 'P-8' }));
  approve(store, queue(store)[0].id, user.id, { lines: [{ accountId: 'a-off' }] });
  ledger.failNext = 10;
  const p = await postApproved(deps, doc.id);
  assert.equal(p.status, 'failed');
  assert.equal(store.documents.get(doc.id)!.status, 'failed');
});

test('bank reconciliation matches payments to posted bills', async () => {
  const { store, client, user, deps } = await setup();
  const doc = await process(deps, client.id, 'invoice', 'b.txt', invoice({ supplier: 'Popular Bookstore', no: 'P-5', price: 250 }));
  approve(store, queue(store)[0].id, user.id, { lines: [{ accountId: 'a-off' }] });
  await postApproved(deps, doc.id);

  const stmt = await process(deps, client.id, 'bank_statement', 'oct.csv',
    'date,description,amount\n2026-10-03,POPULAR BOOKSTORE,-250.00\n2026-10-04,UNKNOWN,-12.00\n');
  assert.equal(store.documents.get(stmt.id)!.kind, 'bank_statement');
  const r = reconcile(store, client.id);
  assert.equal(r.matched, 1);
  assert.equal(r.unmatched.length, 1);
});

test('plan limit blocks ingestion and usage is metered', async () => {
  const { store, firm, client, deps } = await setup();
  for (let i = 0; i < PLAN_LIMITS.starter; i++) await process(deps, client.id, 'invoice', `${i}.txt`, invoice({ supplier: 'Popular Bookstore', no: `N-${i}` }));
  assert.equal(usageFor(store, firm.id), PLAN_LIMITS.starter);
  await assert.rejects(process(deps, client.id, 'invoice', 'over.txt', invoice({ supplier: 'Popular Bookstore', no: 'OVER' })), /plan limit/);
});

test('audit trail records the approval', async () => {
  const { store, client, user, deps } = await setup();
  const doc = await process(deps, client.id, 'invoice', 'a.txt', invoice({ supplier: 'Popular Bookstore', no: 'A-1' }));
  approve(store, queue(store)[0].id, user.id, { lines: [{ accountId: 'a-off' }] });
  assert.ok(store.audit.some((a) => a.entityId === doc.id && a.action === 'review.approved' && a.actor === user.id));
});

test('a failed posting can be retried manually', async () => {
  const { store, ledger, client, user, deps } = await setup();
  const doc = await process(deps, client.id, 'invoice', 'm.txt', invoice({ supplier: 'Popular Bookstore', no: 'P-7' }));
  approve(store, queue(store)[0].id, user.id, { lines: [{ accountId: 'a-off' }] });
  ledger.failNext = 3;
  assert.equal((await postApproved(deps, doc.id)).status, 'failed');
  assert.equal((await postApproved(deps, doc.id)).status, 'posted');
  assert.equal(ledger.bills.size, 1);
});
