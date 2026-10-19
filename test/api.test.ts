import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApi } from '../src/api/server.ts';
import { loadStore, saveStore } from '../src/core/persist.ts';
import { ClaudeExtractor, RoutingExtractor } from '../src/modules/extraction/claude.ts';
import { addUser, createFirm } from '../src/modules/firm/firm.ts';
import { setPassword } from '../src/modules/firm/auth.ts';
import { queue } from '../src/modules/review/review.ts';
import { process } from '../src/workflow/pipeline.ts';
import { invoice, setup } from './helpers.ts';

async function start() {
  const s = await setup();
  const server = createApi(s.deps);
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const raw = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await raw(method, path, body, headers);
    return { status: res.status, body: await res.json() as any };
  };
  const loginAs = async (email: string, password: string) => ((await call('POST', '/api/login', { email, password })).body.token as string | undefined);
  const auth = async () => ({ Authorization: `Bearer ${await loginAs(s.user.email, 'correct horse battery')}` });
  return { ...s, server, call, raw, loginAs, auth, base };
}

test('API: submit -> review queue -> approve posts to ledger (as the logged-in user)', async () => {
  const { client, user, ledger, store, server, call, auth } = await start();
  const h = await auth();
  const sub = await call('POST', `/api/clients/${client.id}/documents`, { kind: 'invoice', filename: 'a.txt', content: invoice({ supplier: 'Popular Bookstore', no: 'P-1' }) }, h);
  assert.equal(sub.body.status, 'needs_review');
  const q = await call('GET', `/api/clients/${client.id}/review`, undefined, h);
  assert.equal(q.body.length, 1);
  assert.equal(q.body[0].document.content, undefined);
  const ok = await call('POST', `/api/review/${q.body[0].id}/approve`, { lines: [{ accountId: 'a-off' }] }, h);
  assert.equal(ok.body.status, 'posted');
  assert.equal(ledger.bills.size, 1);
  assert.equal((await call('POST', `/api/review/${q.body[0].id}/approve`, {}, h)).status, 409);
  assert.ok(store.audit.some((a) => a.action === 'review.approved' && a.actor === user.id));
  assert.equal((await call('GET', `/api/clients/${client.id}/summary`, undefined, h)).body.posted, 1);
  server.close();
});

test('API: auth required, bad logins rejected and locked out, validation and 404', async () => {
  const { client, user, server, call, auth, loginAs } = await start();
  assert.equal((await call('GET', '/api/clients')).status, 401);
  assert.equal((await call('GET', '/api/clients', undefined, { Authorization: 'Bearer nope' })).status, 401);
  assert.equal((await call('POST', '/api/login', { email: user.email, password: 'wrong wrong wrong' })).status, 401);
  assert.equal((await call('POST', '/api/login', { email: 'nobody@x.test', password: 'whatever whatever' })).status, 401);
  const h = await auth();
  assert.equal((await call('POST', `/api/clients/${client.id}/documents`, { kind: 'nope', filename: 'a', content: 'x' }, h)).status, 400);
  assert.equal((await call('GET', '/api/nothing', undefined, h)).status, 404);
  assert.equal((await call('POST', '/api/clients/missing/documents', { kind: 'invoice', filename: 'a', content: 'x' }, h)).status, 404);
  for (let i = 0; i < 5; i++) await loginAs(user.email, 'bad bad bad bad');
  assert.equal((await call('POST', '/api/login', { email: user.email, password: 'correct horse battery' })).status, 429);
  server.close();
});

test('API: tenant isolation - another firm cannot see or touch this firm\'s data', async () => {
  const { store, client, deps, call, server } = await start();
  const other = createFirm(store, 'Other Firm');
  const mallory = addUser(store, other.id, 'm@other.test', 'admin');
  setPassword(store, mallory.id, 'mallory mallory 1');
  const doc = await process(deps, client.id, 'invoice', 'a.txt', invoice({ supplier: 'Popular Bookstore', no: 'P-3' }));
  const itemId = [...store.reviewItems.keys()][0];
  const h = { Authorization: `Bearer ${(await call('POST', '/api/login', { email: 'm@other.test', password: 'mallory mallory 1' })).body.token}` };
  assert.deepEqual((await call('GET', '/api/clients', undefined, h)).body, []);
  for (const [m, p] of [['GET', `/api/clients/${client.id}/review`], ['GET', `/api/clients/${client.id}/summary`], ['GET', `/api/clients/${client.id}/documents`],
    ['GET', `/api/documents/${doc.id}/file`], ['GET', `/api/documents/${doc.id}/audit`], ['POST', `/api/review/${itemId}/approve`], ['POST', `/api/review/${itemId}/reject`],
    ['POST', `/api/documents/${doc.id}/retry`], ['POST', `/api/clients/${client.id}/sync`], ['POST', `/api/clients/${client.id}/reconcile`]] as const) {
    assert.equal((await call(m, p, m === 'POST' ? {} : undefined, h)).status, 404, `${m} ${p}`);
  }
  assert.equal((await call('POST', `/api/clients/${client.id}/documents`, { kind: 'invoice', filename: 'a', content: 'x' }, h)).status, 404);
  server.close();
});

