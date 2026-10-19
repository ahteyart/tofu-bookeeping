import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** Original-document storage. Local disk now; implement the same shape for S3/GCS later. */
export interface FileStore {
  put(clientId: string, name: string, bytes: Buffer): string;
  get(path: string): Buffer;
}

export class LocalFileStore implements FileStore {
  private dir: string;
  constructor(dir: string) { this.dir = dir; }
  put(clientId: string, name: string, bytes: Buffer): string {
    const rel = join(clientId, `${Date.now()}-${basename(name).replace(/[^\w.\-]/g, '_')}`);
    const full = join(this.dir, rel);
    mkdirSync(join(this.dir, clientId), { recursive: true });
    writeFileSync(full, bytes);
    return rel;
  }
  get(path: string): Buffer {
    if (path.includes('..')) throw new Error('bad path');
    return readFileSync(join(this.dir, path));
  }
}

export class MemoryFileStore implements FileStore {
  private m = new Map<string, Buffer>();
  put(clientId: string, name: string, bytes: Buffer): string { const k = `${clientId}/${this.m.size}-${name}`; this.m.set(k, bytes); return k; }
  get(path: string): Buffer { const b = this.m.get(path); if (!b) throw new Error('file not found'); return b; }
}
