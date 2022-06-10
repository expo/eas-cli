import { v4 as uuidv4 } from 'uuid';

import {
  PublishPlatformFlag,
  ensureBranchExistsAsync,
  getUpdatesToRepublishInteractiveAsync,
} from '../../commands/update';
import { graphqlClient } from '../../graphql/client';
import { ViewBranchUpdatesQuery } from '../../graphql/generated';
import { getViewBranchUpdatesQueryUpdateLimit } from '../../graphql/queries/UpdateQuery';
import { selectAsync } from '../../prompts';

const appId = '6c94sxe6-37d2-4700-52fa-1b813204dad2';
const branchId = '5e84e3cb-563e-4022-a65e-6e7a42fe4ed3';
const appName = '@tester/test';
const branchName = 'test-branch';

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

function createMockUpdate(
  {
    platformFlag = 'all',
    group = uuidv4(),
  }: Partial<{
    platformFlag: PublishPlatformFlag;
    group: string;
  }> = {
    platformFlag: 'all',
    group: uuidv4(),
  }
): Exclude<
  Exclude<ViewBranchUpdatesQuery['app'], null | undefined>['byId']['updateBranchByName'],
  null | undefined
>['updates'] {
  const androidUpdate = {
    id: uuidv4(),
    group,
    message: 'default test message',
    createdAt: new Date(),
    runtimeVersion: 'exposdk:44.0.0',
    platform: 'ios',
    manifestFragment: '',
  };
  const iosUpdate = {
    id: uuidv4(),
    group,
    message: 'default test message',
    createdAt: new Date(),
    runtimeVersion: 'exposdk:44.0.0',
    platform: 'android',
    manifestFragment: '',
  };
  switch (platformFlag) {
    case 'all':
      return [androidUpdate, iosUpdate];
    case 'android':
      return [androidUpdate];
    case 'ios':
      return [iosUpdate];
  }
}

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
        limit: getViewBranchUpdatesQueryUpdateLimit(),
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

  describe('getUpdatesToRepublishInteractiveAsync', () => {
    beforeEach(() => {
      jest.mocked(graphqlClient.query).mockClear();
      jest.mocked(graphqlClient.mutation).mockClear();
      jest.mocked(getUpdatesToRepublishInteractiveAsync).mockClear();
      jest.mocked(selectAsync).mockClear();
      jest.mocked(getViewBranchUpdatesQueryUpdateLimit).mockReturnValue(2);
    });

    it('throws when there are no updates', async () => {
      const platformFlag = 'all';
      await expect(
        async () =>
          await getUpdatesToRepublishInteractiveAsync('test-project', branchName, platformFlag)
      ).rejects.toThrow(
        `There are no updates on branch "${branchName}" published on the platform(s) ${platformFlag}. Did you mean to publish a new update instead?`
      );
    });

    it('fetches multiple pages of updates and can republish an update from the most recent page', async () => {
      const mockSelectedGroupId = uuidv4();
      updatesToResolve
        .mockReturnValueOnce(createMockUpdate())
        .mockReturnValueOnce(createMockUpdate({ group: mockSelectedGroupId }));
      jest
        .mocked(selectAsync)
        .mockResolvedValueOnce('_fetchMore')
        .mockResolvedValueOnce(mockSelectedGroupId);

      const selectedUpdates: Exclude<
        Exclude<ViewBranchUpdatesQuery['app'], null | undefined>['byId']['updateBranchByName'],
        null | undefined
      >['updates'] = await getUpdatesToRepublishInteractiveAsync('test-project', branchName, 'all');
      expect(selectedUpdates.every(update => update.group === mockSelectedGroupId)).toBeTruthy();
    });

    it('fetches multiple pages of updates and can republish an update from the previous page', async () => {
      const mockSelectedGroupId = uuidv4();

      updatesToResolve
        .mockReturnValueOnce(createMockUpdate({ group: mockSelectedGroupId }))
        .mockReturnValueOnce(createMockUpdate());
      jest
        .mocked(selectAsync)
        .mockResolvedValueOnce('_fetchMore')
        .mockResolvedValueOnce(mockSelectedGroupId);

      const selectedUpdates: Exclude<
        Exclude<ViewBranchUpdatesQuery['app'], null | undefined>['byId']['updateBranchByName'],
        null | undefined
      >['updates'] = await getUpdatesToRepublishInteractiveAsync('test-project', branchName, 'all');
      expect(selectedUpdates.every(update => update.group === mockSelectedGroupId)).toBeTruthy();
    });

    it('displays the option to fetch more as long as there are unfetched updates left', async () => {
      const mockSelectedGroupId = uuidv4();
      updatesToResolve
        .mockReturnValueOnce(createMockUpdate({ group: mockSelectedGroupId }))
        .mockReturnValueOnce(createMockUpdate())
        .mockReturnValueOnce(createMockUpdate({ platformFlag: 'android' }));
      jest
        .mocked(selectAsync)
        .mockResolvedValueOnce('_fetchMore')
        .mockResolvedValueOnce('_fetchMore')
        .mockResolvedValueOnce(mockSelectedGroupId);

      await getUpdatesToRepublishInteractiveAsync('test-project', branchName, 'all');
      const { calls } = jest.mocked(selectAsync).mock;
      expect(calls.length).toEqual(3);
      const [[, firstOptions], [, secondOptions], [, thirdOptions]] = calls;
      const fetchMoreValue = '_fetchMore';
      expect(firstOptions[firstOptions.length - 1].value).toEqual(fetchMoreValue);
      expect(firstOptions.length).toEqual(2);
      expect(secondOptions[secondOptions.length - 1].value).toEqual(fetchMoreValue);
      expect(secondOptions.length).toEqual(3);
      expect(thirdOptions.every(update => update.value !== fetchMoreValue)).toBeTruthy();
    });
  });
});
