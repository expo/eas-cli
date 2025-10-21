import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasService, EasServiceMetric, UsageMetricType } from '../../../graphql/generated';
import { AccountUsageQuery } from '../../../graphql/queries/AccountUsageQuery';
import Log from '../../../log';
import { maybeWarnAboutUsageOveragesAsync } from '../checkForOverages';
import * as displayOverageWarning from '../displayOverageWarning';

jest.mock('../../../graphql/queries/AccountUsageQuery');
jest.mock('../displayOverageWarning');
jest.mock('../../../log');

describe('maybeWarnAboutUsageOveragesAsync', () => {
  const mockGraphqlClient = {} as ExpoGraphqlClient;
  const mockGetUsageForOverageWarningAsync = jest.mocked(
    AccountUsageQuery.getUsageForOverageWarningAsync
  );
  const mockDisplayOverageWarningWithProgressBar = jest.mocked(
    displayOverageWarning.displayOverageWarningWithProgressBar
  );

  beforeEach(() => {
    mockGetUsageForOverageWarningAsync.mockClear();
    mockDisplayOverageWarningWithProgressBar.mockClear();
    jest.mocked(Log.debug).mockClear();
  });

  it('displays warning for Free plan with high build usage', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue({
      id: 'account-id',
      name: 'test-account',
      subscription: {
        id: 'sub-id',
        name: 'Free',
      },
      usageMetrics: {
        EAS_BUILD: {
          id: 'metric-id',
          billingPeriod: {
            id: 'period-id',
            anchor: new Date().toISOString(),
            start: new Date().toISOString(),
            end: new Date().toISOString(),
          },
          planMetrics: [
            {
              id: 'plan-metric-id',
              service: EasService.Builds,
              serviceMetric: EasServiceMetric.Builds,
              metricType: UsageMetricType.Build,
              value: 85,
              limit: 100,
            },
          ],
        },
        EAS_UPDATE: null,
      },
    } as any);

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
    expect(mockDisplayOverageWarningWithProgressBar).toHaveBeenCalledWith(
      {
        service: EasService.Builds,
        printedMetric: 'included build credits',
        percentUsed: 85,
      },
      displayOverageWarning.PlanType.Free,
      'test-account'
    );
  });

  it('displays warning for Starter plan with high update usage', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue({
      id: 'account-id',
      name: 'test-account',
      subscription: {
        id: 'sub-id',
        name: 'Starter',
      },
      usageMetrics: {
        EAS_BUILD: null,
        EAS_UPDATE: {
          id: 'metric-id',
          billingPeriod: {
            id: 'period-id',
            anchor: new Date().toISOString(),
            start: new Date().toISOString(),
            end: new Date().toISOString(),
          },
          planMetrics: [
            {
              id: 'plan-metric-id',
              service: EasService.Updates,
              serviceMetric: EasServiceMetric.UniqueUpdaters,
              metricType: UsageMetricType.Update,
              value: 90,
              limit: 100,
            },
          ],
        },
      },
    } as any);

    await maybeWarnAboutUsageOveragesAsync({
      graphqlClient: mockGraphqlClient,
      accountId: 'account-id',
      service: EasService.Updates,
    });

    expect(mockDisplayOverageWarningWithProgressBar).toHaveBeenCalledWith(
      {
        service: EasService.Updates,
        printedMetric: 'included updates MAU',
        percentUsed: 90,
      },
      displayOverageWarning.PlanType.Starter,
      'test-account'
    );
  });

  it('does not display warning for Pro plan', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue({
      id: 'account-id',
      name: 'test-account',
      subscription: {
        id: 'sub-id',
        name: 'Pro',
      },
      usageMetrics: {
        EAS_BUILD: {
          id: 'metric-id',
          billingPeriod: {
            id: 'period-id',
            anchor: new Date().toISOString(),
            start: new Date().toISOString(),
            end: new Date().toISOString(),
          },
          planMetrics: [
            {
              id: 'plan-metric-id',
              service: EasService.Builds,
              serviceMetric: EasServiceMetric.Builds,
              metricType: UsageMetricType.Build,
              value: 85,
              limit: 100,
            },
          ],
        },
        EAS_UPDATE: null,
      },
    } as any);

    await maybeWarnAboutUsageOveragesAsync({
      graphqlClient: mockGraphqlClient,
      accountId: 'account-id',
      service: EasService.Builds,
    });

    expect(mockDisplayOverageWarningWithProgressBar).not.toHaveBeenCalled();
  });

  it('does not display warning when usage is below threshold', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue({
      id: 'account-id',
      name: 'test-account',
      subscription: {
        id: 'sub-id',
        name: 'Free',
      },
      usageMetrics: {
        EAS_BUILD: {
          id: 'metric-id',
          billingPeriod: {
            id: 'period-id',
            anchor: new Date().toISOString(),
            start: new Date().toISOString(),
            end: new Date().toISOString(),
          },
          planMetrics: [
            {
              id: 'plan-metric-id',
              service: EasService.Builds,
              serviceMetric: EasServiceMetric.Builds,
              metricType: UsageMetricType.Build,
              value: 50,
              limit: 100,
            },
          ],
        },
        EAS_UPDATE: null,
      },
    } as any);

    await maybeWarnAboutUsageOveragesAsync({
      graphqlClient: mockGraphqlClient,
      accountId: 'account-id',
      service: EasService.Builds,
    });

    expect(mockDisplayOverageWarningWithProgressBar).not.toHaveBeenCalled();
  });

  it('does not display warning when no subscription', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue({
      id: 'account-id',
      name: 'test-account',
      subscription: null,
      usageMetrics: {
        EAS_BUILD: {
          id: 'metric-id',
          billingPeriod: {
            id: 'period-id',
            anchor: new Date().toISOString(),
            start: new Date().toISOString(),
            end: new Date().toISOString(),
          },
          planMetrics: [
            {
              id: 'plan-metric-id',
              service: EasService.Builds,
              serviceMetric: EasServiceMetric.Builds,
              metricType: UsageMetricType.Build,
              value: 85,
              limit: 100,
            },
          ],
        },
        EAS_UPDATE: null,
      },
    } as any);

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

  it('does not display warning when no plan metrics', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue({
      id: 'account-id',
      name: 'test-account',
      subscription: {
        id: 'sub-id',
        name: 'Free',
      },
      usageMetrics: {
        EAS_BUILD: {
          id: 'metric-id',
          billingPeriod: {
            id: 'period-id',
            anchor: new Date().toISOString(),
            start: new Date().toISOString(),
            end: new Date().toISOString(),
          },
          planMetrics: [],
        },
        EAS_UPDATE: null,
      },
    } as any);

    await maybeWarnAboutUsageOveragesAsync({
      graphqlClient: mockGraphqlClient,
      accountId: 'account-id',
      service: EasService.Builds,
    });

    expect(mockDisplayOverageWarningWithProgressBar).not.toHaveBeenCalled();
  });

  it('is case-insensitive for plan type', async () => {
    mockGetUsageForOverageWarningAsync.mockResolvedValue({
      id: 'account-id',
      name: 'test-account',
      subscription: {
        id: 'sub-id',
        name: 'STARTER', // uppercase
      },
      usageMetrics: {
        EAS_BUILD: {
          id: 'metric-id',
          billingPeriod: {
            id: 'period-id',
            anchor: new Date().toISOString(),
            start: new Date().toISOString(),
            end: new Date().toISOString(),
          },
          planMetrics: [
            {
              id: 'plan-metric-id',
              service: EasService.Builds,
              serviceMetric: EasServiceMetric.Builds,
              metricType: UsageMetricType.Build,
              value: 85,
              limit: 100,
            },
          ],
        },
        EAS_UPDATE: null,
      },
    } as any);

    await maybeWarnAboutUsageOveragesAsync({
      graphqlClient: mockGraphqlClient,
      accountId: 'account-id',
      service: EasService.Builds,
    });

    expect(mockDisplayOverageWarningWithProgressBar).toHaveBeenCalledWith(
      expect.any(Object),
      displayOverageWarning.PlanType.Starter,
      'test-account'
    );
  });
});
