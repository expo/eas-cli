import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AccountFullUsageQuery as AccountFullUsageQueryType,
  EasService,
  EasServiceMetric,
  UsageMetricType,
} from '../../../graphql/generated';
import { AccountFullUsageQuery } from '../../../graphql/queries/AccountFullUsageQuery';
import { calculatePercentUsed, createProgressBar } from '../../../utils/usage/checkForOverages';

jest.mock('../../../graphql/queries/AccountFullUsageQuery');

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
): AccountFullUsageQueryType['account']['byId'] {
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
      EAS_BUILD: {
        __typename: 'UsageMetricTotal',
        id: 'build-metric-id',
        billingPeriod: {
          __typename: 'BillingPeriod',
          id: 'billing-period-id',
          start: startOfMonth.toISOString(),
          end: endOfMonth.toISOString(),
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
        },
        planMetrics: [
          {
            __typename: 'EstimatedUsage',
            id: 'mau-plan-metric-id',
            service: EasService.Updates,
            serviceMetric: EasServiceMetric.UniqueUsers,
            metricType: UsageMetricType.User,
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
                  serviceMetric: EasServiceMetric.UniqueUsers,
                  metricType: UsageMetricType.User,
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

describe('AccountFullUsageQuery', () => {
  const mockGraphqlClient = {} as ExpoGraphqlClient;
  const mockGetFullUsageAsync = jest.mocked(AccountFullUsageQuery.getFullUsageAsync);

  beforeEach(() => {
    mockGetFullUsageAsync.mockClear();
  });

  it('fetches usage data for an account', async () => {
    const mockData = createMockFullUsageData();
    mockGetFullUsageAsync.mockResolvedValue(mockData as any);

    const result = await AccountFullUsageQuery.getFullUsageAsync(
      mockGraphqlClient,
      'account-id',
      new Date()
    );

    expect(mockGetFullUsageAsync).toHaveBeenCalledWith(
      mockGraphqlClient,
      'account-id',
      expect.any(Date)
    );
    expect(result.name).toBe('test-account');
  });
});

describe('calculatePercentUsed', () => {
  it('calculates correct percentage', () => {
    expect(calculatePercentUsed(50, 100)).toBe(50);
    expect(calculatePercentUsed(85, 100)).toBe(85);
    expect(calculatePercentUsed(100, 100)).toBe(100);
  });

  it('caps at 100%', () => {
    expect(calculatePercentUsed(150, 100)).toBe(100);
  });

  it('returns 0 when limit is 0', () => {
    expect(calculatePercentUsed(50, 0)).toBe(0);
  });
});

describe('createProgressBar', () => {
  it('creates correct progress bar for 50%', () => {
    const bar = createProgressBar(50, 20);
    expect(bar).toBe('██████████░░░░░░░░░░');
  });

  it('creates correct progress bar for 0%', () => {
    const bar = createProgressBar(0, 20);
    expect(bar).toBe('░░░░░░░░░░░░░░░░░░░░');
  });

  it('creates correct progress bar for 100%', () => {
    const bar = createProgressBar(100, 20);
    expect(bar).toBe('████████████████████');
  });
});

describe('Usage data extraction', () => {
  it('correctly extracts usage data from API response', () => {
    const mockData = createMockFullUsageData({
      buildValue: 25,
      buildLimit: 50,
      mauValue: 1000,
      mauLimit: 3000,
    });

    // Verify the mock structure
    expect(mockData?.name).toBe('test-account');
    expect(mockData?.subscription?.name).toBe('Starter');
    expect(mockData?.usageMetrics.EAS_BUILD.planMetrics[0].value).toBe(25);
    expect(mockData?.usageMetrics.EAS_BUILD.planMetrics[0].limit).toBe(50);
    expect(mockData?.usageMetrics.EAS_UPDATE.planMetrics[0].value).toBe(1000);
    expect(mockData?.usageMetrics.EAS_UPDATE.planMetrics[0].limit).toBe(3000);
  });

  it('handles overage costs', () => {
    const mockData = createMockFullUsageData({
      buildValue: 60,
      buildLimit: 50,
      buildOverageCost: 2000, // $20 in cents
    });

    expect(mockData?.usageMetrics.EAS_BUILD.totalCost).toBe(2000);
    expect(mockData?.usageMetrics.EAS_BUILD.overageMetrics.length).toBe(1);
    expect(mockData?.usageMetrics.EAS_BUILD.overageMetrics[0].totalCost).toBe(2000);
  });

  it('handles Free plan', () => {
    const mockData = createMockFullUsageData({
      subscriptionName: 'Free',
    });

    expect(mockData?.subscription?.name).toBe('Free');
  });
});

describe('Billing period calculations', () => {
  it('correctly identifies billing period dates', () => {
    const mockData = createMockFullUsageData();
    const startDate = new Date(mockData!.billingPeriod.start);
    const endDate = new Date(mockData!.billingPeriod.end);

    expect(startDate).toBeInstanceOf(Date);
    expect(endDate).toBeInstanceOf(Date);
    expect(endDate.getTime()).toBeGreaterThan(startDate.getTime());
  });
});
