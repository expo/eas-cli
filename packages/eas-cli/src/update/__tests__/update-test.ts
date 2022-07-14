import { v4 as uuidv4 } from 'uuid';

import {
  PublishPlatformFlag,
  ensureBranchExistsAsync,
  getUpdatesToRepublishInteractiveAsync,
  truncatePublishUpdateMessage,
} from '../../commands/update';
import { graphqlClient } from '../../graphql/client';
import { ViewBranchUpdatesQuery } from '../../graphql/generated';
import Log from '../../log';
import { selectAsync } from '../../prompts';

const appId = '6c94sxe6-37d2-4700-52fa-1b813204dad2';
const branchId = '5e84e3cb-563e-4022-a65e-6e7a42fe4ed3';
const appName = '@tester/test';
const branchName = 'test-branch';
const projectName = 'test-project';

jest.mock('../../graphql/queries/UpdateQuery', () => {
  const actual = jest.requireActual('../../graphql/queries/UpdateQuery');
  return {
    ...actual,
    getViewBranchUpdatesQueryUpdateLimit: jest.fn(actual.getViewBranchUpdatesQueryUpdateLimit),
  };
});
jest.mock('../../prompts', () => ({
  selectAsync: jest.fn(),
}));
jest.mock('../../commands/update', () => {
  const actual = jest.requireActual('../../commands/update');
  return {
    ...actual,
    ensureBranchExistsAsync: jest.fn(actual.ensureBranchExistsAsync),
    getUpdatesToRepublishInteractiveAsync: jest.fn(actual.getUpdatesToRepublishInteractiveAsync),
  };
});
const updatesToResolve = jest.fn(
  (): Exclude<
    Exclude<ViewBranchUpdatesQuery['app'], null | undefined>['byId']['updateBranchByName'],
    null | undefined
  >['updates'] => []
);
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
                  updates: updatesToResolve(),
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

function createMockUpdates(
  {
    updateCount = 1,
    platformFlag = 'all',
    groupId,
  }: Partial<{
    updateCount: number;
    platformFlag: PublishPlatformFlag;
    groupId: string;
  }> = {
    updateCount: 1,
    platformFlag: 'all',
  }
): Exclude<
  Exclude<ViewBranchUpdatesQuery['app'], null | undefined>['byId']['updateBranchByName'],
  null | undefined
>['updates'] {
  let updates: Exclude<
    Exclude<ViewBranchUpdatesQuery['app'], null | undefined>['byId']['updateBranchByName'],
    null | undefined
  >['updates'] = [];
  if (platformFlag === 'all') {
    updateCount = Math.ceil(updateCount / 2);
  }
  for (let i = 0; i < updateCount; i++) {
    const androidUpdate = {
      id: uuidv4(),
      group: uuidv4(),
      message: 'default test message',
      createdAt: new Date(),
      runtimeVersion: 'exposdk:44.0.0',
      platform: 'android',
      manifestFragment: '',
    };
    const iosUpdate = {
      ...androidUpdate,
      id: uuidv4(),
      platform: 'ios',
    };
    if (!i && groupId) {
      androidUpdate.group = groupId;
      iosUpdate.group = groupId;
    }
    const isOddNumberedUpdateCount = !(updateCount % 2);
    const isFinalLoop = i === updateCount - 1;
    switch (platformFlag) {
      case 'all':
        updates = [
          ...updates,
          androidUpdate,
          ...(isFinalLoop && isOddNumberedUpdateCount ? [] : [iosUpdate]),
        ];
        break;
      case 'android':
        updates = [...updates, androidUpdate];
        break;
      case 'ios':
        updates = [...updates, iosUpdate];
        break;
    }
  }
  return updates;
}

