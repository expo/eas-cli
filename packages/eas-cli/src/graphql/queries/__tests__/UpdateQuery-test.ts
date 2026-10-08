import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AppPlatform } from '../../generated';
import { UpdateQuery } from '../UpdateQuery';

function makeGraphqlClient(data: unknown): {
  graphqlClient: ExpoGraphqlClient;
  query: jest.Mock;
} {
  const query = jest.fn().mockReturnValue({
    toPromise: jest.fn().mockResolvedValue({ data }),
  });
  return { graphqlClient: { query } as unknown as ExpoGraphqlClient, query };
}

describe(UpdateQuery.viewUpdateGroupsOnBranchByIdAsync.name, () => {
  it('requests and returns the update groups of the branch with the given ID', async () => {
    const updateGroups = [[{ id: 'update-id', group: 'group-id', platform: 'ios' }]];
    const { graphqlClient, query } = makeGraphqlClient({
      branches: { byId: { id: 'branch-id', updateGroups } },
    });
    const variables = {
      branchId: 'branch-id',
      limit: 1,
      offset: 0,
      filter: { runtimeVersions: ['1.0.0'], platform: AppPlatform.Ios },
    };

    await expect(
      UpdateQuery.viewUpdateGroupsOnBranchByIdAsync(graphqlClient, variables)
    ).resolves.toEqual(updateGroups);

    expect(query.mock.calls[0][0].loc.source.body).toContain('byId(branchId: $branchId)');
    expect(query.mock.calls[0][1]).toEqual(variables);
  });
});
