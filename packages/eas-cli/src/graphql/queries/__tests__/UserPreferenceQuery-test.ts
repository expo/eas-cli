import { CombinedError } from '@urql/core';
import { print } from 'graphql';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { UserPreferenceQuery } from '../UserPreferenceQuery';

function makeGraphqlClient(result: { data?: unknown; error?: CombinedError }): ExpoGraphqlClient & {
  query: jest.Mock;
} {
  return {
    query: jest.fn().mockReturnValue({ toPromise: jest.fn().mockResolvedValue(result) }),
  } as unknown as ExpoGraphqlClient & { query: jest.Mock };
}

describe('UserPreferenceQuery.getValueAsync', () => {
  it('returns the stored value', async () => {
    const graphqlClient = makeGraphqlClient({
      data: {
        userPreference: {
          get: { id: 'preference-id', key: 'some-key', value: { billingPeriodId: 'period-1' } },
        },
      },
    });

    await expect(UserPreferenceQuery.getValueAsync(graphqlClient, 'some-key')).resolves.toEqual({
      billingPeriodId: 'period-1',
    });
  });

  it('returns null when the key is not set', async () => {
    const graphqlClient = makeGraphqlClient({ data: { userPreference: { get: null } } });

    await expect(UserPreferenceQuery.getValueAsync(graphqlClient, 'some-key')).resolves.toBeNull();
  });

  it('queries the preference by key', async () => {
    const graphqlClient = makeGraphqlClient({ data: { userPreference: { get: null } } });

    await UserPreferenceQuery.getValueAsync(graphqlClient, 'some-key');

    const [document, variables, context] = graphqlClient.query.mock.calls[0];
    const printed = print(document);
    expect(printed).toContain('query UserPreferenceByKey');
    expect(printed).toContain('get(key: $key)');
    expect(variables).toEqual({ key: 'some-key' });
    expect(context).toEqual({ additionalTypenames: ['UserPreference'] });
  });

  it('rejects on a GraphQL error', async () => {
    const error = new CombinedError({ networkError: new Error('offline') });
    const graphqlClient = makeGraphqlClient({ error });

    await expect(UserPreferenceQuery.getValueAsync(graphqlClient, 'some-key')).rejects.toBe(error);
  });
});