describe('UpdatePublish', () => {
  describe('ensureBranchExistsAsync', () => {
    beforeEach(() => {
      jest.mocked(graphqlClient.query).mockClear();
      jest.mocked(graphqlClient.mutation).mockClear();
    });

    it.each([
      [0, 0],
      [10, 50],
      [100, 3],
      [1000, 77],
    ])('sets the limit to %s and offset to %s when provided', async (limit, offset) => {
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

  describe('getUpdatesToRepublishInteractiveAsync', () => {
    beforeEach(() => {
      jest.mocked(graphqlClient.query).mockClear();
      jest.mocked(graphqlClient.mutation).mockClear();
      jest.mocked(getUpdatesToRepublishInteractiveAsync).mockClear();
      jest.mocked(selectAsync).mockClear();
    });

    it('throws when there are no updates', async () => {
      const platformFlag = 'all';
      await expect(
        async () =>
          await getUpdatesToRepublishInteractiveAsync(projectName, branchName, platformFlag, 50)
      ).rejects.toThrow(
        `There are no updates on branch "${branchName}" published for the platform(s) ${platformFlag}. Did you mean to publish a new update instead?`
      );
    });

    it('fetches multiple pages of updates and can select an update from the most recent page', async () => {
      const mockSelectedGroupId = uuidv4();
      const pageSize = 2;
      updatesToResolve
        .mockReturnValueOnce(createMockUpdates({ updateCount: pageSize + 1 }))
        .mockReturnValueOnce(
          createMockUpdates({ updateCount: pageSize + 1, groupId: mockSelectedGroupId })
        );
      jest
        .mocked(selectAsync)
        .mockResolvedValueOnce('_fetchMore')
        .mockResolvedValueOnce(mockSelectedGroupId);

      const selectedUpdates = await getUpdatesToRepublishInteractiveAsync(
        projectName,
        branchName,
        'all',
        pageSize
      );
      expect(selectedUpdates.every(update => update.group === mockSelectedGroupId)).toBeTruthy();
    });

    it('fetches multiple pages of updates and can return an update from a previous page', async () => {
      const mockSelectedGroupId = uuidv4();
      const pageSize = 5;
      updatesToResolve
        .mockReturnValueOnce(
          createMockUpdates({ updateCount: pageSize + 1, groupId: mockSelectedGroupId })
        )
        .mockReturnValueOnce(createMockUpdates({ updateCount: pageSize + 1 }));
      jest
        .mocked(selectAsync)
        .mockResolvedValueOnce('_fetchMore')
        .mockResolvedValueOnce(mockSelectedGroupId);

      const selectedUpdates = await getUpdatesToRepublishInteractiveAsync(
        projectName,
        branchName,
        'all',
        pageSize
      );
      expect(selectedUpdates.every(update => update.group === mockSelectedGroupId)).toBeTruthy();
    });

    it('displays the option to fetch more pages as long as there are unfetched updates left', async () => {
      const mockSelectedGroupId = uuidv4();
      const pageSize = 10;
      updatesToResolve
        .mockReturnValueOnce(
          createMockUpdates({ updateCount: pageSize + 1, groupId: mockSelectedGroupId })
        )
        .mockReturnValueOnce(createMockUpdates({ updateCount: pageSize + 1 }))
        .mockReturnValueOnce(createMockUpdates({ updateCount: pageSize }));
      jest
        .mocked(selectAsync)
        .mockResolvedValueOnce('_fetchMore')
        .mockResolvedValueOnce('_fetchMore')
        .mockResolvedValueOnce(mockSelectedGroupId);

      await getUpdatesToRepublishInteractiveAsync(projectName, branchName, 'all', pageSize);
      const { calls } = jest.mocked(selectAsync).mock;
      expect(calls.length).toEqual(3);
      const [[, firstOptions], [, secondOptions], [, thirdOptions]] = calls;
      const fetchMoreValue = '_fetchMore';
      expect(firstOptions[firstOptions.length - 1].value).toEqual(fetchMoreValue);
      expect(firstOptions.length).toEqual(pageSize / 2 + 1); // + 1 === fetch more object
      expect(secondOptions[secondOptions.length - 1].value).toEqual(fetchMoreValue);
      expect(secondOptions.length).toEqual((pageSize / 2) * 2 + 1);
      expect(thirdOptions.every(update => update.value !== fetchMoreValue)).toBeTruthy();
      expect(thirdOptions.length).toEqual((pageSize / 2) * 3);
    });

    it('paginates update requests as expected', async () => {
      const mockSelectedGroupId = uuidv4();
      const pageSize = 50;
      updatesToResolve
        .mockReturnValueOnce(
          createMockUpdates({ updateCount: pageSize + 1, groupId: mockSelectedGroupId })
        )
        .mockReturnValueOnce(createMockUpdates({ updateCount: pageSize + 1 }))
        .mockReturnValueOnce(createMockUpdates({ updateCount: pageSize + 1 }))
        .mockReturnValueOnce(createMockUpdates({ updateCount: pageSize }));
      jest
        .mocked(selectAsync)
        .mockResolvedValueOnce('_fetchMore')
        .mockResolvedValueOnce('_fetchMore')
        .mockResolvedValueOnce('_fetchMore')
        .mockResolvedValueOnce(mockSelectedGroupId);

      await getUpdatesToRepublishInteractiveAsync(projectName, branchName, 'all', pageSize);
      const gqlBindings = jest.mocked(graphqlClient.query).mock.calls.map(call => call[1]);
      expect(gqlBindings).toEqual([
        expect.objectContaining({ limit: pageSize + 1, offset: pageSize * 0 }),
        expect.objectContaining({ limit: pageSize + 1, offset: pageSize * 1 }),
        expect.objectContaining({ limit: pageSize + 1, offset: pageSize * 2 }),
        expect.objectContaining({ limit: pageSize + 1, offset: pageSize * 3 }),
      ]);
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
});
