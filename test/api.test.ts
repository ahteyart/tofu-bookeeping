import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApi } from '../src/api/server.ts';
import { loadStore, saveStore } from '../src/core/persist.ts';
import { invoice, setup } from './helpers.ts';

async function start(token?: string) {
  const s = await setup();
  const server = createApi(s.deps, { token });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() as any };
  };
  return { ...s, server, call };
}

test('API: submit -> review queue -> approve posts to ledger', async () => {
  const { client, ledger, server, call } = await start();
  const sub = await call('POST', `/api/clients/${client.id}/documents`, { kind: 'invoice', filename: 'a.txt', content: invoice({ supplier: 'Popular Bookstore', no: 'P-1' }) });
  assert.equal(sub.body.status, 'needs_review');
  const q = await call('GET', `/api/clients/${client.id}/review`);
  assert.equal(q.body.length, 1);
  assert.ok(q.body[0].accounts.length > 0);
  const ok = await call('POST', `/api/review/${q.body[0].id}/approve`, { lines: [{ accountId: 'a-off' }] });
  assert.equal(ok.body.status, 'posted');
  assert.equal(ledger.bills.size, 1);
  assert.equal((await call('POST', `/api/review/${q.body[0].id}/approve`, {})).status, 409);
  assert.equal((await call('GET', `/api/clients/${client.id}/summary`)).body.posted, 1);
  server.close();
});

test('API: validation, 404 and auth', async () => {
  const { client, server, call } = await start('secret');
  assert.equal((await call('GET', '/api/clients')).status, 401);
  const h = { Authorization: 'Bearer secret' };
  assert.equal((await call('POST', `/api/clients/${client.id}/documents`, { kind: 'nope', filename: 'a', content: 'x' }, h)).status, 400);
  assert.equal((await call('GET', '/api/nothing', undefined, h)).status, 404);
  assert.equal((await call('POST', '/api/clients/missing/documents', { kind: 'invoice', filename: 'a', content: 'x' }, h)).status, 404);
  const page = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
  assert.match(await page.text(), /Tofu Bookkeeping/);
  server.close();
});

test('persistence round-trips the store', async () => {
  const { store, client, deps } = await setup();
  const { process } = await import('../src/workflow/pipeline.ts');
  await process(deps, client.id, 'invoice', 'p.txt', invoice({ supplier: 'Popular Bookstore', no: 'P-2' }));
  const file = join(mkdtempSync(join(tmpdir(), 'tofu-')), 'data.json');
  saveStore(store, file);
  const back = loadStore(file);
  assert.equal(back.documents.size, 1);
  assert.equal(back.clients.get(client.id)?.name, client.name);
  assert.equal(back.reviewItems.size, 1);
});
