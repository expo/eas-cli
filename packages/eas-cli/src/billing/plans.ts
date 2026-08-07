/**
 * Plans a user can subscribe to from the CLI. The keys are the slugs a user types
 * (`eas billing:subscribe starter`); `planType` is the server-side PlanType the
 * checkout endpoint resolves to an environment-specific Stripe price id. We keep the
 * price id mapping on the server so it stays correct across prod/staging and over time.
 */
export const SUBSCRIBABLE_PLANS = {
  starter: { planType: 'STARTER', label: 'Starter' },
  production: { planType: 'PRODUCTION', label: 'Production' },
} as const;

export type PlanSlug = keyof typeof SUBSCRIBABLE_PLANS;
export type CheckoutPlanType = (typeof SUBSCRIBABLE_PLANS)[PlanSlug]['planType'];

export const PLAN_SLUGS = Object.keys(SUBSCRIBABLE_PLANS) as PlanSlug[];

/**
 * The Stripe price id for the free plan is stable across environments, so it is safe to
 * use as a sentinel for "this account has no paid subscription".
 */
export const FREE_PLAN_PRICE_ID = 'price_free';

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
