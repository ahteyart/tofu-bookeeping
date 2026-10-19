import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import type { Client, DocKind } from '../core/types.ts';
import type { Store } from '../core/store.ts';
import { must } from '../core/store.ts';
import { approve, queue, reject, type Correction } from '../modules/review/review.ts';
import { reconcile } from '../modules/reconcile/reconcile.ts';
import { summary } from '../modules/reporting/reporting.ts';
import { syncLedger } from '../modules/ledger/sync.ts';
import { authenticate, login, logout } from '../modules/firm/auth.ts';
import { usageFor, PLAN_LIMITS } from '../modules/billing/billing.ts';
import { trailFor } from '../modules/audit/audit.ts';
import { postApproved, process, type Deps } from '../workflow/pipeline.ts';

export interface ApiOptions {
  /** Optional service token for scripts: full access across firms. Prefer user logins. */
  serviceToken?: string;
  onChange?: () => void;
}

const KINDS: DocKind[] = ['invoice', 'receipt', 'bank_statement'];
const FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_BODY = 25_000_000;
const html = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8');

class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }
interface Principal { actor: string; firmId?: string; token?: string; }
interface Raw { __raw: { type: string; bytes: Buffer; name: string } }

async function readJson(req: IncomingMessage): Promise<any> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new HttpError(413, 'body too large'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new HttpError(400, 'invalid JSON'); }
}

/** Tenant isolation: a user only ever sees clients of their own firm. Cross-firm access looks like "not found". */
function clientFor(store: Store, p: Principal, id: string): Client {
  const c = must(store.clients.get(id), 'client');
  if (p.firmId && c.firmId !== p.firmId) throw new HttpError(404, 'client not found');
  return c;
}
const reviewFor = (store: Store, p: Principal, id: string) => {
  const item = must(store.reviewItems.get(id), 'review item');
  clientFor(store, p, item.clientId);
  return item;
};
const docFor = (store: Store, p: Principal, id: string) => {
  const d = must(store.documents.get(id), 'document');
  clientFor(store, p, d.clientId);
  return d;
};