test('API: PDF upload is extracted by Claude (mock), stored, viewable, and posted with the original attached', async () => {
  const s = await start();
  const pdf = Buffer.from('%PDF-1.4 fake bytes');
  let sentModel = '';
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    const req = JSON.parse(String(init.body));
    sentModel = req.model;
    assert.equal(req.messages[0].content[0].type, 'document');
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', input: {
      supplier: 'Tenaga Nasional Berhad', docNumber: 'PDF-1', docDate: '2026-10-02', currency: 'MYR', taxTotal: 0, total: 120,
      lines: [{ description: 'Electricity', qty: 1, unitPrice: 120 }], legibility: 0.99 } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  s.deps.extractor = new RoutingExtractor(new ClaudeExtractor({ apiKey: 'k', fetchImpl }));
  const h = await s.auth();
  // learn a rule first so the PDF goes touchless
  s.store.rules.set('r', { id: 'r', clientId: s.client.id, supplierMatch: 'tenaga nasional berhad', accountId: 'a-util', taxRateId: 't-none', source: 'manual' });

  const up = await s.call('POST', `/api/clients/${s.client.id}/documents`, { kind: 'invoice', filename: 'bill.pdf', mediaType: 'application/pdf', contentBase64: pdf.toString('base64') }, h);
  assert.equal(up.body.status, 'posted');
  assert.equal(sentModel, 'claude-sonnet-5-5');
  assert.equal(s.ledger.bills.size, 1);
  assert.deepEqual([...s.ledger.bills.values()][0].files, ['bill.pdf']);
  const file = await s.raw('GET', `/api/documents/${up.body.id}/file`, undefined, h);
  assert.equal(file.headers.get('content-type'), 'application/pdf');
  assert.match(file.headers.get('content-security-policy') ?? '', /sandbox/);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), pdf);
  assert.equal((await s.call('POST', `/api/clients/${s.client.id}/documents`, { kind: 'invoice', filename: 'x', mediaType: 'text/html', contentBase64: 'PGI+' }, h)).status, 400);
  s.server.close();
});

