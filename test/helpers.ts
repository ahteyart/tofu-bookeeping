import { Store } from '../src/core/store.ts';
import { HeuristicTextExtractor } from '../src/modules/extraction/extractor.ts';
import { FakeLedger } from '../src/modules/ledger/fake.ts';
import { syncLedger } from '../src/modules/ledger/sync.ts';
import { addClient, addUser, createFirm } from '../src/modules/firm/firm.ts';
import type { Deps } from '../src/workflow/pipeline.ts';

export async function setup() {
  const store = new Store();
  const ledger = new FakeLedger(
    [{ id: 'a-util', code: '6100', name: 'Utilities', type: 'expense' }, { id: 'a-off', code: '6200', name: 'Office Supplies', type: 'expense' }],
    [{ id: 't-sst', name: 'SST 8%', rate: 8 }, { id: 't-none', name: 'No tax', rate: 0 }],
    [{ id: 'c-tnb', name: 'Tenaga Nasional Berhad' }, { id: 'c-pop', name: 'Popular Bookstore' }],
  );
  const firm = createFirm(store, 'Acme Accounting');
  const user = addUser(store, firm.id, 'a@acme.test', 'accountant');
  const client = addClient(store, firm.id, 'Kedai Runcit Sdn Bhd');
  await syncLedger(store, client.id, ledger);
  const deps: Deps = { store, extractor: new HeuristicTextExtractor(), ledger };
  return { store, ledger, firm, user, client, deps };
}

export const invoice = (o: { supplier: string; no: string; date?: string; price?: number; tax?: number; total?: number }) => {
  const price = o.price ?? 100, tax = o.tax ?? 0;
  return `Supplier: ${o.supplier}\nInvoice No: ${o.no}\nDate: ${o.date ?? '2026-10-01'}\nCurrency: MYR\nOffice stuff | 1 | ${price}\nTax: ${tax}\nTotal: ${o.total ?? price + tax}\n`;
};
