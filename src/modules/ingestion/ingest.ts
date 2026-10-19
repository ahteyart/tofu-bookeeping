import { createHash } from 'node:crypto';
import type { DocKind, Document } from '../../core/types.ts';
import { must, newId, now, type Store } from '../../core/store.ts';
import { assertWithinPlan, meter } from '../billing/billing.ts';
import { record } from '../audit/audit.ts';

/** Module 3 - intake. Dedupes by content hash per client and enforces plan limits. */
export function ingest(store: Store, clientId: string, kind: DocKind, filename: string, content: string, actor = 'system'): { doc: Document; duplicate: boolean } {
  const client = must(store.clients.get(clientId), 'client');
  const sha256 = createHash('sha256').update(content).digest('hex');
  for (const d of store.documents.values()) {
    if (d.clientId === clientId && d.sha256 === sha256) return { doc: d, duplicate: true };
  }
  assertWithinPlan(store, client.firmId);
  const doc: Document = { id: newId(), clientId, kind, filename, sha256, content, status: 'received', autoApproved: false, createdAt: now() };
  store.documents.set(doc.id, doc);
  meter(store, client.firmId);
  record(store, actor, 'document.received', 'document', doc.id, { kind, filename });
  return { doc, duplicate: false };
}
