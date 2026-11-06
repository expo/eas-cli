import { CombinedError } from '@urql/core';
import { GraphQLError } from 'graphql';

import { mockTestCommand } from '../../../../__tests__/commands/utils';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  GitHubAppInstallationAccountType,
  GitHubAppInstallationStatus,
  GitHubRepositoryAppQuery,
} from '../../../../graphql/generated';
import { GitHubRepositoryMutation } from '../../../../graphql/mutations/GitHubRepositoryMutation';
import { GitHubRepositoryQuery } from '../../../../graphql/queries/GitHubRepositoryQuery';
import { promptAsync } from '../../../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../../utils/json';
import IntegrationsGitHubConnect from '../connect';

jest.mock('../../../../graphql/queries/GitHubRepositoryQuery');
jest.mock('../../../../graphql/mutations/GitHubRepositoryMutation');
jest.mock('../../../../log');
jest.mock('../../../../ora');
jest.mock('../../../../prompts');
jest.mock('../../../../utils/json');

const graphqlClient = {} as ExpoGraphqlClient;
const disconnectedApp: GitHubRepositoryAppQuery['app']['byId'] = {
  id: 'project-id',
  fullName: '@expo/mobile',
  slug: 'mobile',
  ownerAccount: { id: 'account-id', name: 'expo' },
  githubRepository: null,
  githubRepositorySettings: null,
};
const repository = { id: 123, nodeId: 'R_123', name: 'mobile', owner: { login: 'expo' } };
const connectedApp: GitHubRepositoryAppQuery['app']['byId'] = {
  ...disconnectedApp,
  githubRepository: {
    id: 'repository-id',
    githubRepositoryIdentifier: 123,
    metadata: {
      id: 'metadata-id',
      githubRepoName: 'mobile',
      githubRepoOwnerName: 'expo',
      githubRepoUrl: 'https://github.com/expo/mobile',
    },
  },
  githubRepositorySettings: { id: 'settings-id', baseDirectory: '/' },
};
const installation = {
  id: 'installation-id',
  installationIdentifier: 456,
  metadata: {
    githubAccountName: 'expo',
    githubAccountType: GitHubAppInstallationAccountType.Organization,
    installationStatus: GitHubAppInstallationStatus.Active,
  },
  registration: null,
};

function createCommand(args: string[]): IntegrationsGitHubConnect {
  return mockTestCommand(IntegrationsGitHubConnect, args, {
    projectId: disconnectedApp.id,
    loggedIn: { graphqlClient },
  });
}

