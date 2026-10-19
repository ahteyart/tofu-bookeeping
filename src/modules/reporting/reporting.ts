import type { Store } from '../../core/store.ts';

/** Module 10 - dashboard numbers per client (or whole store when clientId omitted). */
export function summary(store: Store, clientId?: string) {
  const docs = [...store.documents.values()].filter((d) => d.kind !== 'bank_statement' && (!clientId || d.clientId === clientId));
  const by = (s: string) => docs.filter((d) => d.status === s).length;
  const posted = docs.filter((d) => d.status === 'posted');
  const touchless = posted.filter((d) => d.autoApproved).length;
  const lines = [...store.bankLines.values()].filter((l) => !clientId || l.clientId === clientId);
  return {
    documents: docs.length,
    posted: posted.length,
    needsReview: by('needs_review'),
    failed: by('failed'),
    rejected: by('rejected'),
    automationRate: posted.length ? touchless / posted.length : 0,
    bankLines: lines.length,
    bankMatched: lines.filter((l) => l.matchedPostingId).length,
  };
}
