import { must, now, type Store } from '../../core/store.ts';
import { record } from '../audit/audit.ts';
import type { LedgerAdapter } from './adapter.ts';

/** Pull accounts, tax rates and contacts into the per-client cache. */
export async function syncLedger(store: Store, clientId: string, ledger: LedgerAdapter): Promise<void> {
  must(store.clients.get(clientId), 'client');
  const [accounts, taxRates, contacts] = await Promise.all([ledger.listAccounts(), ledger.listTaxRates(), ledger.listContacts()]);
  store.ledgerCache.set(clientId, { accounts, taxRates, contacts, syncedAt: now() });
  record(store, 'system', 'ledger.sync', 'client', clientId, { accounts: accounts.length, taxRates: taxRates.length, contacts: contacts.length });
}
