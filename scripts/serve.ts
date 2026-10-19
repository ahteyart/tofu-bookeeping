import { randomBytes } from 'node:crypto';
import { createApi } from '../src/api/server.ts';
import { LocalFileStore } from '../src/core/files.ts';
import { loadStore, saveStore } from '../src/core/persist.ts';
import { ClaudeExtractor, RoutingExtractor } from '../src/modules/extraction/claude.ts';
import { addClient, addUser, createFirm } from '../src/modules/firm/firm.ts';
import { setPassword } from '../src/modules/firm/auth.ts';
import { BukkuAdapter } from '../src/modules/ledger/bukku.ts';
import { FakeLedger } from '../src/modules/ledger/fake.ts';
import { syncLedger } from '../src/modules/ledger/sync.ts';

const env = process.env;
const file = env.DATA_FILE ?? 'data.json';
const store = loadStore(file);
const useBukku = !!(env.BUKKU_BASE_URL && env.BUKKU_SUBDOMAIN && env.BUKKU_TOKEN);
const ledger = useBukku
  ? new BukkuAdapter({ baseUrl: env.BUKKU_BASE_URL!, subdomain: env.BUKKU_SUBDOMAIN!, accessToken: env.BUKKU_TOKEN! })
  : new FakeLedger(
      [{ id: 'a-util', code: '6100', name: 'Utilities', type: 'expense' }, { id: 'a-off', code: '6200', name: 'Office Supplies', type: 'expense' }],
      [{ id: 't-sst', name: 'SST 8%', rate: 8 }, { id: 't-none', name: 'No tax', rate: 0 }],
      [{ id: 'c-tnb', name: 'Tenaga Nasional Berhad' }, { id: 'c-pop', name: 'Popular Bookstore' }],
    );

if (!store.firms.size) {
  const firm = createFirm(store, 'Demo Accounting');
  const admin = addUser(store, firm.id, env.ADMIN_EMAIL ?? 'admin@example.test', 'admin');
  const pw = env.ADMIN_PASSWORD ?? randomBytes(9).toString('base64url');
  setPassword(store, admin.id, pw);
  addClient(store, firm.id, 'Demo Client Sdn Bhd');
  console.log(env.ADMIN_PASSWORD ? `first run: created ${admin.email}` : `first run: sign in as ${admin.email} / ${pw}   (generated - shown once)`);
  saveStore(store, file);
}
for (const c of store.clients.values()) await syncLedger(store, c.id, ledger);

const vision = env.ANTHROPIC_API_KEY ? new ClaudeExtractor({ apiKey: env.ANTHROPIC_API_KEY, model: env.CLAUDE_MODEL }) : undefined;
const server = createApi(
  { store, extractor: new RoutingExtractor(vision), ledger, files: new LocalFileStore(env.UPLOAD_DIR ?? 'uploads') },
  { serviceToken: env.SERVICE_TOKEN, onChange: () => saveStore(store, file) },
);
const port = Number(env.PORT ?? 3000);
server.listen(port, () => console.log(`http://localhost:${port}  ledger=${useBukku ? 'bukku' : 'fake (in-memory)'}  pdf/image extraction=${vision ? 'claude' : 'OFF (set ANTHROPIC_API_KEY)'}`));
