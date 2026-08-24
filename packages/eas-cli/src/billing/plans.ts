export const SUBSCRIBABLE_PLANS = {
  starter: { planType: 'STARTER', label: 'Starter' },
  production: { planType: 'PRODUCTION', label: 'Production' },
} as const;

export type PlanSlug = keyof typeof SUBSCRIBABLE_PLANS;
export type CheckoutPlanType = (typeof SUBSCRIBABLE_PLANS)[PlanSlug]['planType'];

export const PLAN_SLUGS = Object.keys(SUBSCRIBABLE_PLANS) as PlanSlug[];

export const FREE_PLAN_PRICE_ID = 'price_free';

// EAS Hosting deployments on the Free plan are capped at 1 GiB. Larger Free-plan
// deployments are rejected by the server, so `eas deploy` warns/fails before uploading.
export const FREE_PLAN_HOSTING_DEPLOYMENT_SIZE_LIMIT_BYTES = 1024 ** 3;

export function formatStarterSubscribeCommand(accountName?: string): string {
  return `eas billing:subscribe starter${accountName ? ` --account ${accountName}` : ''}`;
}

export function hasPaidSubscription(
  subscription: {
    planId?: string | null;
  } | null
): boolean {
  return subscription?.planId != null && subscription.planId !== FREE_PLAN_PRICE_ID;
}
