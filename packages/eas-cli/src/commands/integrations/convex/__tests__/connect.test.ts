import spawnAsync from '@expo/spawn-async';
import * as fs from 'fs-extra';

import { getMockOclifConfig } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testProjectId } from '../../../../credentials/__tests__/fixtures-constants';
import { ConvexMutation } from '../../../../graphql/mutations/ConvexMutation';
import { ConvexQuery } from '../../../../graphql/queries/ConvexQuery';
import {
  ConvexTeamConnectionData,
  SetupConvexProjectResultData,
} from '../../../../graphql/types/ConvexTeamConnection';
import Log from '../../../../log';
import { getOwnerAccountForProjectIdAsync } from '../../../../project/projectUtils';
import { confirmAsync, promptAsync, selectAsync } from '../../../../prompts';
import { Actor } from '../../../../user/User';
import IntegrationsConvexConnect from '../connect';

jest.mock('../../../../graphql/queries/ConvexQuery');
jest.mock('../../../../graphql/mutations/ConvexMutation');
jest.mock('../../../../project/projectUtils');
jest.mock('../../../../prompts');
jest.mock('@expo/spawn-async');
jest.mock('fs-extra');
jest.mock('../../../../log');
jest.mock('../../../../ora', () => ({
  ora: () => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  }),
}));

