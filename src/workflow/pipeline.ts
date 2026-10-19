import type { DocKind, Document } from '../core/types.ts';
import { must, type Store } from '../core/store.ts';
import { record } from '../modules/audit/audit.ts';
import { codeDocument } from '../modules/coding/coding.ts';
import type { Extractor } from '../modules/extraction/extractor.ts';
import { ingest } from '../modules/ingestion/ingest.ts';
import type { LedgerAdapter } from '../modules/ledger/adapter.ts';
import { postDocument } from '../modules/posting/posting.ts';
import { loadStatement } from '../modules/reconcile/reconcile.ts';
import { exceptionsFor, openReview } from '../modules/review/review.ts';

export interface Deps { store: Store; extractor: Extractor; ledger: LedgerAdapter; }

/**
 * Orchestrates:  received -> extracted -> coded -> (needs_review | approved) -> posted | failed
 * Bank statements bypass coding and are loaded as lines for reconciliation.
 * After a human approves a review item, call `postApproved` to finish the flow.
 */
export async function process(deps: Deps, clientId: string, kind: DocKind, filename: string, content: string): Promise<Document> {
  const { store, extractor, ledger } = deps;
  const { doc, duplicate } = ingest(store, clientId, kind, filename, content);
  if (duplicate) return doc;

  if (kind === 'bank_statement') {
    loadStatement(store, doc.id);
    doc.status = 'posted';                     // nothing to push to the ledger
    return doc;
  }

  store.extractions.set(doc.id, await extractor.extractDocument(doc));
  doc.status = 'extracted';
  codeDocument(store, doc.id);
  doc.status = 'coded';

  const reasons = exceptionsFor(store, doc.id);
  if (reasons.length) { openReview(store, doc.id, reasons); return doc; }

  doc.autoApproved = true; doc.status = 'approved';
  record(store, 'system', 'document.auto_approved', 'document', doc.id);
  await postDocument(store, doc.id, ledger);
  return doc;
}

/** Post a document a human has approved (or retry a failed one). */
export async function postApproved(deps: Deps, documentId: string) {
  must(deps.store.documents.get(documentId), 'document');
  return postDocument(deps.store, documentId, deps.ledger);
}
