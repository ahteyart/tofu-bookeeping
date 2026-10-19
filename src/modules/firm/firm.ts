import type { Client, Firm, User } from '../../core/types.ts';
import { must, newId, type Store } from '../../core/store.ts';
import { record } from '../audit/audit.ts';

/** Module 1 - firms (tenants), staff and client companies. */
export function createFirm(store: Store, name: string, plan: Firm['plan'] = 'starter'): Firm {
  const firm = { id: newId(), name, plan };
  store.firms.set(firm.id, firm);
  record(store, 'system', 'firm.create', 'firm', firm.id);
  return firm;
}

export function addUser(store: Store, firmId: string, email: string, role: User['role']): User {
  must(store.firms.get(firmId), 'firm');
  const user = { id: newId(), firmId, email, role };
  store.users.set(user.id, user);
  return user;
}

export function addClient(
  store: Store, firmId: string, name: string, opts: Partial<Pick<Client, 'baseCurrency' | 'autoApproveThreshold'>> = {},
): Client {
  must(store.firms.get(firmId), 'firm');
  const client: Client = { id: newId(), firmId, name, baseCurrency: opts.baseCurrency ?? 'MYR', autoApproveThreshold: opts.autoApproveThreshold ?? 0.9 };
  store.clients.set(client.id, client);
  record(store, 'system', 'client.create', 'client', client.id);
  return client;
}

export const canAdmin = (user: User): boolean => user.role === 'admin';
