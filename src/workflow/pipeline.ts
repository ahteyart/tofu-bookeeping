import type { DocKind, Document } from '../core/types.ts';
import type { FileStore } from '../core/files.ts';
import { must, type Store } from '../core/store.ts';
import { record } from '../modules/audit/audit.ts';
import { codeDocument } from '../modules/coding/coding.ts';
import type { Extractor } from '../modules/extraction/extractor.ts';
import { ingest, type Upload } from '../modules/ingestion/ingest.ts';
import type { LedgerAdapter } from '../modules/ledger/adapter.ts';
import { postDocument } from '../modules/posting/posting.ts';
import { loadStatement } from '../modules/reconcile/reconcile.ts';
import { exceptionsFor, openReview } from '../modules/review/review.ts';

export interface Deps { store: Store; extractor: Extractor; ledger: LedgerAdapter; files?: FileStore; }

/**
 * Orchestrates:  received -> extracted -> coded -> (needs_review | approved) -> posted | failed
 * Bank statements bypass coding and are loaded as lines for reconciliation.
 * After a human approves a review item, call `postApproved` to finish the flow.
 */
export interface FileInput { bytes: Buffer; mediaType: string; }

export async function process(deps: Deps, clientId: string, kind: DocKind, filename: string, content: string, file?: FileInput): Promise<Document> {
  const { store, extractor, ledger } = deps;
  let upload: Upload | undefined;
  if (file) {
    if (kind === 'bank_statement') throw new Error('bank statements must be uploaded as CSV text');
    if (!deps.files) throw new Error('file storage is not configured');
    upload = { ...file, filePath: '' };
  }
  const { doc, duplicate } = ingest(store, clientId, kind, filename, content, 'system', upload);
  // a document whose extraction failed may be re-submitted to retry
  if (duplicate && !(doc.status === 'failed' && !store.extractions.has(doc.id))) return doc;
  if (file && !doc.filePath) doc.filePath = deps.files!.put(clientId, filename, file.bytes);

  if (kind === 'bank_statement') {
    loadStatement(store, doc.id);
    doc.status = 'posted';                     // nothing to push to the ledger
    return doc;
  }

  try {
    store.extractions.set(doc.id, await extractor.extractDocument(doc, file?.bytes));
  } catch (e) {
    doc.status = 'failed'; doc.error = (e as Error).message;
    record(store, 'system', 'extraction.failed', 'document', doc.id, { error: doc.error });
    return doc;
  }
  doc.status = 'extracted';
  codeDocument(store, doc.id);
  doc.status = 'coded';

  const reasons = exceptionsFor(store, doc.id);
  if (reasons.length) { openReview(store, doc.id, reasons); return doc; }

  doc.autoApproved = true; doc.status = 'approved';
  record(store, 'system', 'document.auto_approved', 'document', doc.id);
  await postDocument(store, doc.id, ledger, deps.files);
  return doc;
}

/** Post a document a human has approved (or retry a failed one). */
export async function postApproved(deps: Deps, documentId: string) {
  must(deps.store.documents.get(documentId), 'document');
  return postDocument(deps.store, documentId, deps.ledger, deps.files);
}
