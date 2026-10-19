import type { Account, Contact, TaxRate } from '../../core/types.ts';
import type { BillDraft, LedgerAdapter } from './adapter.ts';

/** In-memory ledger for dev and tests. `failNext` simulates transient outages. */
export class FakeLedger implements LedgerAdapter {
  bills = new Map<string, BillDraft & { files: string[] }>();
  failNext = 0;
  accounts: Account[];
  taxRates: TaxRate[];
  contacts: Contact[];
  constructor(accounts: Account[] = [], taxRates: TaxRate[] = [], contacts: Contact[] = []) {
    this.accounts = accounts; this.taxRates = taxRates; this.contacts = contacts;
  }
  async testConnection() {}
  async listAccounts() { return this.accounts; }
  async listTaxRates() { return this.taxRates; }
  async listContacts() { return this.contacts; }
  async findBill(contactName: string, number: string, date: string) {
    for (const [id, b] of this.bills) if (b.contactName === contactName && b.number === number && b.date === date) return id;
    return undefined;
  }
  async createPurchaseBill(draft: BillDraft) {
    if (this.failNext > 0) { this.failNext--; throw new Error('ledger unavailable'); }
    const externalId = `fake-${this.bills.size + 1}`;
    this.bills.set(externalId, { ...draft, files: [] });
    return { externalId };
  }
  async attachFile(externalId: string, filename: string) { this.bills.get(externalId)?.files.push(filename); }
}
