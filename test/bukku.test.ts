import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BukkuAdapter } from '../src/modules/ledger/bukku.ts';

test('BukkuAdapter sends auth headers and maps list responses (mock transport)', async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string> });
    const page = new URL(url).searchParams.get('page');
    return new Response(JSON.stringify({ data: page === '1' ? [{ id: 7, code: '6100', name: 'Utilities', type: 'expense' }] : [] }), { status: 200 });
  }) as unknown as typeof fetch;
  const b = new BukkuAdapter({ baseUrl: 'https://example.invalid', subdomain: 'demo', accessToken: 'tok', fetchImpl });
  const accounts = await b.listAccounts();
  assert.deepEqual(accounts, [{ id: '7', code: '6100', name: 'Utilities', type: 'expense' }]);
  assert.equal(seen[0].headers.Authorization, 'Bearer tok');
});

test('BukkuAdapter surfaces HTTP errors', async () => {
  const fetchImpl = (async () => new Response('no', { status: 401 })) as unknown as typeof fetch;
  const b = new BukkuAdapter({ baseUrl: 'https://example.invalid', subdomain: 'd', accessToken: 'x', fetchImpl });
  await assert.rejects(b.testConnection(), /401/);
});
