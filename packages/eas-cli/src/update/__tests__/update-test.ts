import { ensureBranchExistsAsync } from '../../commands/update';
import { graphqlClient } from '../../graphql/client';
import { viewBranchUpdatesQueryUpdateLimit } from '../../graphql/queries/UpdateQuery';

const appId = '6c94sxe6-37d2-4700-52fa-1b813204dad2';
const branchId = '5e84e3cb-563e-4022-a65e-6e7a42fe4ed3';
const appName = '@tester/test';
const branchName = 'test-branch';

jest.mock('../../commands/update', () => {
  const actual = jest.requireActual('../../commands/update');
  return { ...actual, ensureBranchExistsAsync: jest.fn(actual.ensureBranchExistsAsync) };
});
jest.mock('../../graphql/client', () => ({
  ...jest.requireActual('../../graphql/client'),
  graphqlClient: {
    query: jest.fn(() => ({
      toPromise: () =>
        Promise.resolve({
          data: {
            __typename: 'RootQuery',
            app: {
              __typename: 'AppQuery',
              byId: {
                __typename: 'App',
                id: appId,
                updateBranchByName: {
                  __typename: 'UpdateBranch',
                  id: branchId,
                  name: branchName,
                  updates: [],
                },
              },
            },
          },
        }),
    })),
    mutation: jest.fn(() => ({
      toPromise: () => ({
        error: {
          graphQLErrors: [
            {
              GraphQLError: `A channel already exists with (app_id, name) = (${appId}, ${appName})`,
              extensions: {
                code: 'INTERNAL_SERVER_ERROR',
                errorCode: 'CHANNEL_ALREADY_EXISTS',
              },
            },
          ],
        },
      }),
    })),
  },
}));

describe('UpdatePublish', () => {
  describe('ensureBranchExistsAsync', () => {
    beforeEach(() => {
      jest.mocked(graphqlClient.query).mockClear();
      jest.mocked(graphqlClient.mutation).mockClear();
    });

    it('defaults limit to PAGE_LIMIT and offset to 0 when none are provided', async () => {
      await ensureBranchExistsAsync({ appId, name: appName });
      const [[, bindings]] = jest.mocked(graphqlClient.query).mock.calls;

      expect(bindings).toEqual({
        appId,
        name: appName,
        limit: viewBranchUpdatesQueryUpdateLimit,
        offset: 0,
      });
    });

    it.each([
      [0, 0],
      [10, 50],
      [100, 3],
      [1000, 77],
    ])('sets the limit to %s and offset to %s when asked', async (limit, offset) => {
      await ensureBranchExistsAsync({ appId, name: appName, limit, offset });
      const [[, bindings]] = jest.mocked(graphqlClient.query).mock.calls;

      expect(bindings).toEqual({
        appId,
        name: appName,
        limit,
        offset,
      });
    });
  });
});