describe(IntegrationsGitHubConnect, () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(GitHubRepositoryMutation.createAsync).mockResolvedValue(undefined);
    jest.mocked(GitHubRepositoryMutation.createSettingsAsync).mockResolvedValue(undefined);
    jest.mocked(GitHubRepositoryMutation.updateSettingsAsync).mockResolvedValue(undefined);
    jest.mocked(GitHubRepositoryQuery.getAppAsync).mockReset().mockResolvedValue(connectedApp);
    jest.mocked(GitHubRepositoryQuery.getAppAsync).mockResolvedValueOnce(disconnectedApp);
    jest
      .mocked(GitHubRepositoryQuery.getAccountInstallationsAsync)
      .mockResolvedValue([installation]);
    jest.mocked(GitHubRepositoryQuery.findRepositoryAsync).mockResolvedValue(repository);
  });

  it('links the accessible repository and configures the repository root', async () => {
    await createCommand(['--repo', 'expo/mobile', '--non-interactive']).runAsync();

    expect(GitHubRepositoryQuery.getAccountInstallationsAsync).toHaveBeenCalledWith(
      graphqlClient,
      'expo'
    );
    expect(GitHubRepositoryQuery.findRepositoryAsync).toHaveBeenCalledWith(
      graphqlClient,
      456,
      'expo/mobile'
    );
    expect(GitHubRepositoryMutation.createAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'project-id',
      githubAppInstallationId: 'installation-id',
      githubRepositoryIdentifier: 123,
      nodeIdentifier: 'R_123',
    });
    expect(GitHubRepositoryMutation.createSettingsAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'project-id',
      baseDirectory: '/',
    });
    expect(promptAsync).not.toHaveBeenCalled();
  });

  it('prompts for a repository interactively', async () => {
    jest.mocked(promptAsync).mockResolvedValue({ repo: 'expo/mobile' });
    await createCommand([]).runAsync();
    expect(promptAsync).toHaveBeenCalled();
    expect(GitHubRepositoryMutation.createAsync).toHaveBeenCalled();
  });

  it('prints the verified connection as JSON without prompting', async () => {
    await createCommand(['--repo', 'expo/mobile', '--json']).runAsync();
    expect(enableJsonOutput).toHaveBeenCalled();
    expect(printJsonOnlyOutput).toHaveBeenCalledWith({
      projectId: 'project-id',
      projectFullName: '@expo/mobile',
      connected: true,
      repository: {
        id: 'repository-id',
        fullName: 'expo/mobile',
        url: 'https://github.com/expo/mobile',
        githubRepositoryIdentifier: 123,
      },
      baseDirectory: '/',
    });
    expect(promptAsync).not.toHaveBeenCalled();
  });

  it.each(['--non-interactive', '--json'])(
    'requires --repo with %s before querying the project',
    async flag => {
      const command = createCommand([flag]);
      await expect(command.runAsync()).rejects.toThrow('--repo is required');
      expect(GitHubRepositoryQuery.getAppAsync).not.toHaveBeenCalled();
      expect(promptAsync).not.toHaveBeenCalled();
    }
  );

  it.each(['mobile', 'https://github.com/expo/mobile', 'expo/mobile/extra', 'expo/'])(
    'rejects invalid repository %s',
    async repo => {
      await expect(createCommand(['--repo', repo]).runAsync()).rejects.toThrow(
        'Invalid GitHub repository'
      );
      expect(GitHubRepositoryMutation.createAsync).not.toHaveBeenCalled();
    }
  );

  it('requires a nonempty base directory', async () => {
    await expect(
      createCommand(['--repo', 'expo/mobile', '--base-directory', ' ']).runAsync()
    ).rejects.toThrow('--base-directory must not be empty');
    expect(GitHubRepositoryMutation.createAsync).not.toHaveBeenCalled();
  });

  it('matches installation and repository names case insensitively', async () => {
    await createCommand(['--repo', 'EXPO/Mobile']).runAsync();
    expect(GitHubRepositoryMutation.createAsync).toHaveBeenCalled();
  });

  it.each(
    [
      [],
      [
        {
          ...installation,
          metadata: { ...installation.metadata, githubAccountName: 'another-owner' },
        },
      ],
      [
        {
          ...installation,
          metadata: {
            ...installation.metadata,
            installationStatus: GitHubAppInstallationStatus.Suspended,
          },
        },
      ],
      [
        {
          ...installation,
          registration: { id: 'enterprise-id', origin: 'https://github.example.com' },
        },
      ],
    ].map(installations => ({ installations }))
  )(
    'fails before linking without a matching active github.com installation (%j)',
    async ({ installations }) => {
      jest
        .mocked(GitHubRepositoryQuery.getAccountInstallationsAsync)
        .mockResolvedValue(installations);
      await expect(createCommand(['--repo', 'expo/mobile']).runAsync()).rejects.toThrow(
        'Set up the GitHub connection in the EAS dashboard: https://expo.dev/accounts/expo/projects/mobile/github'
      );
      expect(GitHubRepositoryQuery.findRepositoryAsync).not.toHaveBeenCalled();
      expect(GitHubRepositoryMutation.createAsync).not.toHaveBeenCalled();
    }
  );

  it('links organization installation settings when the repository is not accessible', async () => {
    jest.mocked(GitHubRepositoryQuery.findRepositoryAsync).mockResolvedValue(null);
    await expect(createCommand(['--repo', 'expo/mobile']).runAsync()).rejects.toThrow(
      'If the Expo GitHub app is configured for "Only select repositories", add expo/mobile under Repository access and save: https://github.com/organizations/expo/settings/installations/456'
    );
    expect(GitHubRepositoryMutation.createAsync).not.toHaveBeenCalled();
    expect(GitHubRepositoryMutation.createSettingsAsync).not.toHaveBeenCalled();
  });

  it('links personal installation settings when the repository is not accessible', async () => {
    jest.mocked(GitHubRepositoryQuery.getAccountInstallationsAsync).mockResolvedValue([
      {
        ...installation,
        metadata: {
          ...installation.metadata,
          githubAccountType: GitHubAppInstallationAccountType.User,
        },
      },
    ]);
    jest.mocked(GitHubRepositoryQuery.findRepositoryAsync).mockResolvedValue(null);
    await expect(createCommand(['--repo', 'expo/mobile']).runAsync()).rejects.toThrow(
      'https://github.com/settings/installations/456'
    );
    expect(GitHubRepositoryMutation.createAsync).not.toHaveBeenCalled();
  });

  it.each(['GITHUB_USER_NOT_FOUND_ERROR', 'GITHUB_AUTHENTICATION_ERROR'])(
    'links personal Expo settings for %s',
    async errorCode => {
      jest.mocked(GitHubRepositoryQuery.findRepositoryAsync).mockRejectedValue(
        new CombinedError({
          graphQLErrors: [
            new GraphQLError('GitHub authorization failed', {
              extensions: { errorCode },
            }),
          ],
        })
      );
      await expect(createCommand(['--repo', 'expo/mobile', '--json']).runAsync()).rejects.toThrow(
        'Connect or reconnect GitHub under Connections in your Expo personal settings: https://expo.dev/settings'
      );
      expect(GitHubRepositoryMutation.createAsync).not.toHaveBeenCalled();
      expect(printJsonOnlyOutput).not.toHaveBeenCalled();
    }
  );

  it('preserves unrelated GraphQL errors', async () => {
    const error = new CombinedError({
      graphQLErrors: [
        new GraphQLError('Permission denied', {
          extensions: { errorCode: 'FORBIDDEN_ERROR' },
        }),
      ],
    });
    jest.mocked(GitHubRepositoryQuery.findRepositoryAsync).mockRejectedValue(error);
    await expect(createCommand(['--repo', 'expo/mobile']).runAsync()).rejects.toBe(error);
  });

  it('uses the staging EAS dashboard for setup when EXPO_STAGING is enabled', async () => {
    const previousStaging = process.env.EXPO_STAGING;
    process.env.EXPO_STAGING = '1';
    try {
      jest.mocked(GitHubRepositoryQuery.getAccountInstallationsAsync).mockResolvedValue([]);
      await expect(createCommand(['--repo', 'expo/mobile']).runAsync()).rejects.toThrow(
        'https://staging.expo.dev/accounts/expo/projects/mobile/github'
      );
    } finally {
      if (previousStaging === undefined) {
        delete process.env.EXPO_STAGING;
      } else {
        process.env.EXPO_STAGING = previousStaging;
      }
    }
  });

  it('does not overwrite a different repository connection', async () => {
    jest.mocked(GitHubRepositoryQuery.getAppAsync).mockReset().mockResolvedValue(connectedApp);
    await expect(createCommand(['--repo', 'expo/other']).runAsync()).rejects.toThrow(
      'already connected'
    );
    expect(GitHubRepositoryMutation.createAsync).not.toHaveBeenCalled();
    expect(GitHubRepositoryMutation.updateSettingsAsync).not.toHaveBeenCalled();
  });

  it('does not treat an Enterprise repository with the same name as github.com', async () => {
    jest
      .mocked(GitHubRepositoryQuery.getAppAsync)
      .mockReset()
      .mockResolvedValue({
        ...connectedApp,
        githubRepository: {
          ...connectedApp.githubRepository!,
          metadata: {
            ...connectedApp.githubRepository!.metadata,
            githubRepoUrl: 'https://github.example.com/expo/mobile',
          },
        },
      });
    await expect(createCommand(['--repo', 'expo/mobile']).runAsync()).rejects.toThrow(
      'already connected'
    );
    expect(GitHubRepositoryMutation.createAsync).not.toHaveBeenCalled();
  });

  it('succeeds without mutations when the repository is already connected', async () => {
    jest.mocked(GitHubRepositoryQuery.getAppAsync).mockReset().mockResolvedValue(connectedApp);
    await createCommand(['--repo', 'EXPO/Mobile', '--non-interactive']).runAsync();
    expect(GitHubRepositoryQuery.getAccountInstallationsAsync).not.toHaveBeenCalled();
    expect(GitHubRepositoryMutation.createAsync).not.toHaveBeenCalled();
    expect(GitHubRepositoryMutation.createSettingsAsync).not.toHaveBeenCalled();
    expect(GitHubRepositoryMutation.updateSettingsAsync).not.toHaveBeenCalled();
  });

  it('preserves existing base directory settings when connecting', async () => {
    jest
      .mocked(GitHubRepositoryQuery.getAppAsync)
      .mockReset()
      .mockResolvedValue({
        ...disconnectedApp,
        githubRepositorySettings: { id: 'settings-id', baseDirectory: 'apps/mobile' },
      });
    await createCommand(['--repo', 'expo/mobile']).runAsync();
    expect(GitHubRepositoryMutation.createAsync).toHaveBeenCalled();
    expect(GitHubRepositoryMutation.createSettingsAsync).not.toHaveBeenCalled();
    expect(GitHubRepositoryMutation.updateSettingsAsync).not.toHaveBeenCalled();
  });

  it('creates monorepo settings with the requested base directory', async () => {
    await createCommand(['--repo', 'expo/mobile', '--base-directory', 'apps/mobile']).runAsync();
    expect(GitHubRepositoryMutation.createSettingsAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: 'project-id',
      baseDirectory: 'apps/mobile',
    });
  });

  it('updates an existing base directory only when explicitly requested', async () => {
    jest.mocked(GitHubRepositoryQuery.getAppAsync).mockReset().mockResolvedValue(connectedApp);
    await createCommand(['--repo', 'expo/mobile', '--base-directory', 'apps/mobile']).runAsync();
    expect(GitHubRepositoryMutation.updateSettingsAsync).toHaveBeenCalledWith(
      graphqlClient,
      'settings-id',
      'apps/mobile'
    );
    expect(GitHubRepositoryMutation.createAsync).not.toHaveBeenCalled();
  });

  it('can finish setting up a connection after creating settings failed', async () => {
    jest
      .mocked(GitHubRepositoryQuery.getAppAsync)
      .mockReset()
      .mockResolvedValue({ ...connectedApp, githubRepositorySettings: null });
    await createCommand(['--repo', 'expo/mobile']).runAsync();
    expect(GitHubRepositoryMutation.createAsync).not.toHaveBeenCalled();
    expect(GitHubRepositoryMutation.createSettingsAsync).toHaveBeenCalled();
  });

  it('propagates discovery failures without linking anything', async () => {
    jest
      .mocked(GitHubRepositoryQuery.findRepositoryAsync)
      .mockRejectedValue(new Error('Reconnect your GitHub account'));
    await expect(createCommand(['--repo', 'expo/mobile']).runAsync()).rejects.toThrow(
      'Reconnect your GitHub account'
    );
    expect(GitHubRepositoryMutation.createAsync).not.toHaveBeenCalled();
  });

  it('does not print a successful connection when settings fail', async () => {
    jest
      .mocked(GitHubRepositoryMutation.createSettingsAsync)
      .mockRejectedValue(new Error('Invalid base directory'));
    await expect(createCommand(['--repo', 'expo/mobile', '--json']).runAsync()).rejects.toThrow(
      'Invalid base directory'
    );
    expect(printJsonOnlyOutput).not.toHaveBeenCalled();
  });
});
