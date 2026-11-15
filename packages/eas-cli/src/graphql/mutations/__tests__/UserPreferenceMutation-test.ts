import { CombinedError } from '@urql/core';
import { print } from 'graphql';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { UserPreferenceMutation } from '../UserPreferenceMutation';

function makeGraphqlClient(result: { data?: unknown; error?: CombinedError }): ExpoGraphqlClient & {
  mutation: jest.Mock;
} {
  return {
    mutation: jest.fn().mockReturnValue({ toPromise: jest.fn().mockResolvedValue(result) }),
  } as unknown as ExpoGraphqlClient & { mutation: jest.Mock };
}

describe('UserPreferenceMutation.setAsync', () => {
  it('sets the preference by key', async () => {
    const graphqlClient = makeGraphqlClient({
      data: {
        userPreference: {
          set: { id: 'preference-id', key: 'some-key', value: { billingPeriodId: 'period-1' } },
        },
      },
    });

    await expect(
      UserPreferenceMutation.setAsync(graphqlClient, 'some-key', { billingPeriodId: 'period-1' })
    ).resolves.toBeUndefined();

    const [document, variables, context] = graphqlClient.mutation.mock.calls[0];
    const printed = print(document);
    expect(printed).toContain('mutation SetUserPreference');
    expect(printed).toContain('set(key: $key, value: $value)');
    expect(variables).toEqual({ key: 'some-key', value: { billingPeriodId: 'period-1' } });
    expect(context).toEqual({ additionalTypenames: ['UserPreference'], noRetry: true });
  });

  it('rejects on a GraphQL error', async () => {
    const error = new CombinedError({ networkError: new Error('forbidden') });
    const graphqlClient = makeGraphqlClient({ error });

    await expect(
      UserPreferenceMutation.setAsync(graphqlClient, 'some-key', { billingPeriodId: 'period-1' })
    ).rejects.toBe(error);
  });
});
