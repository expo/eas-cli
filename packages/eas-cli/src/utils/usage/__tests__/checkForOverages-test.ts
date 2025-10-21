import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  AccountUsageForOverageWarningQuery,
  EasService,
  EasServiceMetric,
  EstimatedUsage,
  UsageMetricType,
} from '../../../graphql/generated';
import { AccountUsageQuery } from '../../../graphql/queries/AccountUsageQuery';
import Log from '../../../log';
import { maybeWarnAboutUsageOveragesAsync } from '../checkForOverages';
import * as displayOverageWarning from '../displayOverageWarning';

jest.mock('../../../graphql/queries/AccountUsageQuery');
jest.mock('../displayOverageWarning');
jest.mock('../../../log');

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
      billingPeriod: {
        __typename: 'BillingPeriod',
        id: 'period-id',
        anchor: new Date().toISOString(),
        start: new Date().toISOString(),
        end: new Date().toISOString(),
      },
      planMetrics: buildPlanMetrics,
    },
    EAS_UPDATE: {
      __typename: 'UsageMetricTotal',
      id: 'metric-id',
      billingPeriod: {
        __typename: 'BillingPeriod',
        id: 'period-id',
        anchor: new Date().toISOString(),
        start: new Date().toISOString(),
        end: new Date().toISOString(),
      },
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
  const mockDisplayOverageWarningWithProgressBar = jest.mocked(
    displayOverageWarning.displayOverageWarning
  );

  beforeEach(() => {
    mockGetUsageForOverageWarningAsync.mockClear();
    mockDisplayOverageWarningWithProgressBar.mockClear();
    jest.mocked(Log.debug).mockClear();
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
      service: EasService.Builds,
    });

    expect(mockGetUsageForOverageWarningAsync).toHaveBeenCalledWith(
      mockGraphqlClient,
      'account-id',
      expect.any(Date)
    );

    expect(mockDisplayOverageWarningWithProgressBar).toHaveBeenCalledWith({
      percentUsed: 85,
      printedMetric: 'build credits',
      planType: displayOverageWarning.PlanType.Free,
      name: 'test-account',
    });
  });

  it('displays a warning for Starter plan with high update usage', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue(
      createMockAccountUsage({
        subscriptionName: 'Starter',
        updatePlanMetrics: [
          createMockPlanMetric({
            service: EasService.Updates,
            serviceMetric: EasServiceMetric.UniqueUpdaters,
            metricType: UsageMetricType.Update,
            value: 90,
            limit: 100,
          }),
        ],
      })
    );

    await maybeWarnAboutUsageOveragesAsync({
      graphqlClient: mockGraphqlClient,
      accountId: 'account-id',
      service: EasService.Updates,
    });

    expect(mockDisplayOverageWarningWithProgressBar).toHaveBeenCalledWith({
      percentUsed: 90,
      printedMetric: 'updates MAU',
      planType: displayOverageWarning.PlanType.Starter,
      name: 'test-account',
    });
  });

  it('does not display a warning for Pro plan', async () => {
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
      service: EasService.Builds,
    });

    expect(mockDisplayOverageWarningWithProgressBar).not.toHaveBeenCalled();
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
      service: EasService.Builds,
    });

    expect(mockDisplayOverageWarningWithProgressBar).not.toHaveBeenCalled();
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
      service: EasService.Builds,
    });

    expect(mockDisplayOverageWarningWithProgressBar).not.toHaveBeenCalled();
  });

  it('handles errors gracefully', async () => {
    mockGetUsageForOverageWarningAsync.mockRejectedValue(new Error('Network error'));

    await maybeWarnAboutUsageOveragesAsync({
      graphqlClient: mockGraphqlClient,
      accountId: 'account-id',
      service: EasService.Builds,
    });

    expect(mockDisplayOverageWarningWithProgressBar).not.toHaveBeenCalled();
    expect(Log.debug).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch usage data'));
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
      service: EasService.Builds,
    });

    expect(mockDisplayOverageWarningWithProgressBar).not.toHaveBeenCalled();
  });
});
