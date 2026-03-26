import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AccountFullUsageQuery as AccountFullUsageQueryType,
  EasService,
  EasServiceMetric,
  UsageMetricType,
} from '../../../graphql/generated';
import { AccountQuery } from '../../../graphql/queries/AccountQuery';
import { calculatePercentUsed, createProgressBar } from '../../../utils/usage/checkForOverages';

jest.mock('../../../graphql/queries/AccountQuery');

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

describe('AccountQuery', () => {
  const mockGraphqlClient = {} as ExpoGraphqlClient;
  const mockGetFullUsageAsync = jest.mocked(AccountQuery.getFullUsageAsync);

  beforeEach(() => {
    mockGetFullUsageAsync.mockClear();
  });

  it('fetches usage data for an account', async () => {
    const mockData = createMockFullUsageData();
    mockGetFullUsageAsync.mockResolvedValue(mockData as any);

    const currentDate = new Date();
    const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

    const result = await AccountQuery.getFullUsageAsync(
      mockGraphqlClient,
      'account-id',
      currentDate,
      startDate,
      endDate
    );

    expect(mockGetFullUsageAsync).toHaveBeenCalledWith(
      mockGraphqlClient,
      'account-id',
      expect.any(Date),
      expect.any(Date),
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
