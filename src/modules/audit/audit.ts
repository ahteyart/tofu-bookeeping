import { newId, now, type Store } from '../../core/store.ts';

/** Module 11 - append-only activity log. */
export function record(store: Store, actor: string, action: string, entity: string, entityId: string, detail?: unknown): void {
  store.audit.push({ id: newId(), at: now(), actor, action, entity, entityId, detail });
}

export const trailFor = (store: Store, entityId: string) => store.audit.filter((a) => a.entityId === entityId);
