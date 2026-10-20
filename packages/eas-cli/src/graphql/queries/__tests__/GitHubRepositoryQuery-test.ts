import { CombinedError } from '@urql/core';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { GitHubRepositoryQuery } from '../GitHubRepositoryQuery';

const repository = { id: 123, nodeId: 'R_123', name: 'mobile', owner: { login: 'expo' } };

function page(
  nodes: (typeof repository)[],
  hasNextPage: boolean,
  endCursor: string | null
): object {
  return {
    data: {
      githubAppRegistrations: {
        byId: {
          id: '00000000-0000-0000-0000-000000000000',
          repositoriesForViewer: {
            edges: nodes.map(node => ({ node })),
            pageInfo: { hasNextPage, endCursor },
          },
        },
      },
    },
  };
}

describe(GitHubRepositoryQuery.findRepositoryAsync, () => {
  const query = jest.fn();
  const client = { query } as unknown as ExpoGraphqlClient;
  const toPromise = jest.fn();
  beforeEach(() => {
    jest.resetAllMocks();
    query.mockReturnValue({ toPromise });
  });

  it('finds a repository on a later page, passing the cursor and installation ID', async () => {
    toPromise
      .mockResolvedValueOnce(page([{ ...repository, name: 'other' }], true, 'page-2'))
      .mockResolvedValueOnce(page([repository], true, 'page-3'));
    await expect(
      GitHubRepositoryQuery.findRepositoryAsync(client, 456, 'EXPO/Mobile')
    ).resolves.toEqual(repository);
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      {
        registrationId: '00000000-0000-0000-0000-000000000000',
        installationIdentifier: 456,
        after: 'page-2',
      },
      { requestPolicy: 'network-only' }
    );
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('returns null when all pages are exhausted', async () => {
    toPromise
      .mockResolvedValueOnce(page([], true, 'page-2'))
      .mockResolvedValueOnce(page([], false, null));
    await expect(
      GitHubRepositoryQuery.findRepositoryAsync(client, 456, 'expo/mobile')
    ).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not match the same repository name from a different owner', async () => {
    toPromise.mockResolvedValue(
      page([{ ...repository, owner: { login: 'another-owner' } }], false, null)
    );
    await expect(
      GitHubRepositoryQuery.findRepositoryAsync(client, 456, 'expo/mobile')
    ).resolves.toBeNull();
  });

  it('propagates API authentication failures', async () => {
    toPromise.mockResolvedValue({
      error: new CombinedError({ graphQLErrors: ['GitHub authorization expired'] }),
    });
    await expect(
      GitHubRepositoryQuery.findRepositoryAsync(client, 456, 'expo/mobile')
    ).rejects.toThrow('GitHub authorization expired');
  });

  it('fails instead of looping when a page is missing its next cursor', async () => {
    toPromise.mockResolvedValue(page([], true, null));
    await expect(
      GitHubRepositoryQuery.findRepositoryAsync(client, 456, 'expo/mobile')
    ).rejects.toThrow('next page');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('fails instead of looping when the next cursor does not advance', async () => {
    toPromise.mockResolvedValue(page([], true, 'page-2'));
    await expect(
      GitHubRepositoryQuery.findRepositoryAsync(client, 456, 'expo/mobile')
    ).rejects.toThrow('next page');
    expect(query).toHaveBeenCalledTimes(2);
  });
});
