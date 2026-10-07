import { CombinedError } from '@urql/core';
import { print } from 'graphql';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import Log from '../../../log';
import { ExperimentationConfigQuery } from '../ExperimentationConfigQuery';

jest.mock('../../../log');

const definition = {
  experiments: [{ experimentName: 'x', paramDefinitions: {}, exposureLoggerType: 'rudderstack' }],
  namespaces: [],
};

function makeGraphqlClient(result: { data?: unknown; error?: CombinedError }): ExpoGraphqlClient & {
  query: jest.Mock;
} {
  return {
    query: jest.fn().mockReturnValue({ toPromise: jest.fn().mockResolvedValue(result) }),
  } as unknown as ExpoGraphqlClient & { query: jest.Mock };
}

describe('ExperimentationConfigQuery.getConfigsAsync', () => {
  it('returns the three configs', async () => {
    const graphqlClient = makeGraphqlClient({
      data: {
        experimentation: {
          userConfig: definition,
          accountConfig: definition,
          deviceConfig: definition,
        },
      },
    });
    await expect(ExperimentationConfigQuery.getConfigsAsync(graphqlClient)).resolves.toEqual({
      userConfig: definition,
      accountConfig: definition,
      deviceConfig: definition,
    });
  });

  it('replaces malformed configs with an empty definition', async () => {
    const graphqlClient = makeGraphqlClient({
      data: {
        experimentation: {
          userConfig: { experiments: 'nope', namespaces: [] },
          accountConfig: null,
          deviceConfig: definition,
        },
      },
    });
    await expect(ExperimentationConfigQuery.getConfigsAsync(graphqlClient)).resolves.toEqual({
      userConfig: { experiments: [], namespaces: [] },
      accountConfig: { experiments: [], namespaces: [] },
      deviceConfig: definition,
    });
  });

  it('disables retries and selects only the config fields', async () => {
    const graphqlClient = makeGraphqlClient({
      data: { experimentation: { userConfig: {}, accountConfig: {}, deviceConfig: {} } },
    });
    await ExperimentationConfigQuery.getConfigsAsync(graphqlClient);

    const [document, variables, context] = graphqlClient.query.mock.calls[0];
    const printed = print(document);
    expect(printed).toContain('experimentation');
    expect(printed).toContain('userConfig');
    expect(printed).toContain('accountConfig');
    expect(printed).toContain('deviceConfig');
    expect(printed).not.toContain('deviceExperimentationUnit');
    expect(variables).toEqual({});
    expect(context).toEqual({ additionalTypenames: ['ExperimentationQuery'], noRetry: true });
  });

  it('rejects on a GraphQL error without logging', async () => {
    const error = new CombinedError({ networkError: new Error('offline') });
    const graphqlClient = makeGraphqlClient({ error });
    await expect(ExperimentationConfigQuery.getConfigsAsync(graphqlClient)).rejects.toBe(error);
    expect(Log.error).not.toHaveBeenCalled();
    expect(Log.warn).not.toHaveBeenCalled();
  });

  it('rejects when the result has no data', async () => {
    const graphqlClient = makeGraphqlClient({ data: null });
    await expect(ExperimentationConfigQuery.getConfigsAsync(graphqlClient)).rejects.toThrow(
      'Returned query result data is null!'
    );
  });
});

describe('ExperimentationConfigQuery.getOwnerAccountIdForProjectAsync', () => {
  it('returns the owner account ID of the project', async () => {
    const graphqlClient = makeGraphqlClient({
      data: { app: { byId: { id: 'project-1', ownerAccount: { id: 'account-1' } } } },
    });
    await expect(
      ExperimentationConfigQuery.getOwnerAccountIdForProjectAsync(graphqlClient, 'project-1')
    ).resolves.toBe('account-1');

    const [, variables, context] = graphqlClient.query.mock.calls[0];
    expect(variables).toEqual({ appId: 'project-1' });
    expect(context).toEqual({ additionalTypenames: ['App', 'Account'], noRetry: true });
  });

  it('rejects on a GraphQL error without logging', async () => {
    const error = new CombinedError({ graphQLErrors: ['Not authorized'] });
    const graphqlClient = makeGraphqlClient({ error });
    await expect(
      ExperimentationConfigQuery.getOwnerAccountIdForProjectAsync(graphqlClient, 'project-1')
    ).rejects.toBe(error);
    expect(Log.error).not.toHaveBeenCalled();
  });
});
