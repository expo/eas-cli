import { ensureBranchExistsAsync, truncatePublishUpdateMessage } from '../../commands/update';
import { graphqlClient } from '../../graphql/client';
import { UpdateQuery } from '../../graphql/queries/UpdateQuery';
import Log from '../../log';
import { selectUpdateGroupOnBranchAsync } from '../queries';

const appName = 'test';
const appId = '6c94sxe6-37d2-4700-52fa-1b813204dad2';
const branchId = '5e84e3cb-563e-4022-a65e-6e7a42fe4ed3';
const appFullName = '@tester/test';
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

jest.mock('../../graphql/client', () => ({
  ...jest.requireActual('../../graphql/client'),
  graphqlClient: {
    query: jest.fn(),
    mutation: jest.fn(),
  },
}));

describe('UpdatePublish', () => {
  describe('ensureBranchExistsAsync', () => {
    beforeAll(() => {
      jest.mocked(graphqlClient.query).mockImplementation(
        () =>
          ({
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
          } as any)
      );
      jest.mocked(graphqlClient.mutation).mockImplementation(
        () =>
          ({
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
          } as any)
      );
    });

    beforeEach(() => {
      jest.mocked(graphqlClient.query).mockClear();
      jest.mocked(graphqlClient.mutation).mockClear();
    });

    afterAll(() => {
      jest.mocked(graphqlClient.query).mockReset();
      jest.mocked(graphqlClient.mutation).mockReset();
    });

    it.each([
      [0, 0],
      [10, 50],
      [100, 3],
      [1000, 77],
    ])('sets the limit to %s and offset to %s when provided', async (limit, offset) => {
      await ensureBranchExistsAsync({ appId, name: appFullName, limit, offset });
      const [[, bindings]] = jest.mocked(graphqlClient.query).mock.calls;

      expect(bindings).toEqual({
        appId,
        name: appFullName,
        limit,
        offset,
      });
    });
  });

  describe(truncatePublishUpdateMessage.name, () => {
    const warnSpy = jest.spyOn(Log, 'warn');
    beforeEach(() => {
      warnSpy.mockClear();
    });

    it('does not alter messages with less than 1024 characters', () => {
      const message = 'Small message =)';
      const truncatedMessage = truncatePublishUpdateMessage(message);
      expect(truncatedMessage).toEqual(message);
      expect(warnSpy).not.toBeCalled();
    });

    it('truncates messages to a length of 1024, including ellipses', () => {
      const longMessage = Array.from({ length: 2024 }, () => 'a').join('');
      const truncatedMessage = truncatePublishUpdateMessage(longMessage);
      expect(truncatedMessage.length).toEqual(1024);
      expect(truncatedMessage.slice(-3)).toEqual('...');
      expect(warnSpy).toBeCalledWith(
        'Update message exceeds the allowed 1024 character limit. Truncating message...'
      );
    });
  });

  describe(selectUpdateGroupOnBranchAsync.name, () => {
    beforeEach(() => {
      jest.mocked(UpdateQuery.viewUpdateGroupsOnBranchAsync).mockImplementation(async () => ({
        app: { byId: { id: appId, updateBranchByName: { id: branchId, updateGroups: [] } } },
      }));
    });

    it('to throw when no items are available', async () => {
      expect(async () => {
        await selectUpdateGroupOnBranchAsync({
          branchName,
          projectId: appId,
          paginatedQueryOptions: {
            json: false,
            nonInteractive: false,
            offset: 0,
            limit: 50,
          },
        });
      }).rejects.toThrowError(`Could not find any branches for project "${appId}`);
    });

    it('to throw when in non-interactive mode', async () => {
      expect(async () => {
        await selectUpdateGroupOnBranchAsync({
          branchName,
          projectId: appId,
          paginatedQueryOptions: {
            json: false,
            nonInteractive: true,
            offset: 0,
            limit: 50,
          },
        });
      }).rejects.toThrowError(`Unable to select an update in non-interactive mode.`);
    });
  });
});
