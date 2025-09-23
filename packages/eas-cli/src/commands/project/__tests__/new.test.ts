import { ExpoConfig } from '@expo/config';
import fs from 'fs-extra';
import { vol } from 'memfs';
import path from 'path';
import { instance, mock } from 'ts-mockito';

import LoggedInContextField from '../../../commandUtils/context/LoggedInContextField';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import FeatureGateEnvOverrides from '../../../commandUtils/gating/FeatureGateEnvOverrides';
import FeatureGating from '../../../commandUtils/gating/FeatureGating';
import { jester, robot } from '../../../credentials/__tests__/fixtures-constants';
import { Role } from '../../../graphql/generated';
import { AppMutation } from '../../../graphql/mutations/AppMutation';
import { canAccessRepositoryUsingSshAsync, runGitCloneAsync } from '../../../onboarding/git';
import {
  installDependenciesAsync,
  promptForPackageManagerAsync,
} from '../../../onboarding/installDependencies';
import { runCommandAsync } from '../../../onboarding/runCommand';
import {
  createOrModifyExpoConfigAsync,
  getPrivateExpoConfigAsync,
} from '../../../project/expoConfig';
import { findProjectIdByAccountNameAndSlugNullableAsync } from '../../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import { confirmAsync, promptAsync } from '../../../prompts';
import { Actor } from '../../../user/User';
import New from '../new';

// Test helper types
interface MockExpoConfig extends Partial<ExpoConfig> {
  name: string;
  slug: string;
  owner?: string;
  extra?: {
    eas?: {
      projectId?: string;
      [key: string]: any;
    };
    [key: string]: any;
  };
}

interface MockConfigResult {
  type: 'success' | 'warn' | 'fail';
  message?: string;
  config: ExpoConfig | null;
}

jest.mock('fs');
jest.mock('fs-extra');
jest.mock('../../../graphql/mutations/AppMutation');
jest.mock('../../../onboarding/git');
jest.mock('../../../onboarding/installDependencies');
jest.mock('../../../onboarding/runCommand');
jest.mock('../../../project/expoConfig');
jest.mock('../../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync');
jest.mock('../../../prompts');

jest.mock('../../../ora', () => ({
  ora: () => ({
    start: () => ({ succeed: () => {}, fail: () => {} }),
  }),
}));

let originalProcessArgv: string[];

beforeAll(() => {
  originalProcessArgv = process.argv;
  process.argv = [];
});

afterAll(() => {
  process.argv = originalProcessArgv;
});

function mockLoggedInContext(actor: Actor): void {
  const graphqlClient = instance(mock<ExpoGraphqlClient>());

  jest.spyOn(LoggedInContextField.prototype, 'getValueAsync').mockResolvedValue({
    actor,
    featureGating: new FeatureGating({}, new FeatureGateEnvOverrides()),
    graphqlClient,
    authenticationInfo: { accessToken: 'test-token', sessionSecret: null },
  });
}

function mockFileSystem(targetDir: string): void {
  const projectFiles = {
    [path.join(targetDir, 'package.json')]: JSON.stringify(
      {
        name: 'expo-template-default',
        version: '1.0.0',
        scripts: {
          start: 'expo start',
        },
      },
      null,
      2
    ),
    [path.join(targetDir, 'App.js')]: 'export default function App() { return null; }',
    [path.join(targetDir, '.git', 'config')]: '[core]\n\trepositoryformatversion = 0',
  };

  vol.fromJSON(projectFiles, '/');
}

beforeEach(() => {
  jest.resetAllMocks();
  vol.reset();
});

