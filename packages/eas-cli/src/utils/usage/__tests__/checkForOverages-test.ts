import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AccountUsageForOverageWarningQuery,
  EasService,
  EasServiceMetric,
  EstimatedUsage,
  UsageMetricType,
} from '../../../graphql/generated';
import { AccountUsageQuery } from '../../../graphql/queries/AccountUsageQuery';
import Log, { link } from '../../../log';
import {
  createProgressBar,
  displayOverageWarning,
  maybeWarnAboutUsageOveragesAsync,
} from '../checkForOverages';

jest.mock('../../../graphql/queries/AccountUsageQuery');
jest.mock('../../../log', () => ({
  ...jest.requireActual('../../../log'),
  warn: jest.fn(),
  newLine: jest.fn(),
  debug: jest.fn(),
  link: jest.fn((url: string, opts?: { text?: string }) => opts?.text ?? url),
}));

function createMockPlanMetric({
  service = EasService.Builds,
  serviceMetric = EasServiceMetric.Builds,
  metricType = UsageMetricType.Build,
  value = 50,
  limit = 100,
}: Partial<
  Pick<EstimatedUsage, 'service' | 'serviceMetric' | 'metricType' | 'value' | 'limit'>
> = {}): EstimatedUsage {
  return {
    __typename: 'EstimatedUsage',
    id: 'plan-metric-id',
    service,
    serviceMetric,
    metricType,
    value,
    limit,
    platformBreakdown: null,
  };
}

type MockUsageMetrics = Pick<
  AccountUsageForOverageWarningQuery['account']['byId']['usageMetrics'],
  'EAS_BUILD' | 'EAS_UPDATE'
>;

function createMockUsageMetrics({
  buildPlanMetrics = [],
  updatePlanMetrics = [],
}: {
  buildPlanMetrics?: EstimatedUsage[];
  updatePlanMetrics?: EstimatedUsage[];
} = {}): MockUsageMetrics {
  return {
    EAS_BUILD: {
      __typename: 'UsageMetricTotal',
      id: 'metric-id',
      planMetrics: buildPlanMetrics,
    },
    EAS_UPDATE: {
      __typename: 'UsageMetricTotal',
      id: 'metric-id',
      planMetrics: updatePlanMetrics,
    },
  };
}

function createMockAccountUsage({
  id = 'account-id',
  name = 'test-account',
  subscriptionName = 'Free',
  buildPlanMetrics = [],
  updatePlanMetrics = [],
}: {
  id?: string;
  name?: string;
  subscriptionName?: string | null;
  buildPlanMetrics?: EstimatedUsage[];
  updatePlanMetrics?: EstimatedUsage[];
} = {}): AccountUsageForOverageWarningQuery['account']['byId'] {
  return {
    __typename: 'Account',
    id,
    name,
    subscription: subscriptionName
      ? {
          __typename: 'SubscriptionDetails',
          id: 'sub-id',
          name: subscriptionName,
        }
      : null,
    usageMetrics: createMockUsageMetrics({ buildPlanMetrics, updatePlanMetrics }),
  };
}

