import type { Account, Contact, TaxRate } from '../../core/types.ts';

export interface BillDraft {
  contactId?: string; contactName: string; number: string; date: string; currency: string;
  lines: { description: string; qty: number; unitPrice: number; accountId: string; taxRateId?: string }[];
}

/** Module 2 - provider-agnostic ledger interface. Bukku is the first implementation. */
export interface LedgerAdapter {
  testConnection(): Promise<void>;
  listAccounts(): Promise<Account[]>;
  listTaxRates(): Promise<TaxRate[]>;
  listContacts(): Promise<Contact[]>;
  /** Used for idempotency: returns the external id if the bill already exists. */
  findBill(contactName: string, number: string, date: string): Promise<string | undefined>;
  createPurchaseBill(draft: BillDraft): Promise<{ externalId: string }>;
  attachFile(externalId: string, filename: string, content: Buffer): Promise<void>;
}