describe(New.name, () => {
  const targetProjectDir = '/test/my-new-project';
  const commandOptions = { root: process.cwd() } as any;

  describe('successful project creation', () => {
    beforeEach(() => {
      mockLoggedInContext(jester);
      mockFileSystem(targetProjectDir);

      // Mock git operations
      jest.mocked(canAccessRepositoryUsingSshAsync).mockResolvedValue(true);
      jest.mocked(runGitCloneAsync).mockResolvedValue({
        targetProjectDir,
      });
      jest.mocked(installDependenciesAsync).mockResolvedValue();
      jest.mocked(runCommandAsync).mockResolvedValue();

      // Mock package manager selection (default to npm)
      jest.mocked(promptForPackageManagerAsync).mockResolvedValue('npm');

      // Mock fs operations
      (fs.remove as jest.Mock).mockResolvedValue(undefined);

      // Mock project configuration
      jest.mocked(getPrivateExpoConfigAsync).mockResolvedValue({
        name: 'test-app',
        slug: 'test-app',
        owner: jester.accounts[0].name,
      } satisfies MockExpoConfig);

      // Mock project initialization
      jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);
      jest.mocked(AppMutation.createAppAsync).mockResolvedValue('test-project-id');
      jest
        .mocked(createOrModifyExpoConfigAsync)
        .mockResolvedValue({ type: 'success', config: null } satisfies MockConfigResult);
    });

    it('creates a new project with SSH clone method', async () => {
      const command = new New([targetProjectDir], commandOptions);
      await command.run();

      expect(canAccessRepositoryUsingSshAsync).toHaveBeenCalledWith({
        githubUsername: 'expo',
        githubRepositoryName: 'expo-template-default',
      });

      expect(runGitCloneAsync).toHaveBeenCalledWith({
        githubUsername: 'expo',
        githubRepositoryName: 'expo-template-default',
        targetProjectDir,
        cloneMethod: 'ssh',
      });

      expect(fs.remove).toHaveBeenCalledWith(path.join(targetProjectDir, '.git'));

      expect(runCommandAsync).toHaveBeenCalledWith({
        cwd: targetProjectDir,
        command: 'git',
        args: ['init'],
      });

      expect(installDependenciesAsync).toHaveBeenCalledWith({
        projectDir: targetProjectDir,
        packageManager: 'npm',
      });

      expect(runCommandAsync).toHaveBeenCalledWith({
        cwd: targetProjectDir,
        command: 'git',
        args: ['add', '.'],
      });

      expect(runCommandAsync).toHaveBeenCalledWith({
        cwd: targetProjectDir,
        command: 'git',
        args: ['commit', '-m', 'Initial commit'],
      });

      expect(AppMutation.createAppAsync).toHaveBeenCalledTimes(1);
      const createAppCall = jest.mocked(AppMutation.createAppAsync).mock.calls[0];
      expect(createAppCall[1]).toEqual({
        accountId: jester.accounts[0].id,
        projectName: 'jester-app',
      });

      expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith(
        targetProjectDir,
        expect.objectContaining({
          extra: expect.objectContaining({
            eas: expect.objectContaining({
              projectId: 'test-project-id',
            }),
          }),
        }),
        { skipSDKVersionRequirement: true }
      );
    });

    it('creates a new project with HTTPS clone method when SSH fails', async () => {
      jest.mocked(canAccessRepositoryUsingSshAsync).mockResolvedValue(false);

      const command = new New([targetProjectDir], commandOptions);
      await command.run();

      expect(runGitCloneAsync).toHaveBeenCalledWith({
        githubUsername: 'expo',
        githubRepositoryName: 'expo-template-default',
        targetProjectDir,
        cloneMethod: 'https',
      });
    });

    it('logs appropriate messages during project creation', async () => {
      mockLoggedInContext(jester);
      mockFileSystem(targetProjectDir);

      jest.mocked(canAccessRepositoryUsingSshAsync).mockResolvedValue(true);
      jest.mocked(runGitCloneAsync).mockResolvedValue({ targetProjectDir });
      (fs.remove as jest.Mock).mockResolvedValue(undefined);
      jest.mocked(runCommandAsync).mockResolvedValue();
      jest.mocked(installDependenciesAsync).mockResolvedValue();

      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      const command = new New([targetProjectDir], commandOptions);
      await command.run();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'This command is not yet implemented. It will create a new project, but it will not be fully configured.'
        )
      );
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`👋 Welcome to Expo, jester!`));
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "🚚 Let's start by cloning the default Expo template project from GitHub and installing dependencies."
        )
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(`📂 Cloning the project to ${targetProjectDir}`)
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('We detected that ssh is your preferred git clone method')
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('🎉 We finished creating your new project.')
      );

      expect(logSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('Project successfully linked (ID: test-project-id)')
      );

      logSpy.mockRestore();
    });

    it('prompts for target directory when no argument provided', async () => {
      const promptedDirectory = '/test/prompted-project';
      jest.mocked(promptAsync).mockResolvedValue({
        targetProjectDir: promptedDirectory,
      });
      jest.mocked(runGitCloneAsync).mockResolvedValue({
        targetProjectDir: promptedDirectory,
      });

      const command = new New([], commandOptions);
      await command.run();

      expect(promptAsync).toHaveBeenCalledWith({
        type: 'text',
        name: 'targetProjectDir',
        message: 'Where would you like to create your new project directory?',
        initial: path.join(process.cwd(), 'new-expo-project'),
      });

      expect(runGitCloneAsync).toHaveBeenCalledWith({
        githubUsername: 'expo',
        githubRepositoryName: 'expo-template-default',
        targetProjectDir: promptedDirectory,
        cloneMethod: 'ssh',
      });
    });

    it('uses provided argument without prompting', async () => {
      const command = new New([targetProjectDir], commandOptions);
      await command.run();

      expect(promptAsync).not.toHaveBeenCalled();
      expect(runGitCloneAsync).toHaveBeenCalledWith({
        githubUsername: 'expo',
        githubRepositoryName: 'expo-template-default',
        targetProjectDir,
        cloneMethod: 'ssh',
      });
    });

    it('prompts for package manager selection', async () => {
      jest.mocked(promptAsync).mockResolvedValueOnce({
        targetProjectDir,
      });
      jest.mocked(promptForPackageManagerAsync).mockResolvedValueOnce('yarn');

      const command = new New([], commandOptions);
      await command.run();

      expect(promptForPackageManagerAsync).toHaveBeenCalled();

      expect(installDependenciesAsync).toHaveBeenCalledWith({
        projectDir: targetProjectDir,
        packageManager: 'yarn',
      });
    });

    it('defaults to npm when package manager is not selected', async () => {
      jest.mocked(promptAsync).mockResolvedValueOnce({
        targetProjectDir,
      });
      jest.mocked(promptForPackageManagerAsync).mockResolvedValueOnce('npm');

      const command = new New([], commandOptions);
      await command.run();

      expect(installDependenciesAsync).toHaveBeenCalledWith({
        projectDir: targetProjectDir,
        packageManager: 'npm',
      });
    });
  });

  describe('project initialization variants', () => {
    beforeEach(() => {
      mockLoggedInContext(jester);
      mockFileSystem(targetProjectDir);

      // Mock git operations
      jest.mocked(canAccessRepositoryUsingSshAsync).mockResolvedValue(true);
      jest.mocked(runGitCloneAsync).mockResolvedValue({
        targetProjectDir,
      });
      jest.mocked(installDependenciesAsync).mockResolvedValue();
      jest.mocked(runCommandAsync).mockResolvedValue();

      // Mock package manager selection (default to npm)
      jest.mocked(promptForPackageManagerAsync).mockResolvedValue('npm');

      // Mock fs operations
      (fs.remove as jest.Mock).mockResolvedValue(undefined);

      // Default project configuration (can be overridden in individual tests)
      jest.mocked(getPrivateExpoConfigAsync).mockResolvedValue({
        name: 'test-app',
        slug: 'test-app',
        owner: jester.accounts[0].name,
      } satisfies MockExpoConfig);

      // Default project initialization mocks (can be overridden in individual tests)
      jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);
      jest.mocked(AppMutation.createAppAsync).mockResolvedValue('test-project-id');
      jest
        .mocked(createOrModifyExpoConfigAsync)
        .mockResolvedValue({ type: 'success', config: null } satisfies MockConfigResult);
    });

    it('handles project already linked scenario', async () => {
      const existingProjectId = 'existing-project-id';
      jest.mocked(getPrivateExpoConfigAsync).mockResolvedValue({
        name: 'test-app',
        slug: 'test-app',
        extra: {
          eas: {
            projectId: existingProjectId,
          },
        },
      } satisfies MockExpoConfig);

      const command = new New([targetProjectDir], commandOptions);
      await command.run();

      // Should still complete the full project creation flow
      expect(runGitCloneAsync).toHaveBeenCalled();
      expect(installDependenciesAsync).toHaveBeenCalled();
      expect(runCommandAsync).toHaveBeenCalledWith({
        cwd: targetProjectDir,
        command: 'git',
        args: ['commit', '-m', 'Initial commit'],
      });

      // Should not create a new project since one already exists
      expect(AppMutation.createAppAsync).not.toHaveBeenCalled();
    });

    it('links existing project on server when user confirms', async () => {
      const existingProjectId = 'existing-server-project-id';

      jest.mocked(getPrivateExpoConfigAsync).mockResolvedValue({
        name: 'test-app',
        slug: 'test-app',
        owner: jester.accounts[0].name,
      } satisfies MockExpoConfig);

      jest
        .mocked(findProjectIdByAccountNameAndSlugNullableAsync)
        .mockResolvedValue(existingProjectId);
      jest.mocked(confirmAsync).mockResolvedValue(true);

      const command = new New([targetProjectDir], commandOptions);
      await command.run();

      expect(confirmAsync).toHaveBeenCalledWith({
        message: `Existing project found: @${jester.accounts[0].name}/jester-app (ID: ${existingProjectId}). Link this project?`,
      });

      expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith(
        targetProjectDir,
        expect.objectContaining({
          extra: expect.objectContaining({
            eas: expect.objectContaining({
              projectId: existingProjectId,
            }),
          }),
        }),
        { skipSDKVersionRequirement: true }
      );

      // Should not create a new project since existing one was linked
      expect(AppMutation.createAppAsync).not.toHaveBeenCalled();
    });

    it('throws error when user declines linking existing project', async () => {
      const existingProjectId = 'existing-server-project-id';

      jest.mocked(getPrivateExpoConfigAsync).mockResolvedValue({
        name: 'test-app',
        slug: 'test-app',
        owner: jester.accounts[0].name,
      } satisfies MockExpoConfig);

      jest
        .mocked(findProjectIdByAccountNameAndSlugNullableAsync)
        .mockResolvedValue(existingProjectId);
      jest.mocked(confirmAsync).mockResolvedValue(false);

      const command = new New([targetProjectDir], commandOptions);

      await expect(command.run()).rejects.toThrow(
        'Project ID configuration canceled. Re-run the command to select a different account/project.'
      );

      expect(confirmAsync).toHaveBeenCalled();
      expect(AppMutation.createAppAsync).not.toHaveBeenCalled();
    });

    it('prompts for account selection when multiple accounts and no owner specified', async () => {
      const multipleAccountsActor = {
        ...jester,
        accounts: [
          { ...jester.accounts[0], name: 'account1' },
          { ...jester.accounts[0], name: 'account2' },
        ],
      };

      mockLoggedInContext(multipleAccountsActor);

      jest.mocked(getPrivateExpoConfigAsync).mockResolvedValue({
        name: 'test-app',
        slug: 'test-app',
      } satisfies MockExpoConfig);

      jest.mocked(promptAsync).mockResolvedValueOnce({
        account: { name: 'account2' },
      });

      const command = new New([targetProjectDir], commandOptions);
      await command.run();

      expect(promptAsync).toHaveBeenCalledWith({
        type: 'select',
        name: 'account',
        message: 'Which account should own this project?',
        choices: expect.any(Array),
      });

      expect(AppMutation.createAppAsync).toHaveBeenCalledTimes(1);
      const createAppCall = jest.mocked(AppMutation.createAppAsync).mock.calls[0];
      expect(createAppCall[1]).toEqual({
        accountId: jester.accounts[0].id,
        projectName: 'jester-app',
      });
    });

    it('uses single account automatically when only one account available', async () => {
      const singleAccountUser = {
        ...jester,
        accounts: [jester.accounts[0]],
      };

      mockLoggedInContext(singleAccountUser);

      jest.mocked(getPrivateExpoConfigAsync).mockResolvedValue({
        name: 'test-app',
        slug: 'test-app',
      } satisfies MockExpoConfig);

      const command = new New([targetProjectDir], commandOptions);
      await command.run();

      // Should complete the full flow
      expect(runGitCloneAsync).toHaveBeenCalled();
      expect(installDependenciesAsync).toHaveBeenCalled();

      // Should not prompt for account selection when only one account
      expect(promptAsync).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'select',
          name: 'account',
          message: 'Which account should own this project?',
        })
      );

      expect(AppMutation.createAppAsync).toHaveBeenCalledTimes(1);
      const createAppCall = jest.mocked(AppMutation.createAppAsync).mock.calls[0];
      expect(createAppCall[1]).toEqual({
        accountId: jester.accounts[0].id,
        projectName: 'jester-app',
      });
    });

    it('throws error when user has insufficient permissions', async () => {
      const insufficientPermissionsActor = {
        ...jester,
        accounts: [
          {
            ...jester.accounts[0],
            users: [{ role: Role.ViewOnly, actor: { id: jester.id } }],
          },
        ],
      };

      mockLoggedInContext(insufficientPermissionsActor);

      jest.mocked(getPrivateExpoConfigAsync).mockResolvedValue({
        name: 'test-app',
        slug: 'test-app',
        owner: insufficientPermissionsActor.accounts[0].name,
      } satisfies MockExpoConfig);

      jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);

      const command = new New([targetProjectDir], commandOptions);

      await expect(command.run()).rejects.toThrow(
        `You don't have permission to create a new project on the ${insufficientPermissionsActor.accounts[0].name} account and no matching project already exists on the account.`
      );

      expect(AppMutation.createAppAsync).not.toHaveBeenCalled();
    });

    it('preserves existing extra config when saving project ID', async () => {
      const existingExtra = { someField: 'someValue', eas: { otherField: 'otherValue' } };

      jest.mocked(getPrivateExpoConfigAsync).mockResolvedValue({
        name: 'test-app',
        slug: 'test-app',
        owner: jester.accounts[0].name,
        extra: existingExtra,
      } satisfies MockExpoConfig);

      const command = new New([targetProjectDir], commandOptions);
      await command.run();

      expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith(
        targetProjectDir,
        {
          extra: {
            ...existingExtra,
            eas: { ...existingExtra.eas, projectId: 'test-project-id' },
          },
        },
        { skipSDKVersionRequirement: true }
      );
    });

    it('handles config modification failure gracefully', async () => {
      const errorMessage = 'Failed to modify config';

      jest.mocked(createOrModifyExpoConfigAsync).mockResolvedValue({
        type: 'fail',
        message: errorMessage,
        config: null,
      } satisfies MockConfigResult);

      const command = new New([targetProjectDir], commandOptions);

      await expect(command.run()).rejects.toThrow(errorMessage);

      // Should still complete git and dependency installation
      expect(runGitCloneAsync).toHaveBeenCalled();
      expect(installDependenciesAsync).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('throws error for robot users', async () => {
      mockLoggedInContext(robot);

      const command = new New([targetProjectDir], commandOptions);

      await expect(command.run()).rejects.toThrow(
        'This command is not available for robot users. Make sure you are not using a robot token and try again.'
      );

      expect(canAccessRepositoryUsingSshAsync).not.toHaveBeenCalled();
      expect(runGitCloneAsync).not.toHaveBeenCalled();
    });
  });
});