describe(IntegrationsConvexConnect, () => {
  const graphqlClient = {} as ExpoGraphqlClient;
  const mockConfig = getMockOclifConfig();
  const testProjectDir = '/test/project';
  const testAccountId = 'test-account-id';
  const testAccountName = 'testuser';

  const mockActor: Actor = {
    __typename: 'User',
    id: 'test-user-id',
    username: testAccountName,
    email: 'user@example.com',
    featureGates: {},
    isExpoAdmin: false,
    primaryAccount: {
      id: testAccountId,
      name: testAccountName,
      ownerUserActor: null,
      users: [],
    },
    preferences: { onboarding: null },
    accounts: [],
  };

  const mockRobotActor: Actor = {
    __typename: 'Robot',
    id: 'robot-1',
    featureGates: {},
    isExpoAdmin: false,
    accounts: [],
  };

  const mockAccount = {
    id: testAccountId,
    name: testAccountName,
    ownerUserActor: { id: 'test-user-id', username: testAccountName },
    users: [{ role: 'OWNER' as any, actor: { id: 'test-user-id' } }],
  };

  const mockConnection: ConvexTeamConnectionData = {
    id: 'connection-1',
    convexTeamIdentifier: 'team-123',
    convexTeamName: 'Test Team',
    convexTeamSlug: 'test-team',
    hasBeenClaimed: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    invitedAt: null,
    invitedEmail: null,
  };

  const mockSetupResult: SetupConvexProjectResultData = {
    convexDeploymentName: 'happy-otter-123',
    convexDeploymentUrl: 'https://happy-otter-123.convex.cloud',
    deployKey: 'dev:happy-otter-123|abc123token',
    convexProject: {
      id: 'convex-project-1',
      convexProjectIdentifier: 'project-123',
      convexProjectName: 'testapp',
      convexProjectSlug: 'testapp',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      convexTeamConnection: mockConnection,
    },
  };

  function createCommand(argv: string[], actor: Actor = mockActor): IntegrationsConvexConnect {
    const command = new IntegrationsConvexConnect(argv, mockConfig);
    jest.spyOn(command as any, 'getContextAsync').mockReturnValue({
      privateProjectConfig: {
        projectId: testProjectId,
        exp: { name: 'testapp', slug: 'testapp' },
        projectDir: testProjectDir,
      },
      loggedIn: { graphqlClient, actor },
    } as never);
    return command;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Log, 'log').mockImplementation(() => {});
    jest.spyOn(Log, 'warn').mockImplementation(() => {});
    jest.spyOn(Log, 'withTick').mockImplementation(() => {});
    jest.spyOn(Log, 'addNewLineIfNone').mockImplementation(() => {});
    jest.spyOn(Log, 'newLine').mockImplementation(() => {});

    jest.mocked(fs.pathExists).mockResolvedValue(false as never);
    jest.mocked(fs.writeFile).mockResolvedValue(undefined as never);
    jest.mocked(fs.readFile).mockResolvedValue('' as never);
    jest.mocked(spawnAsync).mockResolvedValue({} as never);

    jest.mocked(getOwnerAccountForProjectIdAsync).mockResolvedValue(mockAccount as any);
    jest.mocked(selectAsync).mockResolvedValue('aws-us-east-1');
    jest.mocked(confirmAsync).mockResolvedValue(true);
    jest.mocked(promptAsync).mockImplementation(async (params: any) => ({
      [params.name]: params.initial,
    }));
    jest.mocked(ConvexMutation.createConvexTeamConnectionAsync).mockResolvedValue(mockConnection);
    jest.mocked(ConvexMutation.setupConvexProjectAsync).mockResolvedValue(mockSetupResult);
    jest.mocked(ConvexMutation.sendConvexTeamInviteToVerifiedEmailAsync).mockResolvedValue(true);
  });

  it('creates a Convex team and project with the new mutation shape', async () => {
    jest.mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync).mockResolvedValue([]);

    await createCommand([]).runAsync();

    expect(ConvexMutation.createConvexTeamConnectionAsync).toHaveBeenCalledWith(graphqlClient, {
      accountId: testAccountId,
      deploymentRegion: 'aws-us-east-1',
      convexTeamName: testAccountName,
    });
    expect(ConvexMutation.setupConvexProjectAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      convexTeamConnectionId: 'connection-1',
      deploymentRegion: 'aws-us-east-1',
      projectName: 'testapp',
    });
    expect(ConvexMutation.sendConvexTeamInviteToVerifiedEmailAsync).toHaveBeenCalledWith(
      graphqlClient,
      { convexTeamConnectionId: 'connection-1' }
    );
    expect(Log.log).toHaveBeenCalledWith(
      expect.stringContaining('Check your email for an invitation')
    );
    expect(spawnAsync).toHaveBeenCalledWith('npx', ['expo', 'install', 'convex'], {
      cwd: testProjectDir,
      stdio: 'inherit',
    });
  });

  it('uses an existing Convex team connection', async () => {
    jest
      .mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync)
      .mockResolvedValue([mockConnection]);

    await createCommand(['--region', 'aws-eu-west-1']).runAsync();

    expect(ConvexMutation.createConvexTeamConnectionAsync).not.toHaveBeenCalled();
    expect(ConvexMutation.setupConvexProjectAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: testProjectId,
      convexTeamConnectionId: 'connection-1',
      deploymentRegion: 'aws-eu-west-1',
      projectName: 'testapp',
    });
    expect(spawnAsync).toHaveBeenCalledWith('npx', ['expo', 'install', 'convex'], {
      cwd: testProjectDir,
      stdio: 'inherit',
    });
  });

  it('does not create a Convex team if installing the Convex package fails first', async () => {
    jest.mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync).mockResolvedValue([]);
    jest.mocked(spawnAsync).mockRejectedValue(new Error('install failed') as never);

    await expect(createCommand([]).runAsync()).rejects.toThrow('install failed');

    expect(ConvexMutation.createConvexTeamConnectionAsync).not.toHaveBeenCalled();
    expect(ConvexMutation.setupConvexProjectAsync).not.toHaveBeenCalled();
  });

  it('skips the verified email invite when the actor has no email', async () => {
    jest
      .mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync)
      .mockResolvedValue([mockConnection]);

    await createCommand([], mockRobotActor).runAsync();

    expect(ConvexMutation.sendConvexTeamInviteToVerifiedEmailAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not determine your verified email address')
    );
    expect(Log.warn).not.toHaveBeenCalledWith(expect.stringContaining('Convex dashboard'));
  });

  it('logs the error when sending a verified email invite fails', async () => {
    jest
      .mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync)
      .mockResolvedValue([mockConnection]);
    jest
      .mocked(ConvexMutation.sendConvexTeamInviteToVerifiedEmailAsync)
      .mockRejectedValue(new Error('Convex invite service unavailable'));

    await createCommand([]).runAsync();

    expect(Log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to send Convex team invitation to user@example.com')
    );
    expect(Log.warn).toHaveBeenCalledWith('Convex invite service unavailable');
    expect(Log.warn).not.toHaveBeenCalledWith(expect.stringContaining('Convex dashboard'));
  });

  it('asks before resending a recent team invite for an existing connection', async () => {
    jest.mocked(confirmAsync).mockResolvedValue(false);
    jest.mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync).mockResolvedValue([
      {
        ...mockConnection,
        invitedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        invitedEmail: 'user@example.com',
      },
    ]);

    await createCommand([]).runAsync();

    expect(confirmAsync).toHaveBeenCalledWith({
      message: expect.stringContaining('Are you sure you want to send another invite?'),
    });
    expect(ConvexMutation.sendConvexTeamInviteToVerifiedEmailAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith('Skipped sending Convex team invitation.');
    expect(Log.log).not.toHaveBeenCalledWith(
      expect.stringContaining('Check your email for an invitation')
    );
  });

  it('skips sending an invite when the Convex team has already been claimed', async () => {
    jest.mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync).mockResolvedValue([
      {
        ...mockConnection,
        hasBeenClaimed: true,
        invitedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
    ]);

    await createCommand([]).runAsync();

    expect(confirmAsync).not.toHaveBeenCalledWith({
      message: expect.stringContaining('Are you sure you want to send another invite?'),
    });
    expect(ConvexMutation.sendConvexTeamInviteToVerifiedEmailAsync).not.toHaveBeenCalled();
    expect(Log.warn).toHaveBeenCalledWith(
      'Convex team has already been claimed. Skipping Convex team invitation.'
    );
    expect(Log.log).not.toHaveBeenCalledWith(
      expect.stringContaining('Check your email for an invitation')
    );
  });

  it('writes the deploy key and Convex URL to .env.local', async () => {
    jest
      .mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync)
      .mockResolvedValue([mockConnection]);

    await createCommand([]).runAsync();

    const envPath = `${testProjectDir}/.env.local`;
    const writeCall = jest.mocked(fs.writeFile).mock.calls.find(call => call[0] === envPath);
    expect(writeCall?.[1]).toContain('CONVEX_DEPLOY_KEY=dev:happy-otter-123|abc123token');
    expect(writeCall?.[1]).toContain('EXPO_PUBLIC_CONVEX_URL=https://happy-otter-123.convex.cloud');
  });

  it('prompts before overwriting existing Convex .env.local values', async () => {
    jest
      .mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync)
      .mockResolvedValue([mockConnection]);
    jest.mocked(fs.pathExists).mockResolvedValue(true as never);
    jest.mocked(fs.readFile).mockResolvedValue('CONVEX_DEPLOY_KEY=old-key\n' as never);
    jest.mocked(confirmAsync).mockResolvedValue(true);

    await createCommand([]).runAsync();

    expect(confirmAsync).toHaveBeenCalledWith({
      message: expect.stringContaining('already contains CONVEX_DEPLOY_KEY'),
    });
  });

  it('uses defaults in non-interactive mode', async () => {
    jest.mocked(ConvexQuery.getConvexTeamConnectionsByAccountIdAsync).mockResolvedValue([]);

    await createCommand(['--non-interactive']).runAsync();

    expect(selectAsync).not.toHaveBeenCalled();
    expect(promptAsync).not.toHaveBeenCalled();
    expect(ConvexMutation.createConvexTeamConnectionAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({
        deploymentRegion: 'aws-us-east-1',
        convexTeamName: testAccountName,
      })
    );
    expect(ConvexMutation.setupConvexProjectAsync).toHaveBeenCalledWith(
      graphqlClient,
      expect.objectContaining({
        appId: testProjectId,
        deploymentRegion: 'aws-us-east-1',
        projectName: 'testapp',
      })
    );
  });
});
