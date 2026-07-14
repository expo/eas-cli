import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AccountUsageForOverageWarningQuery,
  EasService,
  EasServiceMetric,
  EstimatedUsage,
  UsageMetricType,
} from '../../../graphql/generated';
import { AccountQuery } from '../../../graphql/queries/AccountQuery';
import Log, { link } from '../../../log';
import {
  classifyUsageTier,
  createProgressBar,
  displayOverageWarning,
  maybeWarnAboutUsageOveragesAsync,
} from '../checkForOverages';

jest.mock('../../../graphql/queries/AccountQuery');
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
  overageMetrics = [],
  totalCost = 0,
}: {
  id?: string;
  name?: string;
  subscriptionName?: string;
  buildPlanMetrics?: EstimatedUsage[];
  overageMetrics?: { __typename: 'EstimatedOverageAndCost'; id: string; value: number }[];
  totalCost?: number;
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
        overageMetrics,
        totalCost,
      },
    },
  };
}

describe('maybeWarnAboutUsageOveragesAsync', () => {
  const mockGraphqlClient = {} as ExpoGraphqlClient;
  const mockGetUsageForOverageWarningAsync = jest.mocked(
    AccountQuery.getUsageForOverageWarningAsync
  );
  const mockWarn = jest.mocked(Log.warn);
  const mockDebug = jest.mocked(Log.debug);

  beforeEach(() => {
    mockGetUsageForOverageWarningAsync.mockClear();
    mockWarn.mockClear();
    mockDebug.mockClear();
  });

  it('displays an approaching-tier warning for a Free plan at 80%+ usage', async () => {
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
      expect.stringContaining("You've used 85% of your included build credits this billing period.")
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("You won't be able to start new builds once you reach the limit.")
    );
  });

  it('displays an approaching-tier warning for a paid plan at 80%+ usage', async () => {
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
      expect.stringContaining("You've used 90% of your included build credits this billing period.")
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Additional usage beyond your limit will be charged at pay-as-you-go rates.'
      )
    );
  });

  it('displays an at-tier warning for a Free plan that has hit the limit', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue(
      createMockAccountUsage({
        buildPlanMetrics: [createMockPlanMetric({ value: 100 })],
      })
    );

    await maybeWarnAboutUsageOveragesAsync({
      graphqlClient: mockGraphqlClient,
      accountId: 'account-id',
    });

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("You've reached your included build credits this billing period.")
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('New builds are blocked until your billing period resets.')
    );
  });

  it('displays an at-tier warning for a paid plan that has hit the limit with no overage', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue(
      createMockAccountUsage({
        subscriptionName: 'Starter',
        buildPlanMetrics: [createMockPlanMetric({ value: 100 })],
      })
    );

    await maybeWarnAboutUsageOveragesAsync({
      graphqlClient: mockGraphqlClient,
      accountId: 'account-id',
    });

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("You've reached your included build credits this billing period.")
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('Additional builds will be charged at pay-as-you-go rates.')
    );
  });

  it('displays the at-tier message for a Free plan even if overage is reported (defensive fallback)', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue(
      createMockAccountUsage({
        buildPlanMetrics: [createMockPlanMetric({ value: 105 })],
        overageMetrics: [{ __typename: 'EstimatedOverageAndCost', id: 'o1', value: 5 }],
        totalCost: 0,
      })
    );

    await maybeWarnAboutUsageOveragesAsync({
      graphqlClient: mockGraphqlClient,
      accountId: 'account-id',
    });

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("You've reached your included build credits this billing period.")
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('New builds are blocked until your billing period resets.')
    );
  });

  it('displays an over-tier warning for a paid plan with overage and cost', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue(
      createMockAccountUsage({
        subscriptionName: 'Starter',
        buildPlanMetrics: [createMockPlanMetric({ value: 110 })],
        overageMetrics: [{ __typename: 'EstimatedOverageAndCost', id: 'o1', value: 10 }],
        totalCost: 1500,
      })
    );

    await maybeWarnAboutUsageOveragesAsync({
      graphqlClient: mockGraphqlClient,
      accountId: 'account-id',
    });

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining(
        "You've used 10 builds beyond your included credits this billing period ($15.00 in overages so far)."
      )
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('Additional builds continue at pay-as-you-go rates.')
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

  it('does not warn a Free plan below its limit even if the usage API reports an overage', async () => {
    // Regression: free users with only a handful of builds were told they'd reached
    // their limit because a nonzero overage row was treated as billable usage.
    mockGetUsageForOverageWarningAsync.mockResolvedValue(
      createMockAccountUsage({
        subscriptionName: 'Free',
        buildPlanMetrics: [createMockPlanMetric({ value: 6, limit: 30 })],
        overageMetrics: [{ __typename: 'EstimatedOverageAndCost', id: 'o1', value: 5 }],
        totalCost: 0,
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

describe('classifyUsageTier', () => {
  const paid = { overageCostCents: 0, hasFreePlan: false };

  it('returns null when usage is below threshold', () => {
    expect(classifyUsageTier({ planValue: 50, limit: 100, overageCount: 0, ...paid })).toBeNull();
    expect(classifyUsageTier({ planValue: 79, limit: 100, overageCount: 0, ...paid })).toBeNull();
  });

  it('returns "approaching" at >= 80% but below limit', () => {
    expect(classifyUsageTier({ planValue: 80, limit: 100, overageCount: 0, ...paid })).toBe(
      'approaching'
    );
    expect(classifyUsageTier({ planValue: 99, limit: 100, overageCount: 0, ...paid })).toBe(
      'approaching'
    );
  });

  it('returns "at" when planValue >= limit and no overage', () => {
    expect(classifyUsageTier({ planValue: 100, limit: 100, overageCount: 0, ...paid })).toBe('at');
  });

  it('returns "over" for a paid plan with a counted, billable overage', () => {
    expect(
      classifyUsageTier({
        planValue: 105,
        limit: 100,
        overageCount: 5,
        overageCostCents: 750,
        hasFreePlan: false,
      })
    ).toBe('over');
  });

  it('prefers "over" if a billable overage exists, regardless of planValue', () => {
    expect(
      classifyUsageTier({
        planValue: 50,
        limit: 100,
        overageCount: 1,
        overageCostCents: 150,
        hasFreePlan: false,
      })
    ).toBe('over');
  });

  it('never returns "over" for a Free plan, even if an overage is reported', () => {
    // Regression: free users below their limit were shown the "reached your limit" warning
    // because a nonzero overage row was treated as billable usage.
    expect(
      classifyUsageTier({
        planValue: 6,
        limit: 30,
        overageCount: 5,
        overageCostCents: 0,
        hasFreePlan: true,
      })
    ).toBeNull();
  });

  it('does not return "over" for a paid plan when the overage has no billable cost', () => {
    expect(
      classifyUsageTier({
        planValue: 6,
        limit: 30,
        overageCount: 5,
        overageCostCents: 0,
        hasFreePlan: false,
      })
    ).toBeNull();
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

  it('approaching tier: displays a warning for a Free plan with progress bar', () => {
    displayOverageWarning({
      tier: 'approaching',
      name: 'test-account',
      hasFreePlan: true,
      planValue: 85,
      limit: 100,
      overageCount: 0,
      overageCostCents: 0,
    });

    expect(mockWarn).toHaveBeenCalledTimes(2);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("You've used 85% of your included build credits this billing period.")
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("You won't be able to start new builds once you reach the limit.")
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('Upgrade your plan to continue service.')
    );
    expect(mockWarn).toHaveBeenCalledWith(expect.stringMatching(/█+░+/));
  });

  it('approaching tier: displays a warning for a paid plan with progress bar', () => {
    displayOverageWarning({
      tier: 'approaching',
      name: 'test-account',
      hasFreePlan: false,
      planValue: 85,
      limit: 100,
      overageCount: 0,
      overageCostCents: 0,
    });

    expect(mockWarn).toHaveBeenCalledTimes(2);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("You've used 85% of your included build credits this billing period.")
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Additional usage beyond your limit will be charged at pay-as-you-go rates.'
      )
    );
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('See usage in billing.'));
  });

  it('at tier: displays a Free-plan limit-reached message with present-tense block wording', () => {
    displayOverageWarning({
      tier: 'at',
      name: 'test-account',
      hasFreePlan: true,
      planValue: 100,
      limit: 100,
      overageCount: 0,
      overageCostCents: 0,
    });

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("You've reached your included build credits this billing period.")
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('New builds are blocked until your billing period resets.')
    );
  });

  it('at tier: displays a paid-plan limit-reached message with pay-as-you-go warning', () => {
    displayOverageWarning({
      tier: 'at',
      name: 'test-account',
      hasFreePlan: false,
      planValue: 100,
      limit: 100,
      overageCount: 0,
      overageCostCents: 0,
    });

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("You've reached your included build credits this billing period.")
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('Additional builds will be charged at pay-as-you-go rates.')
    );
  });

  it('over tier on Free plan: defensively falls back to the at-tier blocked message', () => {
    displayOverageWarning({
      tier: 'over',
      name: 'test-account',
      hasFreePlan: true,
      planValue: 105,
      limit: 100,
      overageCount: 5,
      overageCostCents: 0,
    });

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("You've reached your included build credits this billing period.")
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('New builds are blocked until your billing period resets.')
    );
  });

  it('over tier: displays a paid-plan overage count and accrued cost', () => {
    displayOverageWarning({
      tier: 'over',
      name: 'test-account',
      hasFreePlan: false,
      planValue: 110,
      limit: 100,
      overageCount: 10,
      overageCostCents: 1500,
    });

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining(
        "You've used 10 builds beyond your included credits this billing period ($15.00 in overages so far)."
      )
    );
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('Additional builds continue at pay-as-you-go rates.')
    );
  });

  it('over tier: paid plan with a single overage build uses singular wording', () => {
    displayOverageWarning({
      tier: 'over',
      name: 'test-account',
      hasFreePlan: false,
      planValue: 101,
      limit: 100,
      overageCount: 1,
      overageCostCents: 150,
    });

    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining(
        "You've used 1 build beyond your included credits this billing period ($1.50 in overages so far)."
      )
    );
  });

  it('includes correct account name in billing URL', () => {
    displayOverageWarning({
      tier: 'approaching',
      name: 'my-custom-account',
      hasFreePlan: true,
      planValue: 85,
      limit: 100,
      overageCount: 0,
      overageCostCents: 0,
    });

    expect(mockLink).toHaveBeenCalledWith(
      'https://expo.dev/accounts/my-custom-account/settings/billing',
      expect.objectContaining({ text: 'Upgrade your plan to continue service.' })
    );
  });
});
