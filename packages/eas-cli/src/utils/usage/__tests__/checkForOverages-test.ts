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
  value = 50,
  limit = 100,
}: Partial<Pick<EstimatedUsage, 'value' | 'limit'>> = {}): EstimatedUsage {
  return {
    __typename: 'EstimatedUsage',
    id: 'plan-metric-id',
    service: EasService.Builds,
    serviceMetric: EasServiceMetric.Builds,
    metricType: UsageMetricType.Build,
    value,
    limit,
    platformBreakdown: null,
  };
}

function createMockAccountUsage({
  id = 'account-id',
  name = 'test-account',
  subscriptionName = 'Free',
  buildPlanMetrics = [],
}: {
  id?: string;
  name?: string;
  subscriptionName?: string;
  buildPlanMetrics?: EstimatedUsage[];
} = {}): AccountUsageForOverageWarningQuery['account']['byId'] {
  return {
    __typename: 'Account',
    id,
    name,
    subscription: {
      __typename: 'SubscriptionDetails',
      id: 'sub-id',
      name: subscriptionName,
    },
    usageMetrics: {
      EAS_BUILD: {
        __typename: 'UsageMetricTotal',
        id: 'metric-id',
        planMetrics: buildPlanMetrics,
      },
    },
  };
}

describe('maybeWarnAboutUsageOveragesAsync', () => {
  const mockGraphqlClient = {} as ExpoGraphqlClient;
  const mockGetUsageForOverageWarningAsync = jest.mocked(
    AccountUsageQuery.getUsageForOverageWarningAsync
  );
  const mockWarn = jest.mocked(Log.warn);
  const mockDebug = jest.mocked(Log.debug);

  beforeEach(() => {
    mockGetUsageForOverageWarningAsync.mockClear();
    mockWarn.mockClear();
    mockDebug.mockClear();
  });

  it('displays a warning for a Free plan with high build usage', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue(
      createMockAccountUsage({
        buildPlanMetrics: [createMockPlanMetric({ value: 85 })],
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
  });

  it('displays a warning for a Starter plan with high build usage', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue(
      createMockAccountUsage({
        subscriptionName: 'Starter',
        buildPlanMetrics: [createMockPlanMetric({ value: 90 })],
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
  });

  it('does not display a warning when usage is below threshold', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue(
      createMockAccountUsage({
        buildPlanMetrics: [createMockPlanMetric({ value: 50 })],
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

  it('does not display a warning when there are no plan metrics', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue(createMockAccountUsage());

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
  const mockLink = link as jest.MockedFunction<typeof link>;

  beforeEach(() => {
    mockWarn.mockClear();
    mockLink.mockClear();
  });

  it('displays a warning for a Free plan', () => {
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
  });

  it('displays a warning for a paid plan', () => {
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
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('██████████████████████████░░░░')
    );
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
});
