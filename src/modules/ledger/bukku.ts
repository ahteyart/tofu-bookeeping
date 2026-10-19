import type { Account, Contact, TaxRate } from '../../core/types.ts';
import type { BillDraft, LedgerAdapter } from './adapter.ts';

/**
 * Bukku endpoint map. UNVERIFIED: developers.bukku.my was not reachable when this
 * was written. Confirm each path, the auth scheme and the payload/response shapes
 * against the official docs, then adjust ONLY this block and the mappers below.
 */
export const BUKKU_ENDPOINTS = {
  ping: '/accounts',
  accounts: '/accounts',
  taxCodes: '/tax_codes',
  contacts: '/contacts',
  purchaseBills: '/purchases/bills',
  files: '/files',
} as const;

export interface BukkuConfig {
  baseUrl: string;       // e.g. https://api.bukku.my  (TBD)
  subdomain: string;     // company subdomain
  accessToken: string;
  fetchImpl?: typeof fetch;
}

export class BukkuAdapter implements LedgerAdapter {
  private cfg: BukkuConfig;
  private f: typeof fetch;
  constructor(cfg: BukkuConfig) { this.cfg = cfg; this.f = cfg.fetchImpl ?? fetch; }

  private async call<T>(method: string, path: string, body?: unknown, query = ''): Promise<T> {
    const res = await this.f(`${this.cfg.baseUrl}${path}${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.cfg.accessToken}`,      // TBD: confirm scheme
        'Company-Subdomain': this.cfg.subdomain,               // TBD: confirm header
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`bukku ${method} ${path} -> ${res.status}`);
    return (await res.json()) as T;
  }

  /** TBD: follow Bukku's real pagination. */
  private async list<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page < 1000; page++) {
      const r = await this.call<{ data: T[] }>('GET', path, undefined, `?page=${page}`);
      if (!r.data?.length) break;
      out.push(...r.data);
    }
    return out;
  }

  async testConnection() { await this.call('GET', BUKKU_ENDPOINTS.ping); }

  async listAccounts(): Promise<Account[]> {
    return (await this.list<any>(BUKKU_ENDPOINTS.accounts)).map((a) => ({ id: String(a.id), code: String(a.code ?? ''), name: a.name, type: String(a.type ?? '') }));
  }
  async listTaxRates(): Promise<TaxRate[]> {
    return (await this.list<any>(BUKKU_ENDPOINTS.taxCodes)).map((t) => ({ id: String(t.id), name: t.name ?? t.code, rate: Number(t.rate ?? 0) }));
  }
  async listContacts(): Promise<Contact[]> {
    return (await this.list<any>(BUKKU_ENDPOINTS.contacts)).map((c) => ({ id: String(c.id), name: c.name ?? c.legal_name }));
  }

  async findBill(contactName: string, number: string, date: string): Promise<string | undefined> {
    const q = `?number=${encodeURIComponent(number)}&date=${date}&contact=${encodeURIComponent(contactName)}`;
    const r = await this.call<{ data: { id: string | number }[] }>('GET', BUKKU_ENDPOINTS.purchaseBills, undefined, q);
    return r.data?.[0] ? String(r.data[0].id) : undefined;
  }

  async createPurchaseBill(d: BillDraft): Promise<{ externalId: string }> {
    const payload = {                                           // TBD: map to Bukku's bill schema
      contact_id: d.contactId, tax_inclusive: d.taxInclusive ?? false /* TBD: Bukku's real field */, number: d.number, date: d.date, currency_code: d.currency,
      line_items: d.lines.map((l) => ({
        description: l.description, quantity: l.qty, unit_price: l.unitPrice,
        account_id: l.accountId, tax_code_id: l.taxRateId,
      })),
    };
    const r = await this.call<{ data?: { id: string | number }; id?: string | number }>('POST', BUKKU_ENDPOINTS.purchaseBills, payload);
    return { externalId: String(r.data?.id ?? r.id) };
  }

  async attachFile(externalId: string, filename: string, content: Buffer): Promise<void> {
    // TBD: Bukku likely needs multipart upload then link to the bill.
    await this.call('POST', BUKKU_ENDPOINTS.files, { filename, content_base64: content.toString('base64'), attach_to: externalId });
  }
}
