import { EasService, EasServiceMetric, UsageMetricType } from '../../graphql/generated';
import { AccountFullUsageData } from '../../graphql/queries/AccountQuery';
import {
  calculateBillingPeriodDays,
  calculateDaysElapsed,
  calculateDaysRemaining,
  extractUsageData,
  formatCurrency,
  formatDate,
  formatNumber,
} from '../usageUtils';

function createMockFullUsageData(
  overrides: Partial<{
    name: string;
    subscriptionName: string;
    buildValue: number;
    buildLimit: number;
    mauValue: number;
    mauLimit: number;
    bandwidthValue: number;
    bandwidthLimit: number;
    buildOverageCost: number;
    updateOverageCost: number;
  }> = {}
): AccountFullUsageData {
  const {
    name = 'test-account',
    subscriptionName = 'Starter',
    buildValue = 10,
    buildLimit = 50,
    mauValue = 500,
    mauLimit = 3000,
    bandwidthValue = 2.5,
    bandwidthLimit = 10,
    buildOverageCost = 0,
    updateOverageCost = 0,
  } = overrides;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return {
    __typename: 'Account',
    id: 'account-id',
    name,
    subscription: {
      __typename: 'SubscriptionDetails',
      id: 'sub-id',
      name: subscriptionName,
      status: 'active',
      nextInvoice: endOfMonth.toISOString(),
      nextInvoiceAmountDueCents: 1900,
      recurringCents: 1900,
      price: 1900,
      addons: [],
    },
    billingPeriod: {
      __typename: 'BillingPeriod',
      id: 'billing-period-id',
      start: startOfMonth.toISOString(),
      end: endOfMonth.toISOString(),
      anchor: startOfMonth.toISOString(),
    },
    usageMetrics: {
      __typename: 'AccountUsageMetrics',
      MEDIUM_ANDROID_BUILDS: [],
      LARGE_ANDROID_BUILDS: [],
      MEDIUM_IOS_BUILDS: [],
      LARGE_IOS_BUILDS: [],
      EAS_BUILD: {
        __typename: 'UsageMetricTotal',
        id: 'build-metric-id',
        billingPeriod: {
          __typename: 'BillingPeriod',
          id: 'billing-period-id',
          start: startOfMonth.toISOString(),
          end: endOfMonth.toISOString(),
          anchor: startOfMonth.toISOString(),
        },
        planMetrics: [
          {
            __typename: 'EstimatedUsage',
            id: 'build-plan-metric-id',
            service: EasService.Builds,
            serviceMetric: EasServiceMetric.Builds,
            metricType: UsageMetricType.Build,
            value: buildValue,
            limit: buildLimit,
            platformBreakdown: {
              __typename: 'EstimatedUsagePlatformBreakdown',
              ios: {
                __typename: 'EstimatedUsagePlatformDetail',
                value: Math.floor(buildValue * 0.6),
                limit: Math.floor(buildLimit * 0.6),
              },
              android: {
                __typename: 'EstimatedUsagePlatformDetail',
                value: Math.floor(buildValue * 0.4),
                limit: Math.floor(buildLimit * 0.4),
              },
            },
          },
        ],
        overageMetrics:
          buildOverageCost > 0
            ? [
                {
                  __typename: 'EstimatedOverageAndCost',
                  id: 'build-overage-id',
                  service: EasService.Builds,
                  serviceMetric: EasServiceMetric.Builds,
                  metricType: UsageMetricType.Build,
                  value: buildValue - buildLimit,
                  limit: buildLimit,
                  totalCost: buildOverageCost,
                },
              ]
            : [],
        totalCost: buildOverageCost,
      },
      EAS_UPDATE: {
        __typename: 'UsageMetricTotal',
        id: 'update-metric-id',
        billingPeriod: {
          __typename: 'BillingPeriod',
          id: 'billing-period-id',
          start: startOfMonth.toISOString(),
          end: endOfMonth.toISOString(),
          anchor: startOfMonth.toISOString(),
        },
        planMetrics: [
          {
            __typename: 'EstimatedUsage',
            id: 'mau-plan-metric-id',
            service: EasService.Updates,
            serviceMetric: EasServiceMetric.UniqueUpdaters,
            metricType: UsageMetricType.Update,
            value: mauValue,
            limit: mauLimit,
          },
          {
            __typename: 'EstimatedUsage',
            id: 'bandwidth-plan-metric-id',
            service: EasService.Updates,
            serviceMetric: EasServiceMetric.BandwidthUsage,
            metricType: UsageMetricType.Bandwidth,
            value: bandwidthValue,
            limit: bandwidthLimit,
          },
        ],
        overageMetrics:
          updateOverageCost > 0
            ? [
                {
                  __typename: 'EstimatedOverageAndCost',
                  id: 'mau-overage-id',
                  service: EasService.Updates,
                  serviceMetric: EasServiceMetric.UniqueUpdaters,
                  metricType: UsageMetricType.Update,
                  value: mauValue - mauLimit,
                  limit: mauLimit,
                  totalCost: updateOverageCost,
                },
              ]
            : [],
        totalCost: updateOverageCost,
      },
    },
  };
}

