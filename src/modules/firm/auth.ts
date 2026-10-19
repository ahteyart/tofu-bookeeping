import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { User } from '../../core/types.ts';
import { must, type Store } from '../../core/store.ts';
import { record } from '../audit/audit.ts';

const SESSION_MS = 12 * 3600_000;
const MAX_FAILS = 5, LOCK_MS = 15 * 60_000;

export function hashPassword(password: string): string {
  if (password.length < 10) throw new Error('password must be at least 10 characters');
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function verify(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const got = scryptSync(password, Buffer.from(salt, 'hex'), 64);
  return timingSafeEqual(got, Buffer.from(hash, 'hex'));
}

export function setPassword(store: Store, userId: string, password: string): void {
  must(store.users.get(userId), 'user').passwordHash = hashPassword(password);
}

/** Returns a session token, or throws a generic error (no user/password hint). */
export function login(store: Store, email: string, password: string): { token: string; user: User } {
  const key = String(email).toLowerCase();
  const fails = store.loginFails;
  const f = fails.get(key);
  if (f && f.n >= MAX_FAILS && f.until > Date.now()) throw new Error('too many attempts, try again later');
  const user = [...store.users.values()].find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  const ok = !!user?.passwordHash && verify(String(password), user.passwordHash);
  if (!user || !ok) {
    fails.set(key, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + LOCK_MS });
    record(store, 'anonymous', 'auth.failed', 'user', String(email)); throw new Error('invalid credentials');
  }
  fails.delete(key);
  const token = randomBytes(32).toString('hex');
  store.sessions.set(token, { token, userId: user.id, expiresAt: Date.now() + SESSION_MS });
  record(store, user.id, 'auth.login', 'user', user.id);
  return { token, user };
}

export function authenticate(store: Store, token: string | undefined): User | undefined {
  const s = token ? store.sessions.get(token) : undefined;
  if (!s) return undefined;
  if (s.expiresAt < Date.now()) { store.sessions.delete(s.token); return undefined; }
  return store.users.get(s.userId);
}

export function logout(store: Store, token: string): void { store.sessions.delete(token); }
