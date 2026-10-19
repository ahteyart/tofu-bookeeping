import type { Document, Extraction } from '../../core/types.ts';
import { HeuristicTextExtractor, type Extractor } from './extractor.ts';

const SUPPORTED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const TOOL = {
  name: 'record_document',
  description: 'Record the fields extracted from a supplier invoice or receipt.',
  input_schema: {
    type: 'object',
    properties: {
      supplier: { type: 'string', description: 'Legal/trading name of the issuing supplier' },
      docNumber: { type: 'string', description: 'Invoice, receipt or transaction number exactly as printed; empty string if none is printed' },
      docDate: { type: 'string', description: 'Issue date, YYYY-MM-DD' },
      currency: { type: 'string', description: 'ISO 4217 code, e.g. MYR' },
      taxTotal: { type: 'number', description: 'Total tax shown (SST/GST/VAT); 0 if none is shown' },
      pricesIncludeTax: { type: 'boolean', description: 'true when the printed line prices already include tax, as on most retail receipts' },
      total: { type: 'number', description: 'Grand total including tax' },
      lines: {
        type: 'array',
        items: { type: 'object', properties: { description: { type: 'string' }, qty: { type: 'number' }, unitPrice: { type: 'number' } }, required: ['description', 'qty', 'unitPrice'] },
      },
      legibility: { type: 'number', description: '0-1: how confident you are every field was read correctly' },
    },
    required: ['supplier', 'docNumber', 'docDate', 'currency', 'total', 'lines', 'legibility'],
  },
} as const;

const BASE_PROMPT = 'Extract this accounting document. Copy values exactly as printed; never guess a missing field - use an empty string or 0 and lower legibility.';
const RECEIPT_PROMPT = `${BASE_PROMPT}
This is a retail/till receipt. The supplier is the merchant that issued it (shop or company name, not the payment terminal or card network).
Many receipts print no invoice number: use the receipt, bill or transaction number if one is printed, otherwise an empty string.
Prices usually already include tax: set pricesIncludeTax accordingly and report the tax shown separately in taxTotal.
total is the amount actually charged, not the amount tendered or the change. If items are not itemised, return one line describing the purchase with the total as its price.`;
const promptFor = (kind: string) => (kind === 'receipt' ? RECEIPT_PROMPT : BASE_PROMPT);

export interface ClaudeConfig { apiKey: string; model?: string; baseUrl?: string; fetchImpl?: typeof fetch; }

/** Reads PDFs/images with the Claude API using a forced tool call, so output is always structured. */
export class ClaudeExtractor implements Extractor {
  private cfg: ClaudeConfig;
  private f: typeof fetch;
  constructor(cfg: ClaudeConfig) { this.cfg = cfg; this.f = cfg.fetchImpl ?? fetch; }

  async extractDocument(doc: Document, file?: Buffer): Promise<Extraction> {
    if (!file || !doc.mediaType || !SUPPORTED.includes(doc.mediaType)) throw new Error(`unsupported file type: ${doc.mediaType ?? 'none'}`);
    const data = file.toString('base64');
    const block = doc.mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: doc.mediaType, data } }
      : { type: 'image', source: { type: 'base64', media_type: doc.mediaType, data } };

    const res = await this.f(`${this.cfg.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': this.cfg.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.cfg.model ?? 'claude-sonnet-5-5', max_tokens: 4096,
        tools: [TOOL], tool_choice: { type: 'tool', name: TOOL.name },
        messages: [{ role: 'user', content: [block, { type: 'text', text: promptFor(doc.kind) }] }],
      }),
    });
    if (!res.ok) throw new Error(`claude extraction failed: ${res.status}`);
    const out = (await res.json()) as { content: { type: string; input?: any }[] };
    const input = out.content.find((c) => c.type === 'tool_use')?.input;
    if (!input) throw new Error('claude returned no structured result');

    const lines = (input.lines ?? []).map((l: any) => ({
      description: String(l.description ?? ''), qty: Number(l.qty), unitPrice: Number(l.unitPrice),
      amount: Math.round(Number(l.qty) * Number(l.unitPrice) * 100) / 100,
    }));
    const taxTotal = Number(input.taxTotal ?? 0), total = Number(input.total);
    let confidence = Math.max(0, Math.min(1, Number(input.legibility ?? 0)));
    const isReceipt = doc.kind === 'receipt';
    const pricesIncludeTax = !!input.pricesIncludeTax;
    // A receipt with only a total still has one valid line.
    if (isReceipt && !lines.length && total > 0) lines.push({ description: `Purchase at ${input.supplier || 'merchant'}`, qty: 1, unitPrice: total, amount: total });
    // Till receipts often print no number: derive a stable reference so the ledger lookup stays idempotent.
    const docNumber = String(input.docNumber ?? '') || (isReceipt ? `R-${doc.sha256.slice(0, 10)}` : '');
    const missing = [input.supplier, input.docNumber || (isReceipt ? 'derived' : ''), input.docDate].filter((v) => !v).length;
    if (missing || !lines.length) confidence = Math.min(confidence, 0.5);
    const sum = lines.reduce((s: number, l: { amount: number }) => s + l.amount, 0) + (pricesIncludeTax ? 0 : taxTotal);
    if (Math.abs(sum - total) > 0.01) confidence = Math.min(confidence, 0.5);   // arithmetic must reconcile
    return {
      documentId: doc.id, supplier: String(input.supplier ?? ''), docNumber, docDate: String(input.docDate ?? ''), pricesIncludeTax,
      currency: String(input.currency || 'MYR').toUpperCase(), total, taxTotal, lines, confidence,
    };
  }
}

/** Binary uploads -> Claude (when configured); plain text -> heuristic parser. */
export class RoutingExtractor implements Extractor {
  private text = new HeuristicTextExtractor();
  private vision?: Extractor;
  constructor(vision?: Extractor) { this.vision = vision; }
  async extractDocument(doc: Document, file?: Buffer): Promise<Extraction> {
    if (!file) return this.text.extractDocument(doc);
    if (!this.vision) throw new Error('file extraction is not configured (set ANTHROPIC_API_KEY)');
    return this.vision.extractDocument(doc, file);
  }
}
