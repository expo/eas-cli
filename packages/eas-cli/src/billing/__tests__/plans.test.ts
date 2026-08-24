import { FREE_PLAN_PRICE_ID, hasPaidSubscription } from '../plans';

describe(hasPaidSubscription, () => {
  it('returns false for a null subscription (Free)', () => {
    expect(hasPaidSubscription(null)).toBe(false);
  });

  it('returns false for the Free plan price id or a missing planId', () => {
    expect(hasPaidSubscription({ planId: FREE_PLAN_PRICE_ID })).toBe(false);
    expect(hasPaidSubscription({ planId: null })).toBe(false);
    expect(hasPaidSubscription({})).toBe(false);
  });

  it('returns true for a paid plan price id', () => {
    expect(hasPaidSubscription({ planId: 'price_starter' })).toBe(true);
  });
});
