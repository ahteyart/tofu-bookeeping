import type { BankLine } from '../../core/types.ts';
import { newId, type Store } from '../../core/store.ts';
import { parseBankStatement } from '../extraction/extractor.ts';
import { record } from '../audit/audit.ts';

const DAY = 86_400_000;
export const DATE_WINDOW_DAYS = 7;

/** Module 9 - load statement lines and match payments (negative amounts) to posted bills. */
export function loadStatement(store: Store, documentId: string): BankLine[] {
  const lines = parseBankStatement(store.documents.get(documentId)!, newId);
  lines.forEach((l) => store.bankLines.set(l.id, l));
  return lines;
}

export function reconcile(store: Store, clientId: string): { matched: number; unmatched: BankLine[] } {
  const taken = new Set([...store.bankLines.values()].map((l) => l.matchedPostingId).filter(Boolean));
  const open = [...store.postings.values()].filter((p) => p.clientId === clientId && p.status === 'posted' && !taken.has(p.id));
  const unmatched: BankLine[] = []; let matched = 0;

  for (const line of [...store.bankLines.values()].filter((l) => l.clientId === clientId && !l.matchedPostingId)) {
    const hit = line.amount < 0 && open.find((p) =>
      Math.abs(Math.abs(line.amount) - p.total) < 0.005 &&
      Math.abs(Date.parse(line.date) - Date.parse(p.docDate)) <= DATE_WINDOW_DAYS * DAY);
    if (hit) {
      line.matchedPostingId = hit.id; open.splice(open.indexOf(hit), 1); matched++;
      record(store, 'system', 'bank.matched', 'bank_line', line.id, { postingId: hit.id });
    } else unmatched.push(line);
  }
  return { matched, unmatched };
}
