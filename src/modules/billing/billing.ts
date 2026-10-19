import { must, type Store } from '../../core/store.ts';

/** Module 12 - plan limits and usage metering (documents processed per month). */
export const PLAN_LIMITS = { starter: 100, pro: 5000 } as const;

const period = (d = new Date()) => d.toISOString().slice(0, 7);

export function assertWithinPlan(store: Store, firmId: string): void {
  const firm = must(store.firms.get(firmId), 'firm');
  const used = store.usage.get(`${firmId}:${period()}`)?.docs ?? 0;
  if (used >= PLAN_LIMITS[firm.plan]) throw new Error(`plan limit reached (${PLAN_LIMITS[firm.plan]} docs/month)`);
}

export function meter(store: Store, firmId: string): void {
  const key = `${firmId}:${period()}`;
  const u = store.usage.get(key) ?? { firmId, period: period(), docs: 0 };
  u.docs += 1;
  store.usage.set(key, u);
}

export const usageFor = (store: Store, firmId: string) => store.usage.get(`${firmId}:${period()}`)?.docs ?? 0;
