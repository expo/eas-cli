/**
 * Plans a user can subscribe to from the CLI. The keys are the slugs a user types
 * (`eas billing:subscribe starter`); `planType` is the server-side PlanType the
 * checkout endpoint resolves to an environment-specific Stripe price id. We keep the
 * price id mapping on the server so it stays correct across prod/staging and over time.
 */
export const SUBSCRIBABLE_PLANS = {
  starter: { planType: 'STARTER', label: 'Starter' },
  'production-plus': { planType: 'PRODUCTION_PLUS', label: 'Production Plus' },
} as const;

export type PlanSlug = keyof typeof SUBSCRIBABLE_PLANS;

export const PLAN_SLUGS = Object.keys(SUBSCRIBABLE_PLANS) as PlanSlug[];

/**
 * The Stripe price id for the free plan is stable across environments, so it is safe to
 * use as a sentinel for "this account has no paid subscription".
 */
export const FREE_PLAN_PRICE_ID = 'price_free';
