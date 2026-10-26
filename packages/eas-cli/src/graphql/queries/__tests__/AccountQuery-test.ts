import { CombinedError } from '@urql/core';
import { print } from 'graphql';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { EasServiceMetric, UsageMetricType } from '../../generated';
import { AccountQuery } from '../AccountQuery';

function makeGraphqlClient(result: { data?: unknown; error?: CombinedError }): ExpoGraphqlClient & {
  query: jest.Mock;
} {
  return {
    query: jest.fn().mockReturnValue({ toPromise: jest.fn().mockResolvedValue(result) }),
  } as unknown as ExpoGraphqlClient & { query: jest.Mock };
}

describe('AccountQuery.getFreeTierBuildUsageAsync', () => {
  const currentDate = new Date('2026-10-26T12:00:00.000Z');
  const account = {
    id: 'account-id',
    subscription: { id: 'subscription-id', name: 'Free' },
    billingPeriod: {
      id: 'period-1',
      start: '2026-10-01T00:00:00.000Z',
      end: '2026-11-01T00:00:00.000Z',
    },
    usageMetrics: {
      EAS_BUILD: {
        id: 'eas-build',
        planMetrics: [
          {
            id: 'builds',
            serviceMetric: EasServiceMetric.Builds,
            metricType: UsageMetricType.Build,
            value: 14,
            limit: 30,
            platformBreakdown: {
              android: { value: 11, limit: 15 },
              ios: { value: 3, limit: 15 },
            },
          },
        ],
      },
    },
  };

  it('returns the account usage', async () => {
    const graphqlClient = makeGraphqlClient({ data: { account: { byId: account } } });

    await expect(
      AccountQuery.getFreeTierBuildUsageAsync(graphqlClient, 'account-id', currentDate)
    ).resolves.toEqual(account);
  });

  it('selects the plan name, billing period, and per-platform build usage for the date', async () => {
    const graphqlClient = makeGraphqlClient({ data: { account: { byId: account } } });

    await AccountQuery.getFreeTierBuildUsageAsync(graphqlClient, 'account-id', currentDate);

    const [document, variables, context] = graphqlClient.query.mock.calls[0];
    const printed = print(document);
    expect(printed).toContain('query AccountFreeTierBuildUsage');
    expect(printed).toContain('byId(accountId: $accountId)');
    expect(printed).toContain('billingPeriod(date: $currentDate)');
    expect(printed).toContain('EAS_BUILD: byBillingPeriod(date: $currentDate, service: BUILDS)');
    expect(printed).toContain('platformBreakdown');
    expect(printed).not.toContain('overageMetrics');
    expect(variables).toEqual({
      accountId: 'account-id',
      currentDate: '2026-10-26T12:00:00.000Z',
    });
    expect(context).toEqual({
      additionalTypenames: [
        'Account',
        'AccountUsageMetrics',
        'UsageMetricTotal',
        'BillingPeriod',
        'EstimatedUsage',
      ],
    });
  });

  it('rejects on a GraphQL error', async () => {
    const error = new CombinedError({ networkError: new Error('offline') });
    const graphqlClient = makeGraphqlClient({ error });

    await expect(
      AccountQuery.getFreeTierBuildUsageAsync(graphqlClient, 'account-id', currentDate)
    ).rejects.toBe(error);
  });
});
