import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import { selectUpdateGroupOnBranchAsync } from '../queries';

const appId = '6c94sxe6-37d2-4700-52fa-1b813204dad2';
const branchName = 'test-branch';

jest.mock('../../prompts', () => ({
  selectAsync: jest.fn(),
}));

jest.mock('../../graphql/queries/UpdateQuery', () => {
  const actual = jest.requireActual('../../graphql/queries/UpdateQuery');
  return {
    ...actual,
    UpdateQuery: {
      ...actual.UpdateQuery,
      viewUpdateGroupsOnBranchAsync: jest.fn(),
    },
  };
});

describe('update queries', () => {
  describe(selectUpdateGroupOnBranchAsync.name, () => {
    beforeEach(() => {
      jest.mocked(UpdateQuery.viewUpdateGroupsOnBranchAsync).mockImplementation(async () => []);
    });

    it('to throw when no items are available', async () => {
      const graphqlClient = instance(mock<ExpoGraphqlClient>());
      await expect(
        selectUpdateGroupOnBranchAsync(graphqlClient, {
          branchName,
          projectId: appId,
          paginatedQueryOptions: {
            json: false,
            nonInteractive: false,
            offset: 0,
            limit: 50,
          },
        })
      ).rejects.toThrowError(`Could not find any branches for project "${appId}`);
    });

    it('to throw when in non-interactive mode', async () => {
      const graphqlClient = instance(mock<ExpoGraphqlClient>());
      await expect(
        selectUpdateGroupOnBranchAsync(graphqlClient, {
          branchName,
          projectId: appId,
          paginatedQueryOptions: {
            json: false,
            nonInteractive: true,
            offset: 0,
            limit: 50,
          },
        })
      ).rejects.toThrowError(`Unable to select an update in non-interactive mode.`);
    });
  });
});
