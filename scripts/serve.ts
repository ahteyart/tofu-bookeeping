import { createApi } from '../src/api/server.ts';
import { loadStore, saveStore } from '../src/core/persist.ts';
import { HeuristicTextExtractor } from '../src/modules/extraction/extractor.ts';
import { addClient, addUser, createFirm } from '../src/modules/firm/firm.ts';
import { BukkuAdapter } from '../src/modules/ledger/bukku.ts';
import { FakeLedger } from '../src/modules/ledger/fake.ts';
import { syncLedger } from '../src/modules/ledger/sync.ts';

const file = process.env.DATA_FILE ?? 'data.json';
const store = loadStore(file);
const { BUKKU_BASE_URL, BUKKU_SUBDOMAIN, BUKKU_TOKEN } = process.env;
const useBukku = !!(BUKKU_BASE_URL && BUKKU_SUBDOMAIN && BUKKU_TOKEN);
const ledger = useBukku
  ? new BukkuAdapter({ baseUrl: BUKKU_BASE_URL!, subdomain: BUKKU_SUBDOMAIN!, accessToken: BUKKU_TOKEN! })
  : new FakeLedger(
      [{ id: 'a-util', code: '6100', name: 'Utilities', type: 'expense' }, { id: 'a-off', code: '6200', name: 'Office Supplies', type: 'expense' }],
      [{ id: 't-sst', name: 'SST 8%', rate: 8 }, { id: 't-none', name: 'No tax', rate: 0 }],
      [{ id: 'c-tnb', name: 'Tenaga Nasional Berhad' }, { id: 'c-pop', name: 'Popular Bookstore' }],
    );

if (!store.firms.size) {
  const firm = createFirm(store, 'Demo Accounting');
  addUser(store, firm.id, 'demo@example.test', 'accountant');
  addClient(store, firm.id, 'Demo Client Sdn Bhd');
}
for (const c of store.clients.values()) await syncLedger(store, c.id, ledger);

const server = createApi({ store, extractor: new HeuristicTextExtractor(), ledger }, { token: process.env.API_TOKEN, onChange: () => saveStore(store, file) });
const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`http://localhost:${port}  ledger=${useBukku ? 'bukku' : 'fake (in-memory)'}  auth=${process.env.API_TOKEN ? 'token' : 'OFF'}`));
