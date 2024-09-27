import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  App,
  DeploymentResult,
  Runtime,
  UpdateBranch,
  UpdateChannel,
  UpdateInsights,
} from '../../graphql/generated';
import { ChannelQuery } from '../../graphql/queries/ChannelQuery';
import { getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync } from '../getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync';

jest.mock('../../graphql/queries/ChannelQuery');
jest.mock('../../graphql/queries/BranchQuery');

describe(getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync, () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('returns branch name when channel exists and has one connected branch', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    jest.mocked(ChannelQuery.viewUpdateChannelAsync).mockImplementationOnce(
      async () =>
        mockUpdateChannel({
          channelName: 'test-channel-name',
          branchNames: ['test-branch-name'],
        }) as any
    );

    const result = await getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync(
      graphqlClient,
      'test-project-id',
      'channel-name'
    );

    expect(result.branchId).toBeTruthy();
    expect(result.branchName).toBe('test-branch-name');
  });

  test('errors when no branch is connected to channel', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    jest.mocked(ChannelQuery.viewUpdateChannelAsync).mockImplementationOnce(
      async () =>
        mockUpdateChannel({
          channelName: 'test-channel-name',
        }) as any
    );

    await expect(
      getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync(
        graphqlClient,
        'test-project-id',
        'test-channel-name'
      )
    ).rejects.toThrow(
      "Channel has no branches associated with it. Run 'eas channel:edit' to map a branch"
    );
  });

  test('errors when more than one branch is connected to channel', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    jest.mocked(ChannelQuery.viewUpdateChannelAsync).mockImplementationOnce(
      async () =>
        mockUpdateChannel({
          channelName: 'test-channel-name',
          branchNames: ['test-branch-name', 'test-branch-name-2'],
        }) as any
    );

    await expect(
      getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync(
        graphqlClient,
        'test-project-id',
        'test-channel-name'
      )
    ).rejects.toThrow(
      "Channel has multiple branches associated with it. Instead, use '--branch' instead of '--channel'"
    );
  });

  test('creates channel and branch when channel does not exist, and returns branch name', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    jest.mocked(ChannelQuery.viewUpdateChannelAsync).mockImplementationOnce(
      async () =>
        mockUpdateChannel({
          channelName: 'test-channel-name',
          branchNames: ['test-branch-name'],
        }) as any
    );

    const result = await getBranchFromChannelNameAndCreateAndLinkIfNotExistsAsync(
      graphqlClient,
      'test-project-id',
      'test-channel-name'
    );

    expect(result.branchName).toBe('test-branch-name');
  });
});

function mockUpdateChannel({
  channelName,
  branchNames,
}: {
  channelName?: string;
  branchNames?: string[];
}): UpdateChannel {
  return {
    id: 'a2a1fa12-9d6a-433a-a432-49c64ef8439f',
    app: {} as App,
    name: channelName ?? 'default-channel-name',
    createdAt: '2022-12-07T02:24:29.786Z',
    appId: '123',
    updatedAt: '2022-12-07T02:24:29.786Z',
    branchMapping:
      '{"data":[{"branchId":"f9dc4dbb-663f-4a19-8cf2-a783b484d2db","branchMappingLogic":"true"}],"version":0}',
    updateBranches: branchNames ? mockUpdateBranches(branchNames) : [],
    isPaused: false,
    __typename: 'UpdateChannel',
  };
}

function mockUpdateBranches(branchNames: string[]): UpdateBranch[] {
  return branchNames.map(branchName => ({
    id: 'f9dc4dbb-663f-4a19-8cf2-a783b484d2db',
    latestActivity: '2022-12-07T02:24:29.786Z',
    name: branchName ?? 'default-branch-name',
    app: {} as App,
    appId: '123',
    createdAt: '2022-12-07T02:24:29.786Z',
    updatedAt: '2022-12-07T02:24:29.786Z',
    updates: [],
    runtimes: { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
    updateGroups: [
      [
        {
          id: '8503286d-4b18-4b38-a0f7-2b9ae09531a0',
          group: 'd715bc20-76b5-477b-a060-3f8184aae87a',
          message: 'my message',
          createdAt: '2022-12-07T02:24:43.487Z',
          runtimeVersion: '1.0.0',
          runtime: {} as Runtime, // Temporary fix to resolve type errors
          insights: {} as UpdateInsights, // Temporary fix to resolve type errors
          deployments: {} as DeploymentResult, // Temporary fix to resolve type errors
          platform: 'ios',
          manifestFragment: '...',
          isRollBackToEmbedded: false,
          activityTimestamp: '2022-12-07T02:24:43.487Z',
          branchId: '',
          awaitingCodeSigningInfo: false,
          isGitWorkingTreeDirty: false,
          manifestPermalink: '...',
          updatedAt: '2022-12-07T02:24:43.487Z',
          gitCommitHash: 'abc5baf77eee821b800af97879d19cc3132b46a7',
          actor: {
            __typename: 'User' as const,
            id: 'f42b73a3-ce6c-4059-a825-e5ddafa022f7',
            username: 'jonexpo',
          } as any,
          branch: {
            id: 'f9dc4dbb-663f-4a19-8cf2-a783b484d2db',
            name: 'production3',
            app: {} as App,
            appId: '123',
            createdAt: '2022-12-07T02:24:29.786Z',
            updatedAt: '2022-12-07T02:24:29.786Z',
            updateGroups: [],
            updates: [],
            runtimes: { edges: [], pageInfo: { hasNextPage: false, hasPreviousPage: false } },
            __typename: 'UpdateBranch' as const,
            latestActivity: '2022-12-07T02:24:29.786Z',
          },
          codeSigningInfo: null,
          __typename: 'Update' as const,
          app: {} as App,
        },
      ],
    ],
    __typename: 'UpdateBranch' as const,
  }));
}
