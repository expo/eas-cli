import { CombinedError } from '@urql/core';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppPlatform } from '../../generated';
import { EmbeddedUpdateQuery, isEmbeddedUpdateNotFoundError } from '../EmbeddedUpdateQuery';

function makeGraphqlClient(data: unknown): ExpoGraphqlClient {
  return {
    query: jest.fn().mockReturnValue({
      toPromise: jest.fn().mockResolvedValue({ data }),
    }),
  } as unknown as ExpoGraphqlClient;
}

function makeCombinedError(errorCode: string): CombinedError {
  return new CombinedError({
    graphQLErrors: [{ message: 'error', extensions: { errorCode } }],
  });
}

describe('isEmbeddedUpdateNotFoundError', () => {
  it('returns true for CombinedError with EMBEDDED_UPDATE_NOT_FOUND errorCode', () => {
    expect(isEmbeddedUpdateNotFoundError(makeCombinedError('EMBEDDED_UPDATE_NOT_FOUND'))).toBe(
      true
    );
  });

  it('returns false for CombinedError with a different errorCode', () => {
    expect(isEmbeddedUpdateNotFoundError(makeCombinedError('SOME_OTHER_ERROR'))).toBe(false);
  });

  it('returns false for CombinedError with no extensions', () => {
    expect(
      isEmbeddedUpdateNotFoundError(new CombinedError({ graphQLErrors: [{ message: 'oops' }] }))
    ).toBe(false);
  });

  it('returns false for a plain Error', () => {
    expect(isEmbeddedUpdateNotFoundError(new Error('plain error'))).toBe(false);
  });

  it('returns false for null and non-error values', () => {
    expect(isEmbeddedUpdateNotFoundError(null)).toBe(false);
    expect(isEmbeddedUpdateNotFoundError('string')).toBe(false);
    expect(isEmbeddedUpdateNotFoundError(42)).toBe(false);
  });
});

describe('EmbeddedUpdateQuery.viewByIdAsync', () => {
  it('returns the embedded update from the GraphQL response', async () => {
    const expected = {
      id: 'update-1',
      platform: AppPlatform.Ios,
      runtimeVersion: '1.0.0',
      channel: 'production',
      createdAt: '2024-01-01T00:00:00Z',
      launchAsset: {
        id: 'asset-1',
        fileSize: 1024,
        finalFileSize: 768,
        fileSHA256: 'abc123',
      },
    };
    const client = makeGraphqlClient({
      embeddedUpdates: { byId: expected },
    });

    const result = await EmbeddedUpdateQuery.viewByIdAsync(client, {
      embeddedUpdateId: 'update-1',
      appId: 'app-1',
    });

    expect(result).toEqual(expected);
  });

  it('passes the embeddedUpdateId and appId to the query', async () => {
    const client = makeGraphqlClient({
      embeddedUpdates: {
        byId: {
          id: 'update-1',
          platform: AppPlatform.Ios,
          runtimeVersion: '1.0.0',
          channel: 'production',
          createdAt: '2024-01-01T00:00:00Z',
          launchAsset: {
            id: 'asset-1',
            fileSize: 1024,
            finalFileSize: null,
            fileSHA256: 'abc',
          },
        },
      },
    });

    await EmbeddedUpdateQuery.viewByIdAsync(client, {
      embeddedUpdateId: 'update-1',
      appId: 'app-1',
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.anything(),
      { embeddedUpdateId: 'update-1', appId: 'app-1' },
      expect.objectContaining({ additionalTypenames: ['EmbeddedUpdate'] })
    );
  });
});

describe('EmbeddedUpdateQuery.viewPaginatedAsync', () => {
  function makeConnection(): {
    edges: { cursor: string; node: any }[];
    pageInfo: {
      hasNextPage: boolean;
      hasPreviousPage: boolean;
      startCursor: string | null;
      endCursor: string | null;
    };
  } {
    return {
      edges: [
        {
          cursor: 'c1',
          node: {
            id: 'update-1',
            platform: AppPlatform.Ios,
            runtimeVersion: '1.0.0',
            channel: 'production',
            createdAt: '2024-01-01T00:00:00Z',
            launchAsset: {
              id: 'asset-1',
              fileSize: 1024,
              finalFileSize: null,
              fileSHA256: 'abc',
            },
          },
        },
      ],
      pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: 'c1', endCursor: 'c1' },
    };
  }

  it('returns the connection from the GraphQL response', async () => {
    const connection = makeConnection();
    const client = makeGraphqlClient({
      app: { byId: { id: 'app-1', embeddedUpdatesPaginated: connection } },
    });

    const result = await EmbeddedUpdateQuery.viewPaginatedAsync(client, {
      appId: 'app-1',
      first: 25,
    });

    expect(result).toEqual(connection);
  });

  it('forwards filter / first / after to the query variables', async () => {
    const client = makeGraphqlClient({
      app: { byId: { id: 'app-1', embeddedUpdatesPaginated: makeConnection() } },
    });

    await EmbeddedUpdateQuery.viewPaginatedAsync(client, {
      appId: 'app-1',
      first: 10,
      after: 'cursor-99',
      filter: { platform: AppPlatform.Ios, runtimeVersion: '1.0.0', channel: 'production' },
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.anything(),
      {
        appId: 'app-1',
        first: 10,
        after: 'cursor-99',
        filter: { platform: AppPlatform.Ios, runtimeVersion: '1.0.0', channel: 'production' },
      },
      expect.objectContaining({ additionalTypenames: ['EmbeddedUpdate'] })
    );
  });
});