describe('formatDate', () => {
  it('formats date correctly', () => {
    const result = formatDate('2024-03-15T00:00:00.000Z');
    expect(result).toMatch(/Mar 15, 2024|Mar 14, 2024/); // Allow for timezone differences
  });
});

describe('formatCurrency', () => {
  it('formats cents to dollars', () => {
    expect(formatCurrency(1900)).toBe('$19.00');
    expect(formatCurrency(0)).toBe('$0.00');
    expect(formatCurrency(150)).toBe('$1.50');
  });
});

describe('formatNumber', () => {
  it('formats numbers with no decimals by default', () => {
    expect(formatNumber(1000)).toBe('1,000');
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('formats numbers with specified decimals', () => {
    expect(formatNumber(1234.5678, 2)).toBe('1,234.57');
  });
});

describe('calculateDaysRemaining', () => {
  it('calculates days remaining correctly', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);
    const result = calculateDaysRemaining(futureDate.toISOString());
    expect(result).toBeGreaterThanOrEqual(9);
    expect(result).toBeLessThanOrEqual(11);
  });

  it('returns 0 for past dates', () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10);
    const result = calculateDaysRemaining(pastDate.toISOString());
    expect(result).toBe(0);
  });
});

describe('calculateDaysElapsed', () => {
  it('calculates days elapsed correctly', () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10);
    const result = calculateDaysElapsed(pastDate.toISOString());
    expect(result).toBeGreaterThanOrEqual(10);
    expect(result).toBeLessThanOrEqual(11);
  });

  it('returns at least 1 for recent dates', () => {
    const today = new Date();
    const result = calculateDaysElapsed(today.toISOString());
    expect(result).toBeGreaterThanOrEqual(1);
  });
});

describe('calculateBillingPeriodDays', () => {
  it('calculates billing period days correctly', () => {
    const start = '2024-03-01T00:00:00.000Z';
    const end = '2024-03-31T00:00:00.000Z';
    const result = calculateBillingPeriodDays(start, end);
    expect(result).toBe(30);
  });
});

describe('extractUsageData', () => {
  it('correctly extracts usage data from API response', () => {
    const mockData = createMockFullUsageData({
      buildValue: 25,
      buildLimit: 50,
      mauValue: 1000,
      mauLimit: 3000,
    });

    const result = extractUsageData(mockData);

    expect(result.accountName).toBe('test-account');
    expect(result.subscriptionPlan).toBe('Starter');
    expect(result.builds.total.planValue).toBe(25);
    expect(result.builds.total.limit).toBe(50);
    expect(result.updates.mau.planValue).toBe(1000);
    expect(result.updates.mau.limit).toBe(3000);
  });

  it('handles overage costs', () => {
    const mockData = createMockFullUsageData({
      buildValue: 60,
      buildLimit: 50,
      buildOverageCost: 2000, // $20 in cents
    });

    const result = extractUsageData(mockData);

    expect(result.builds.overageCostCents).toBe(2000);
    expect(result.totalOverageCostCents).toBe(2000);
  });

  it('handles Free plan', () => {
    const mockData = createMockFullUsageData({
      subscriptionName: 'Free',
    });

    const result = extractUsageData(mockData);

    expect(result.subscriptionPlan).toBe('Free');
  });

  it('calculates percent used correctly', () => {
    const mockData = createMockFullUsageData({
      buildValue: 25,
      buildLimit: 50,
    });

    const result = extractUsageData(mockData);

    expect(result.builds.total.percentUsed).toBe(50);
  });
});

describe('Billing period calculations', () => {
  it('correctly identifies billing period dates', () => {
    const mockData = createMockFullUsageData();
    const result = extractUsageData(mockData);

    const startDate = new Date(result.billingPeriod.start);
    const endDate = new Date(result.billingPeriod.end);

    expect(startDate).toBeInstanceOf(Date);
    expect(endDate).toBeInstanceOf(Date);
    expect(endDate.getTime()).toBeGreaterThan(startDate.getTime());
  });
});