describe('maybeWarnAboutUsageOveragesAsync', () => {
  const mockGraphqlClient = {} as ExpoGraphqlClient;
  const mockGetUsageForOverageWarningAsync = jest.mocked(
    AccountUsageQuery.getUsageForOverageWarningAsync
  );
  const mockWarn = jest.mocked(Log.warn);
  const mockNewLine = jest.mocked(Log.newLine);
  const mockDebug = jest.mocked(Log.debug);

  beforeEach(() => {
    mockGetUsageForOverageWarningAsync.mockClear();
    mockWarn.mockClear();
    mockNewLine.mockClear();
    mockDebug.mockClear();
  });

  it('displays a warning for Free plan with high build usage', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue(
      createMockAccountUsage({
        subscriptionName: 'Free',
        buildPlanMetrics: [
          createMockPlanMetric({
            service: EasService.Builds,
            serviceMetric: EasServiceMetric.Builds,
            metricType: UsageMetricType.Build,
            value: 85,
            limit: 100,
          }),
        ],
      })
    );

    await maybeWarnAboutUsageOveragesAsync({
      graphqlClient: mockGraphqlClient,
      accountId: 'account-id',
    });

    expect(mockGetUsageForOverageWarningAsync).toHaveBeenCalledWith(
      mockGraphqlClient,
      'account-id',
      expect.any(Date)
    );

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("You've used 85% of your included build credits for this month.")
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("You won't be able to start new builds once you reach the limit.")
    );
    expect(mockNewLine).toHaveBeenCalledTimes(1);
  });

  it('displays a warning for Starter plan with high build usage', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue(
      createMockAccountUsage({
        subscriptionName: 'Starter',
        buildPlanMetrics: [
          createMockPlanMetric({
            service: EasService.Builds,
            serviceMetric: EasServiceMetric.Builds,
            metricType: UsageMetricType.Build,
            value: 90,
            limit: 100,
          }),
        ],
      })
    );

    await maybeWarnAboutUsageOveragesAsync({
      graphqlClient: mockGraphqlClient,
      accountId: 'account-id',
    });

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("You've used 90% of your included build credits for this month.")
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Additional usage beyond your limit will be charged at pay-as-you-go rates.'
      )
    );
    expect(mockNewLine).toHaveBeenCalledTimes(1);
  });

  it('displays a warning for Pro plan', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue(
      createMockAccountUsage({
        subscriptionName: 'Pro',
        buildPlanMetrics: [
          createMockPlanMetric({
            service: EasService.Builds,
            serviceMetric: EasServiceMetric.Builds,
            metricType: UsageMetricType.Build,
            value: 85,
            limit: 100,
          }),
        ],
      })
    );

    await maybeWarnAboutUsageOveragesAsync({
      graphqlClient: mockGraphqlClient,
      accountId: 'account-id',
    });

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("You've used 85% of your included build credits for this month.")
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Additional usage beyond your limit will be charged at pay-as-you-go rates.'
      )
    );
    expect(mockNewLine).toHaveBeenCalledTimes(1);
  });

  it('does not display a warning when usage is below threshold', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue(
      createMockAccountUsage({
        subscriptionName: 'Free',
        buildPlanMetrics: [
          createMockPlanMetric({
            service: EasService.Builds,
            serviceMetric: EasServiceMetric.Builds,
            metricType: UsageMetricType.Build,
            value: 50,
            limit: 100,
          }),
        ],
      })
    );

    await maybeWarnAboutUsageOveragesAsync({
      graphqlClient: mockGraphqlClient,
      accountId: 'account-id',
    });

    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('does not display a warning when no subscription', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue(
      createMockAccountUsage({
        subscriptionName: null,
        buildPlanMetrics: [
          createMockPlanMetric({
            service: EasService.Builds,
            serviceMetric: EasServiceMetric.Builds,
            metricType: UsageMetricType.Build,
            value: 85,
            limit: 100,
          }),
        ],
      })
    );

    await maybeWarnAboutUsageOveragesAsync({
      graphqlClient: mockGraphqlClient,
      accountId: 'account-id',
    });

    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('handles errors gracefully', async () => {
    mockGetUsageForOverageWarningAsync.mockRejectedValue(new Error('Network error'));

    await maybeWarnAboutUsageOveragesAsync({
      graphqlClient: mockGraphqlClient,
      accountId: 'account-id',
    });

    expect(mockWarn).not.toHaveBeenCalled();
    expect(mockDebug).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch usage data'));
  });

  it('does not display a warning when no plan metrics', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue(
      createMockAccountUsage({
        subscriptionName: 'Free',
      })
    );

    await maybeWarnAboutUsageOveragesAsync({
      graphqlClient: mockGraphqlClient,
      accountId: 'account-id',
    });

    expect(mockWarn).not.toHaveBeenCalled();
  });
});

describe('createProgressBar', () => {
  it('creates a progress bar with correct fill for a given percentage', () => {
    const bar = createProgressBar(85, 20);
    expect(bar).toBe('█████████████████░░░');
  });

  it('creates a progress bar with correct fill for 100%', () => {
    const bar = createProgressBar(100, 20);
    expect(bar).toBe('████████████████████');
  });

  it('creates a progress bar with correct fill for 0%', () => {
    const bar = createProgressBar(0, 20);
    expect(bar).toBe('░░░░░░░░░░░░░░░░░░░░');
  });

  it('handles custom width', () => {
    const bar = createProgressBar(50, 10);
    expect(bar).toBe('█████░░░░░');
  });
});

describe('displayOverageWarning', () => {
  const mockWarn = Log.warn as jest.MockedFunction<typeof Log.warn>;
  const mockNewLine = Log.newLine as jest.MockedFunction<typeof Log.newLine>;
  const mockLink = link as jest.MockedFunction<typeof link>;

  beforeEach(() => {
    mockWarn.mockClear();
    mockNewLine.mockClear();
    mockLink.mockClear();
  });

  it('displays a warning for Free plan', () => {
    displayOverageWarning({
      percentUsed: 85,
      hasFreePlan: true,
      name: 'test-account',
    });

    expect(mockWarn).toHaveBeenCalledTimes(2);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("You've used 85% of your included build credits for this month.")
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("You won't be able to start new builds once you reach the limit.")
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('Upgrade your plan to continue service.')
    );
    expect(mockNewLine).toHaveBeenCalledTimes(1);
  });

  it('displays a warning for paid plan', () => {
    displayOverageWarning({
      percentUsed: 85,
      hasFreePlan: false,
      name: 'test-account',
    });

    expect(mockWarn).toHaveBeenCalledTimes(2);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("You've used 85% of your included build credits for this month.")
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Additional usage beyond your limit will be charged at pay-as-you-go rates.'
      )
    );
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('See usage in billing.'));
    expect(mockNewLine).toHaveBeenCalledTimes(1);
  });

  it('includes correct account name in billing URL', () => {
    displayOverageWarning({
      percentUsed: 85,
      hasFreePlan: true,
      name: 'my-custom-account',
    });

    expect(mockLink).toHaveBeenCalledWith(
      'https://expo.dev/accounts/my-custom-account/settings/billing',
      expect.objectContaining({ text: 'Upgrade your plan to continue service.' })
    );
  });

  it('displays different percentages correctly', () => {
    displayOverageWarning({
      percentUsed: 95,
      hasFreePlan: true,
      name: 'test-account',
    });

    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('95%'));
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("You've used 95% of your included build credits for this month.")
    );
  });

  it('includes progress bar in warning message', () => {
    displayOverageWarning({
      percentUsed: 90,
      hasFreePlan: false,
      name: 'test-account',
    });

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('███████████████████████████░░░')
    );
  });
});
