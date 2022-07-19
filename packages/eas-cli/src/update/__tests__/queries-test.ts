import { graphqlClient } from '../../graphql/client';
import { UpdateObject } from '../../graphql/queries/UpdateQuery';

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

const updatesToResolve = jest.fn((): UpdateObject[] => []);

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
    // mutation: jest.fn(() => {}),
  },
}));

describe('ensureBranchExistsAsync', () => {
  beforeEach(() => {
    jest.mocked(graphqlClient.query).mockClear();
    jest.mocked(graphqlClient.mutation).mockClear();
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