function route(deps: Deps, method: string, path: string, body: any, p: Principal): Promise<unknown> | unknown {
  const { store } = deps;
  let m: RegExpMatchArray | null;

  if (method === 'GET' && path === '/api/me') {
    const user = [...store.users.values()].find((u) => u.id === p.actor);
    const firm = p.firmId ? store.firms.get(p.firmId) : undefined;
    return { actor: p.actor, email: user?.email, role: user?.role, firm: firm?.name, plan: firm?.plan,
      usage: firm ? { used: usageFor(store, firm.id), limit: PLAN_LIMITS[firm.plan] } : undefined };
  }
  if (method === 'POST' && path === '/api/logout') { if (p.token) logout(store, p.token); return { ok: true }; }
  if (method === 'GET' && path === '/api/clients') return [...store.clients.values()].filter((c) => !p.firmId || c.firmId === p.firmId);

  if (method === 'GET' && (m = path.match(/^\/api\/clients\/([^/]+)\/summary$/))) return summary(store, clientFor(store, p, m[1]).id);
  if (method === 'GET' && (m = path.match(/^\/api\/clients\/([^/]+)\/documents$/))) {
    const c = clientFor(store, p, m[1]);
    return [...store.documents.values()].filter((d) => d.clientId === c.id)
      .map(({ content: _c, ...d }) => ({ ...d, supplier: store.extractions.get(d.id)?.supplier, total: store.extractions.get(d.id)?.total }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  if (method === 'GET' && (m = path.match(/^\/api\/clients\/([^/]+)\/review$/))) {
    const c = clientFor(store, p, m[1]);
    const cache = must(store.ledgerCache.get(c.id), 'ledger cache');
    return queue(store, c.id).map((item) => ({
      ...item, document: { ...store.documents.get(item.documentId)!, content: undefined },
      extraction: store.extractions.get(item.documentId), coding: store.codings.get(item.documentId),
      accounts: cache.accounts, taxRates: cache.taxRates, contacts: cache.contacts,
    }));
  }
  if (method === 'POST' && (m = path.match(/^\/api\/clients\/([^/]+)\/documents$/))) {
    const c = clientFor(store, p, m[1]);
    if (!KINDS.includes(body.kind)) throw new HttpError(400, `kind must be one of ${KINDS.join(', ')}`);
    if (typeof body.filename !== 'string' || !body.filename) throw new HttpError(400, 'filename is required');
    if (typeof body.contentBase64 === 'string') {
      if (!FILE_TYPES.includes(body.mediaType)) throw new HttpError(400, `mediaType must be one of ${FILE_TYPES.join(', ')}`);
      const bytes = Buffer.from(body.contentBase64, 'base64');
      if (!bytes.length) throw new HttpError(400, 'empty file');
      return process(deps, c.id, body.kind, body.filename, '', { bytes, mediaType: body.mediaType });
    }
    if (typeof body.content !== 'string' || !body.content) throw new HttpError(400, 'content or contentBase64 is required');
    return process(deps, c.id, body.kind, body.filename, body.content);
  }
  if (method === 'GET' && (m = path.match(/^\/api\/documents\/([^/]+)\/file$/))) {
    const d = docFor(store, p, m[1]);
    const bytes = d.filePath && deps.files ? deps.files.get(d.filePath) : Buffer.from(d.content);
    return { __raw: { type: d.mediaType ?? 'text/plain; charset=utf-8', bytes, name: d.filename } } satisfies Raw;
  }
  if (method === 'GET' && (m = path.match(/^\/api\/documents\/([^/]+)\/audit$/))) return trailFor(store, docFor(store, p, m[1]).id);
  if (method === 'POST' && (m = path.match(/^\/api\/review\/([^/]+)\/approve$/))) {
    const item = reviewFor(store, p, m[1]);
    if (item.status !== 'open') throw new HttpError(409, 'review item already resolved');
    approve(store, item.id, p.actor, (body ?? {}) as Correction);
    return postApproved(deps, item.documentId);
  }
  if (method === 'POST' && (m = path.match(/^\/api\/review\/([^/]+)\/reject$/))) {
    const item = reviewFor(store, p, m[1]);
    if (item.status === 'resolved') throw new HttpError(409, 'review item already resolved');
    reject(store, item.id, p.actor, String(body?.reason ?? 'rejected'));
    return { ok: true };
  }
  if (method === 'POST' && (m = path.match(/^\/api\/documents\/([^/]+)\/retry$/))) return postApproved(deps, docFor(store, p, m[1]).id);
  if (method === 'POST' && (m = path.match(/^\/api\/clients\/([^/]+)\/sync$/))) return syncLedger(store, clientFor(store, p, m[1]).id, deps.ledger).then(() => ({ ok: true }));
  if (method === 'POST' && (m = path.match(/^\/api\/clients\/([^/]+)\/reconcile$/))) return reconcile(store, clientFor(store, p, m[1]).id);
  throw new HttpError(404, 'not found');
}

export function createApi(deps: Deps, opts: ApiOptions = {}): Server {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const base = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
    const json = (status: number, body: unknown) => { res.writeHead(status, { ...base, 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { ...base, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src 'self' blob:; img-src 'self' blob: data:; object-src 'self' blob:" });
        return void res.end(html);
      }
      if (req.method === 'GET' && url.pathname === '/health') return json(200, { ok: true });

      const body = req.method === 'POST' ? await readJson(req) : {};
      if (req.method === 'POST' && url.pathname === '/api/login') {
        const { token, user } = login(deps.store, body.email, body.password);
        opts.onChange?.();
        return json(200, { token, email: user.email, role: user.role });
      }

      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      const user = authenticate(deps.store, bearer);
      let principal: Principal | undefined = user && { actor: user.id, firmId: user.firmId, token: bearer };
      if (!principal && opts.serviceToken && bearer === opts.serviceToken) principal = { actor: 'service' };
      if (!principal) throw new HttpError(401, 'unauthorized');

      const result = await route(deps, req.method ?? 'GET', url.pathname, body, principal);
      if (req.method === 'POST') opts.onChange?.();
      if (result && typeof result === 'object' && '__raw' in result) {
        const r = (result as Raw).__raw;
        // Serve uploads inertly: never let a stored file execute as a page.
        res.writeHead(200, { ...base, 'Content-Type': r.type, 'Content-Disposition': `inline; filename="${r.name.replace(/[^\w.\-]/g, '_')}"`, 'Content-Security-Policy': "sandbox; default-src 'none'" });
        return void res.end(r.bytes);
      }
      json(200, result ?? { ok: true });
    } catch (e) {
      const err = e as Error;
      const status = e instanceof HttpError ? e.status : /invalid credentials/.test(err.message) ? 401 : /too many attempts/.test(err.message) ? 429
        : /not found/.test(err.message) ? 404 : /plan limit/.test(err.message) ? 402 : 400;
      json(status, { error: err.message });
    }
  });
}
