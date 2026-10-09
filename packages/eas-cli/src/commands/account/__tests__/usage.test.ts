import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { extractUsageData } from '../../../commandUtils/usageUtils';
import {
  AccountFullUsageQuery as AccountFullUsageQueryType,
  EasService,
  EasServiceMetric,
  UsageMetricType,
} from '../../../graphql/generated';
import { AccountQuery } from '../../../graphql/queries/AccountQuery';
import Log from '../../../log';
import { calculatePercentUsed, createProgressBar } from '../../../utils/usage/checkForOverages';
import { displayUsage } from '../usage';

jest.mock('../../../graphql/queries/AccountQuery');
jest.mock('../../../log', () => ({
  __esModule: true,
  ...jest.requireActual('../../../log'),
  default: {
    log: jest.fn(),
    newLine: jest.fn(),
  },
  link: jest.fn((url: string, opts?: { text?: string }) => opts?.text ?? url),
}));

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
    simulator: {
      planValue: number;
      limit: number;
      iosMinutes: number;
      androidMinutes: number;
      overageMinutes?: number;
      overageCost?: number;
      jobTypeBreakdown?: { workflows: number; simulator: number; other: number };
    };
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
    simulator,
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
      // Accounts without EAS Simulator get empty metrics from the server
      EAS_SIMULATOR: {
        __typename: 'UsageMetricTotal',
        id: 'simulator-metric-id',
        billingPeriod: {
          __typename: 'BillingPeriod',
          id: 'billing-period-id',
          start: startOfMonth.toISOString(),
          end: endOfMonth.toISOString(),
          anchor: startOfMonth.toISOString(),
        },
        planMetrics: simulator
          ? [
              {
                __typename: 'EstimatedUsage',
                id: 'simulator-plan-metric-id',
                service: EasService.Simulator,
                serviceMetric: EasServiceMetric.SimulatorUsage,
                metricType: UsageMetricType.Minute,
                value: simulator.planValue,
                limit: simulator.limit,
                jobTypeBreakdown: simulator.jobTypeBreakdown
                  ? { __typename: 'EstimatedUsageJobTypeBreakdown', ...simulator.jobTypeBreakdown }
                  : null,
              },
            ]
          : [],
        overageMetrics:
          simulator && (simulator.overageMinutes ?? 0) > 0
            ? [
                {
                  __typename: 'EstimatedOverageAndCost',
                  id: 'simulator-overage-id',
                  service: EasService.Simulator,
                  serviceMetric: EasServiceMetric.SimulatorUsage,
                  metricType: UsageMetricType.Minute,
                  value: simulator.overageMinutes ?? 0,
                  limit: simulator.limit,
                  totalCost: simulator.overageCost ?? 0,
                },
              ]
            : [],
        totalCost: simulator?.overageCost ?? 0,
      },
      IOS_SIMULATOR_MINUTES: simulator
        ? [
            {
              __typename: 'AccountUsageMetric',
              id: 'ios-simulator-minutes-id',
              serviceMetric: EasServiceMetric.SimulatorUsage,
              metricType: UsageMetricType.Minute,
              value: simulator.iosMinutes,
            },
          ]
        : [],
      ANDROID_SIMULATOR_MINUTES: simulator
        ? [
            {
              __typename: 'AccountUsageMetric',
              id: 'android-simulator-minutes-id',
              serviceMetric: EasServiceMetric.SimulatorUsage,
              metricType: UsageMetricType.Minute,
              value: simulator.androidMinutes,
            },
          ]
        : [],
    },
  };
}

function renderUsage(usageData: ReturnType<typeof createMockFullUsageData>): string {
  const mockLog = jest.mocked(Log.log);
  mockLog.mockClear();
  displayUsage(extractUsageData(usageData), usageData);
  // eslint-disable-next-line no-control-regex
  return mockLog.mock.calls
    .flat()
    .join('\n')
    .replace(/\u001b\[\d+m/g, '');
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

describe('displayUsage', () => {
  it('labels usage beyond included credits as "additional usage"', () => {
    const usageData = createMockFullUsageData({
      buildValue: 55,
      buildLimit: 50,
      mauValue: 3500,
      mauLimit: 3000,
      buildOverageCost: 1500,
      updateOverageCost: 250,
    });
    const output = renderUsage(usageData);

    expect(output).toContain('Unique Updaters (additional usage): 500 users ($2.50)');
    expect(output).toContain('Additional usage: $17.50');
    expect(output).toContain('Builds: $15.00');
    expect(output).toContain('Updates: $2.50');
    expect(output.toLowerCase()).not.toContain('overage');
  });

  it('hides the EAS Simulator section when the account has no simulator metric', () => {
    const usageData = createMockFullUsageData();

    const output = renderUsage(usageData);

    expect(output).not.toContain('EAS Simulator');
    expect(extractUsageData(usageData).simulator).toBeUndefined();
  });

  it('shows simulator minutes with the platform breakdown and additional usage', () => {
    const usageData = createMockFullUsageData({
      simulator: {
        planValue: 60,
        limit: 60,
        iosMinutes: 50.25,
        androidMinutes: 13.5,
        overageMinutes: 3.75,
        overageCost: 52,
      },
    });

    const output = renderUsage(usageData);

    expect(output).toContain('EAS Simulator');
    expect(output).toContain('Simulator minutes (plan): 60/60 minutes');
    expect(output).toContain('Simulator minutes (additional usage): 3.8 minutes ($0.52)');
    expect(output).toContain('Simulator minutes by platform:');
    expect(output).toContain('iOS: 50.3 minutes');
    expect(output).toContain('Android: 13.5 minutes');
    expect(output).not.toContain('Breakdown by job type');
    expect(output).toContain('Simulator: $0.52');
    expect(output).toContain('Additional usage: $0.52');
    expect(output).toContain('Estimated bill: $19.52');
  });

  it('shows the shared minute pool by job type on the Free plan', () => {
    const usageData = createMockFullUsageData({
      subscriptionName: 'Free',
      simulator: {
        planValue: 50,
        limit: 60,
        iosMinutes: 10,
        androidMinutes: 0,
        jobTypeBreakdown: { workflows: 40, simulator: 10, other: 0 },
      },
    });

    const output = renderUsage(usageData);

    expect(output).toContain('CI/CD and Simulator minutes (plan): 50/60 minutes');
    expect(output).toContain('Breakdown by job type:');
    expect(output).toContain('Workflows: 40 minutes');
    expect(output).toContain('Simulator: 10 minutes');
    expect(output).not.toContain('Other jobs');
    expect(output).toContain('iOS: 10 minutes');
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
