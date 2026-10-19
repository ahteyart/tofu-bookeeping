import type { Coding, LineCoding } from '../../core/types.ts';
import { must, type Store } from '../../core/store.ts';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Module 5 - map an extraction to contact + account + tax. Rules > learned > history. */
export function codeDocument(store: Store, documentId: string): Coding {
  const doc = must(store.documents.get(documentId), 'document');
  const ex = must(store.extractions.get(documentId), 'extraction');
  const cache = must(store.ledgerCache.get(doc.clientId), 'ledger cache (run syncLedger first)');
  const supplier = norm(ex.supplier);

  // Contact: exact name = 1.0, containment = 0.8, none = 0.
  let contactId: string | undefined; let contactConfidence = 0;
  for (const c of cache.contacts) {
    const n = norm(c.name);
    const score = n === supplier ? 1 : supplier && (n.includes(supplier) || supplier.includes(n)) ? 0.8 : 0;
    if (score > contactConfidence) { contactId = c.id; contactConfidence = score; }
  }

  const rule = [...store.rules.values()]
    .filter((r) => r.clientId === doc.clientId && supplier.includes(r.supplierMatch))
    .sort((a, b) => (a.source === 'manual' ? -1 : 1) - (b.source === 'manual' ? -1 : 1))[0];

  // History: most frequent account used for this supplier on approved docs.
  const counts = new Map<string, { n: number; taxRateId?: string }>();
  for (const f of store.feedback) {
    if (f.clientId === doc.clientId && norm(f.supplier) === supplier) {
      const e = counts.get(f.accountId) ?? { n: 0, taxRateId: f.taxRateId };
      counts.set(f.accountId, { n: e.n + 1, taxRateId: f.taxRateId ?? e.taxRateId });
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0];

  const lineFor = (): LineCoding => {
    if (rule) return { accountId: rule.accountId, taxRateId: rule.taxRateId, confidence: rule.source === 'manual' ? 0.98 : 0.92, source: rule.source === 'manual' ? 'rule' : 'learned' };
    if (top) return { accountId: top[0], taxRateId: top[1].taxRateId, confidence: Math.min(0.85, 0.6 + 0.1 * top[1].n), source: 'history' };
    return { confidence: 0, source: 'none' };
  };
  const lines = ex.lines.map(lineFor);
  const confidence = Math.min(ex.confidence, contactConfidence, ...lines.map((l) => l.confidence));
  const coding: Coding = { documentId, contactId, contactConfidence, lines, confidence };
  store.codings.set(documentId, coding);
  return coding;
}
