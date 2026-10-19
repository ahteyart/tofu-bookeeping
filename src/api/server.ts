import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import type { DocKind } from '../core/types.ts';
import type { Store } from '../core/store.ts';
import { must } from '../core/store.ts';
import { approve, queue, reject, type Correction } from '../modules/review/review.ts';
import { reconcile } from '../modules/reconcile/reconcile.ts';
import { summary } from '../modules/reporting/reporting.ts';
import { syncLedger } from '../modules/ledger/sync.ts';
import { postApproved, process, type Deps } from '../workflow/pipeline.ts';

export interface ApiOptions { token?: string; onChange?: () => void; }

const KINDS: DocKind[] = ['invoice', 'receipt', 'bank_statement'];
const MAX_BODY = 5_000_000;
const html = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');

class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }

async function readJson(req: IncomingMessage): Promise<any> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new HttpError(413, 'body too large'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new HttpError(400, 'invalid JSON'); }
}

function route(deps: Deps, store: Store, method: string, path: string, body: any, actor: string): Promise<unknown> | unknown {
  let m: RegExpMatchArray | null;
  if (method === 'GET' && path === '/api/clients') return [...store.clients.values()];
  if (method === 'GET' && (m = path.match(/^\/api\/clients\/([^/]+)\/summary$/))) return summary(store, m[1]);
  if (method === 'GET' && (m = path.match(/^\/api\/clients\/([^/]+)\/review$/))) {
    const cache = must(store.ledgerCache.get(m[1]), 'ledger cache');
    return queue(store, m[1]).map((item) => ({
      ...item, document: store.documents.get(item.documentId),
      extraction: store.extractions.get(item.documentId), coding: store.codings.get(item.documentId),
      accounts: cache.accounts, taxRates: cache.taxRates, contacts: cache.contacts,
    }));
  }
  if (method === 'POST' && (m = path.match(/^\/api\/clients\/([^/]+)\/documents$/))) {
    must(store.clients.get(m[1]), 'client');
    if (!KINDS.includes(body.kind)) throw new HttpError(400, `kind must be one of ${KINDS.join(', ')}`);
    if (typeof body.filename !== 'string' || typeof body.content !== 'string' || !body.content) throw new HttpError(400, 'filename and content are required');
    return process(deps, m[1], body.kind, body.filename, body.content);
  }
  if (method === 'POST' && (m = path.match(/^\/api\/review\/([^/]+)\/approve$/))) {
    const item = must(store.reviewItems.get(m[1]), 'review item');
    if (item.status !== 'open') throw new HttpError(409, 'review item already resolved');
    approve(store, m[1], actor, (body ?? {}) as Correction);
    return postApproved(deps, item.documentId);
  }
  if (method === 'POST' && (m = path.match(/^\/api\/review\/([^/]+)\/reject$/))) {
    if (store.reviewItems.get(m[1])?.status === 'resolved') throw new HttpError(409, 'review item already resolved');
    reject(store, m[1], actor, String(body?.reason ?? 'rejected'));
    return { ok: true };
  }
  if (method === 'POST' && (m = path.match(/^\/api\/documents\/([^/]+)\/retry$/))) return postApproved(deps, m[1]);
  if (method === 'POST' && (m = path.match(/^\/api\/clients\/([^/]+)\/sync$/))) return syncLedger(store, m[1], deps.ledger).then(() => ({ ok: true }));
  if (method === 'POST' && (m = path.match(/^\/api\/clients\/([^/]+)\/reconcile$/))) return reconcile(store, m[1]);
  throw new HttpError(404, 'not found');
}

export function createApi(deps: Deps, opts: ApiOptions = {}): Server {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
      res.end(type === 'application/json' ? JSON.stringify(body) : String(body));
    };
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      if (req.method === 'GET' && url.pathname === '/') return send(200, html, 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true });
      if (opts.token && req.headers.authorization !== `Bearer ${opts.token}`) throw new HttpError(401, 'unauthorized');
      const body = req.method === 'POST' ? await readJson(req) : {};
      const actor = String(req.headers['x-user'] ?? 'api');
      const result = await route(deps, deps.store, req.method ?? 'GET', url.pathname, body, actor);
      if (req.method === 'POST') opts.onChange?.();
      send(200, result ?? { ok: true });
    } catch (e) {
      const err = e as Error;
      const status = e instanceof HttpError ? e.status : /not found/.test(err.message) ? 404 : /plan limit/.test(err.message) ? 402 : 400;
      send(status, { error: err.message });
    }
  });
}
