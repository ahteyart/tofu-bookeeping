import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { Store } from './store.ts';

/** JSON snapshot persistence so the single-process server survives restarts. Swap for Postgres later. */
export function saveStore(store: Store, file: string): void {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(store)) out[k] = v instanceof Map ? { __map: [...v.entries()] } : v;
  writeFileSync(`${file}.tmp`, JSON.stringify(out), { mode: 0o600 });  // holds password hashes and session tokens
  renameSync(`${file}.tmp`, file);
}

export function loadStore(file: string): Store {
  const store = new Store();
  if (!existsSync(file)) return store;
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>;
  const target = store as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(raw)) target[k] = v?.__map ? new Map(v.__map) : v;
  return store;
}
