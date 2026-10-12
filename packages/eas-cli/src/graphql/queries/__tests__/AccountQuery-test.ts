import { print } from 'graphql';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AccountQuery } from '../AccountQuery';

function makeGraphqlClient(result: { data?: unknown; error?: Error }): ExpoGraphqlClient & {
  query: jest.Mock;
} {
  return {
    query: jest.fn().mockReturnValue({ toPromise: jest.fn().mockResolvedValue(result) }),
  } as unknown as ExpoGraphqlClient & { query: jest.Mock };
}

describe('AccountQuery.getConcurrencyUsageAsync', () => {
  const account = {
    __typename: 'Account',
    id: 'account-id',
    subscription: {
      __typename: 'SubscriptionDetails',
      id: 'subscription-id',
      name: 'Starter',
      planId: 'price_starter',
      concurrencies: { __typename: 'Concurrencies', total: 2, android: 2, ios: 2 },
    },
    concurrencyConsumers: [
      { __typename: 'Build', id: 'build-1' },
      { __typename: 'JobRun', id: 'job-run-1' },
    ],
  };

  it('returns the account subscription and concurrency consumers', async () => {
    const graphqlClient = makeGraphqlClient({ data: { account: { byId: account } } });

    await expect(
      AccountQuery.getConcurrencyUsageAsync(graphqlClient, 'account-id')
    ).resolves.toEqual(account);

    const [document, variables, options] = graphqlClient.query.mock.calls[0];
    const text = print(document);
    expect(variables).toEqual({ accountId: 'account-id' });
    expect(text).toContain('concurrencyConsumers');
    expect(text).toContain('concurrencies');
    expect(text).toContain('planId');
    expect(options.additionalTypenames).toEqual([
      'Account',
      'SubscriptionDetails',
      'Build',
      'JobRun',
    ]);
  });

  it('throws when the query fails', async () => {
    const graphqlClient = makeGraphqlClient({ error: new Error('boom') });

    await expect(
      AccountQuery.getConcurrencyUsageAsync(graphqlClient, 'account-id')
    ).rejects.toThrow();
  });
});
