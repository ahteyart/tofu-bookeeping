import type { BankLine, Document, Extraction } from '../../core/types.ts';

/** Module 4 - extraction contract. Swap in an OCR/LLM-backed implementation in production. */
export interface Extractor {
  /** `file` holds the raw bytes for uploaded PDFs/images. */
  extractDocument(doc: Document, file?: Buffer): Promise<Extraction>;
}

const field = (text: string, label: string) =>
  new RegExp(`^\\s*${label}\\s*[:=]\\s*(.+)$`, 'im').exec(text)?.[1]?.trim();
const num = (s?: string) => (s ? Number(s.replace(/[^0-9.\-]/g, '')) : NaN);

/**
 * Parses OCR'd text with labelled fields:
 *   Supplier: / Invoice No: / Date: (YYYY-MM-DD) / Currency: / Tax: / Total:
 *   item lines as `description | qty | unit price`
 * Confidence reflects how many required fields were found and whether lines sum to the total.
 */
export class HeuristicTextExtractor implements Extractor {
  async extractDocument(doc: Document, _file?: Buffer): Promise<Extraction> {
    const t = doc.content;
    const supplier = field(t, 'supplier') ?? '';
    const docNumber = field(t, '(?:invoice|receipt|doc)(?: no\\.?| number)?') ?? '';
    const docDate = field(t, 'date') ?? '';
    const currency = (field(t, 'currency') ?? 'MYR').toUpperCase();
    const taxTotal = num(field(t, 'tax')) || 0;
    const total = num(field(t, 'total'));

    const lines = t.split('\n').filter((l) => l.split('|').length === 3).map((l) => {
      const [description, qty, price] = l.split('|').map((x) => x.trim());
      const q = num(qty), p = num(price);
      return { description, qty: q, unitPrice: p, amount: Math.round(q * p * 100) / 100 };
    }).filter((l) => !Number.isNaN(l.amount));

    const required = [supplier, docNumber, docDate, Number.isNaN(total) ? '' : 'x', lines.length ? 'x' : ''];
    let confidence = required.filter(Boolean).length / required.length;
    const sum = lines.reduce((s, l) => s + l.amount, 0) + taxTotal;
    if (!Number.isNaN(total) && Math.abs(sum - total) > 0.01) confidence = Math.min(confidence, 0.5);
    return { documentId: doc.id, supplier, docNumber, docDate, currency, total: Number.isNaN(total) ? 0 : total, taxTotal, lines, confidence };
  }
}

/** Bank statement CSV: `date,description,amount` with a header row. */
export function parseBankStatement(doc: Document, newId: () => string): BankLine[] {
  return doc.content.split('\n').slice(1).filter((l) => l.trim()).map((l) => {
    const [date, description, amount] = l.split(',').map((x) => x.trim());
    return { id: newId(), clientId: doc.clientId, documentId: doc.id, date, description, amount: Number(amount) };
  });
}
