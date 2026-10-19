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
      docNumber: { type: 'string', description: 'Invoice or receipt number' },
      docDate: { type: 'string', description: 'Issue date, YYYY-MM-DD' },
      currency: { type: 'string', description: 'ISO 4217 code, e.g. MYR' },
      taxTotal: { type: 'number' },
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
        messages: [{ role: 'user', content: [block, { type: 'text', text: 'Extract this accounting document. Copy values exactly as printed; never guess a missing field - use an empty string or 0 and lower legibility.' }] }],
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
    const missing = [input.supplier, input.docNumber, input.docDate].filter((v) => !v).length;
    if (missing || !lines.length) confidence = Math.min(confidence, 0.5);
    const sum = lines.reduce((s: number, l: { amount: number }) => s + l.amount, 0) + taxTotal;
    if (Math.abs(sum - total) > 0.01) confidence = Math.min(confidence, 0.5);   // arithmetic must reconcile
    return {
      documentId: doc.id, supplier: String(input.supplier ?? ''), docNumber: String(input.docNumber ?? ''), docDate: String(input.docDate ?? ''),
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
