import type { Store } from '../../core/store.ts';
import { newId, now } from '../../core/store.ts';

/** A supplier->account mapping confirmed this many times becomes a learned rule. */
export const PROMOTE_AFTER = 2;

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Module 6 - record a confirmed/corrected coding and promote repeated ones into rules. */
export function learn(store: Store, args: {
  documentId: string; clientId: string; supplier: string; accountId: string; taxRateId?: string; corrected: boolean; userId: string;
}): void {
  store.feedback.push({ id: newId(), at: now(), ...args });
  const supplier = key(args.supplier);
  if (!supplier) return;
  const same = store.feedback.filter((f) => f.clientId === args.clientId && key(f.supplier) === supplier && f.accountId === args.accountId);
  const exists = [...store.rules.values()].some((r) => r.clientId === args.clientId && r.supplierMatch === supplier && r.accountId === args.accountId);
  if (same.length >= PROMOTE_AFTER && !exists) {
    const id = newId();
    store.rules.set(id, { id, clientId: args.clientId, supplierMatch: supplier, accountId: args.accountId, taxRateId: args.taxRateId, source: 'learned' });
  }
}