test('Claude extraction: arithmetic mismatch lowers confidence, API errors fail the document and can be retried', async () => {
  const s = await start();
  const h = await s.auth();
  let mode: 'bad-math' | 'down' | 'ok' = 'bad-math';
  const fetchImpl = (async () => {
    if (mode === 'down') return new Response('x', { status: 529 });
    const total = mode === 'bad-math' ? 999 : 50;
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', input: { supplier: 'Popular Bookstore', docNumber: 'Z1', docDate: '2026-10-03', currency: 'MYR', total, taxTotal: 0,
      lines: [{ description: 'Books', qty: 1, unitPrice: 50 }], legibility: 1 } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  s.deps.extractor = new RoutingExtractor(new ClaudeExtractor({ apiKey: 'k', fetchImpl }));
  const body = { kind: 'invoice', filename: 'z.png', mediaType: 'image/png', contentBase64: Buffer.from('png-bytes').toString('base64') };

  const a = await s.call('POST', `/api/clients/${s.client.id}/documents`, body, h);
  assert.equal(a.body.status, 'needs_review');
  assert.match(queue(s.store)[0].reasons.join('|'), /low extraction confidence/);

  const s2 = await start();
  const h2 = await s2.auth();
  mode = 'down';
  s2.deps.extractor = new RoutingExtractor(new ClaudeExtractor({ apiKey: 'k', fetchImpl }));
  const failed = await s2.call('POST', `/api/clients/${s2.client.id}/documents`, body, h2);
  assert.equal(failed.body.status, 'failed');
  assert.match(failed.body.error, /529/);
  mode = 'ok';
  const retried = await s2.call('POST', `/api/clients/${s2.client.id}/documents`, body, h2);   // same bytes: re-submission retries
  assert.equal(retried.body.id, failed.body.id);
  assert.equal(retried.body.status, 'needs_review');
  s.server.close(); s2.server.close();
});

test('file upload without a configured vision extractor fails clearly', async () => {
  const s = await start();
  s.deps.extractor = new RoutingExtractor();
  const r = await s.call('POST', `/api/clients/${s.client.id}/documents`, { kind: 'invoice', filename: 'a.pdf', mediaType: 'application/pdf', contentBase64: 'JVBERg==' }, await s.auth());
  assert.equal(r.body.status, 'failed');
  assert.match(r.body.error, /ANTHROPIC_API_KEY/);
  s.server.close();
});

test('persistence round-trips the store', async () => {
  const { store, client, deps } = await setup();
  await process(deps, client.id, 'invoice', 'p.txt', invoice({ supplier: 'Popular Bookstore', no: 'P-2' }));
  const file = join(mkdtempSync(join(tmpdir(), 'tofu-')), 'data.json');
  saveStore(store, file);
  const back = loadStore(file);
  assert.equal(back.documents.size, 1);
  assert.equal(back.clients.get(client.id)?.name, client.name);
  assert.equal(back.reviewItems.size, 1);
});

function receiptApi(input: Record<string, unknown>, seen: { prompt?: string } = {}) {
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    seen.prompt = JSON.parse(String(init.body)).messages[0].content[1].text;
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', input }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return new RoutingExtractor(new ClaudeExtractor({ apiKey: 'k', fetchImpl }));
}
const photo = (name: string) => ({ kind: 'receipt', filename: name, mediaType: 'image/jpeg', contentBase64: Buffer.from(name).toString('base64') });

test('receipt: no printed number and tax-inclusive prices are handled without a false alarm', async () => {
  const s = await start(); const h = await s.auth();
  const seen: { prompt?: string } = {};
  s.deps.extractor = receiptApi({ supplier: 'Popular Bookstore', docNumber: '', docDate: '2026-10-12', currency: 'MYR', total: 53.0, taxTotal: 3.0, pricesIncludeTax: true,
    lines: [{ description: 'A4 paper', qty: 2, unitPrice: 20 }, { description: 'Pens', qty: 1, unitPrice: 13 }], legibility: 0.97 }, seen);
  s.store.rules.set('r', { id: 'r', clientId: s.client.id, supplierMatch: 'popular bookstore', accountId: 'a-off', taxRateId: 't-sst', source: 'manual' });
  const r = await s.call('POST', `/api/clients/${s.client.id}/documents`, photo('till.jpg'), h);
  assert.equal(r.body.status, 'posted');                       // no review needed
  const ex = s.store.extractions.get(r.body.id)!;
  assert.match(ex.docNumber, /^R-[0-9a-f]{10}$/);
  assert.equal(ex.pricesIncludeTax, true);
  assert.match(seen.prompt ?? '', /retail\/till receipt/);
  assert.equal([...s.ledger.bills.values()][0].taxInclusive, true);
  s.server.close();
});

test('receipt: total only becomes one line; the same photo twice posts once; arithmetic errors still go to review', async () => {
  const s = await start(); const h = await s.auth();
  s.deps.extractor = receiptApi({ supplier: 'Popular Bookstore', docNumber: '', docDate: '2026-10-13', currency: 'MYR', total: 24.5, lines: [], legibility: 0.95 });
  s.store.rules.set('r', { id: 'r', clientId: s.client.id, supplierMatch: 'popular bookstore', accountId: 'a-off', source: 'manual' });
  const a = await s.call('POST', `/api/clients/${s.client.id}/documents`, photo('only-total.jpg'), h);
  assert.equal(a.body.status, 'posted');
  assert.deepEqual(s.store.extractions.get(a.body.id)!.lines.map((l) => l.amount), [24.5]);
  const again = await s.call('POST', `/api/clients/${s.client.id}/documents`, photo('only-total.jpg'), h);
  assert.equal(again.body.id, a.body.id);
  assert.equal(s.ledger.bills.size, 1);

  s.deps.extractor = receiptApi({ supplier: 'Popular Bookstore', docNumber: '', docDate: '2026-10-13', currency: 'MYR', total: 99, taxTotal: 0, pricesIncludeTax: false,
    lines: [{ description: 'Pens', qty: 1, unitPrice: 10 }], legibility: 1 });
  const bad = await s.call('POST', `/api/clients/${s.client.id}/documents`, photo('bad-math.jpg'), h);
  assert.equal(bad.body.status, 'needs_review');
  s.server.close();
});

test('invoice without a number is still flagged (receipt leniency does not leak)', async () => {
  const s = await start(); const h = await s.auth();
  s.deps.extractor = receiptApi({ supplier: 'Popular Bookstore', docNumber: '', docDate: '2026-10-13', currency: 'MYR', total: 10, taxTotal: 0,
    lines: [{ description: 'Pens', qty: 1, unitPrice: 10 }], legibility: 1 });
  s.store.rules.set('r', { id: 'r', clientId: s.client.id, supplierMatch: 'popular bookstore', accountId: 'a-off', source: 'manual' });
  const r = await s.call('POST', `/api/clients/${s.client.id}/documents`, { ...photo('inv.jpg'), kind: 'invoice' }, h);
  assert.equal(r.body.status, 'needs_review');
  s.server.close();
});
