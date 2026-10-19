import type { Posting } from '../../core/types.ts';
import { must, newId, now, type Store } from '../../core/store.ts';
import { record } from '../audit/audit.ts';
import type { FileStore } from '../../core/files.ts';
import type { LedgerAdapter } from '../ledger/adapter.ts';

export const MAX_ATTEMPTS = 3;

/**
 * Module 8 - post an approved document to the ledger.
 * Idempotent: a stable key per document, plus a ledger-side lookup before create,
 * so retries never double-post.
 */
export async function postDocument(store: Store, documentId: string, ledger: LedgerAdapter, files?: FileStore): Promise<Posting> {
  const doc = must(store.documents.get(documentId), 'document');
  const ex = must(store.extractions.get(documentId), 'extraction');
  const coding = must(store.codings.get(documentId), 'coding');

  const key = `doc:${documentId}`;
  let p = [...store.postings.values()].find((x) => x.idempotencyKey === key);
  if (p?.status === 'posted') return p;
  if (doc.status !== 'approved' && doc.status !== 'failed') throw new Error(`cannot post a ${doc.status} document`);
  p ??= { id: newId(), documentId, clientId: doc.clientId, idempotencyKey: key, status: 'pending', attempts: 0, total: ex.total, docDate: ex.docDate, supplier: ex.supplier };
  if (p.status === 'failed') p.attempts = 0; // manual retry gets a fresh budget
  store.postings.set(p.id, p);

  while (p.attempts < MAX_ATTEMPTS) {
    p.attempts++;
    try {
      let externalId = await ledger.findBill(ex.supplier, ex.docNumber, ex.docDate);
      if (!externalId) {
        ({ externalId } = await ledger.createPurchaseBill({
          contactId: coding.contactId, contactName: ex.supplier, number: ex.docNumber, date: ex.docDate, currency: ex.currency, taxInclusive: ex.pricesIncludeTax,
          lines: ex.lines.map((l, i) => ({ description: l.description, qty: l.qty, unitPrice: l.unitPrice, accountId: coding.lines[i].accountId!, taxRateId: coding.lines[i].taxRateId })),
        }));
      }
      await ledger.attachFile(externalId, doc.filename, doc.filePath && files ? files.get(doc.filePath) : Buffer.from(doc.content));
      Object.assign(p, { status: 'posted', externalId, postedAt: now(), error: undefined });
      doc.status = 'posted';
      record(store, 'system', 'posting.posted', 'document', documentId, { externalId, attempts: p.attempts });
      return p;
    } catch (e) {
      p.error = (e as Error).message;
    }
  }
  p.status = 'failed'; doc.status = 'failed'; doc.error = p.error;
  record(store, 'system', 'posting.failed', 'document', documentId, { error: p.error });
  return p;
}
