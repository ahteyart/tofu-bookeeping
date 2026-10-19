import type { Coding, ReviewItem } from '../../core/types.ts';
import { must, newId, type Store } from '../../core/store.ts';
import { record } from '../audit/audit.ts';
import { learn } from '../learning/learning.ts';

/** Module 7 - why a document cannot be auto-approved. Empty = clean. */
export function exceptionsFor(store: Store, documentId: string): string[] {
  const doc = must(store.documents.get(documentId), 'document');
  const ex = must(store.extractions.get(documentId), 'extraction');
  const coding = must(store.codings.get(documentId), 'coding');
  const client = must(store.clients.get(doc.clientId), 'client');
  const reasons: string[] = [];
  if (ex.confidence < client.autoApproveThreshold) reasons.push(`low extraction confidence (${ex.confidence.toFixed(2)})`);
  if (!coding.contactId) reasons.push('supplier not found in ledger');
  else if (coding.contactConfidence < 1) reasons.push('supplier matched approximately');
  coding.lines.forEach((l, i) => { if (!l.accountId) reasons.push(`line ${i + 1}: no account suggestion`); });
  if (coding.confidence < client.autoApproveThreshold) reasons.push(`low coding confidence (${coding.confidence.toFixed(2)})`);
  if (ex.currency !== client.baseCurrency) reasons.push(`foreign currency ${ex.currency}`);
  return reasons;
}

export function openReview(store: Store, documentId: string, reasons: string[]): ReviewItem {
  const doc = must(store.documents.get(documentId), 'document');
  const item: ReviewItem = { id: newId(), documentId, clientId: doc.clientId, reasons, status: 'open' };
  store.reviewItems.set(item.id, item);
  doc.status = 'needs_review';
  record(store, 'system', 'review.opened', 'document', documentId, { reasons });
  return item;
}

export const queue = (store: Store, clientId?: string) =>
  [...store.reviewItems.values()].filter((r) => r.status === 'open' && (!clientId || r.clientId === clientId));

export interface Correction { contactId?: string; lines?: { accountId?: string; taxRateId?: string }[]; }

/** Approve (optionally with corrections). Feeds the learning engine. */
export function approve(store: Store, reviewId: string, userId: string, correction: Correction = {}): void {
  const item = must(store.reviewItems.get(reviewId), 'review item');
  const doc = must(store.documents.get(item.documentId), 'document');
  const ex = must(store.extractions.get(doc.id), 'extraction');
  const coding = must(store.codings.get(doc.id), 'coding');
  const corrected = !!correction.contactId || !!correction.lines;

  if (correction.contactId) { coding.contactId = correction.contactId; coding.contactConfidence = 1; }
  correction.lines?.forEach((c, i) => {
    if (coding.lines[i]) coding.lines[i] = { ...coding.lines[i], ...c, confidence: 1, source: 'rule' };
  });
  for (const l of coding.lines) {
    if (!l.accountId) throw new Error('every line needs an account before approval');
  }
  if (!coding.contactId) throw new Error('a ledger contact is required before approval');

  // Learn from the first line (document-level supplier pattern).
  const first = coding.lines[0];
  learn(store, { documentId: doc.id, clientId: doc.clientId, supplier: ex.supplier, accountId: first.accountId!, taxRateId: first.taxRateId, corrected, userId });

  item.status = 'resolved'; item.resolvedBy = userId;
  doc.status = 'approved';
  record(store, userId, 'review.approved', 'document', doc.id, { corrected });
}

export function reject(store: Store, reviewId: string, userId: string, reason: string): void {
  const item = must(store.reviewItems.get(reviewId), 'review item');
  const doc = must(store.documents.get(item.documentId), 'document');
  item.status = 'resolved'; item.resolvedBy = userId;
  doc.status = 'rejected'; doc.error = reason;
  record(store, userId, 'review.rejected', 'document', doc.id, { reason });
}
export type { Coding };
