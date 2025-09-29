import { ExpoConfig } from '@expo/config';
import fs from 'fs-extra';
import merge from 'ts-deepmerge';

import { getEASUpdateURL } from '../../../api';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { jester, jester2 } from '../../../credentials/__tests__/fixtures-constants';
import { AppFragment, Role } from '../../../graphql/generated';
import { AppMutation } from '../../../graphql/mutations/AppMutation';
import { canAccessRepositoryUsingSshAsync, runGitCloneAsync } from '../../../onboarding/git';
import {
  installDependenciesAsync,
  promptForPackageManagerAsync,
} from '../../../onboarding/installDependencies';
import { runCommandAsync } from '../../../onboarding/runCommand';
import { Ora, ora } from '../../../ora';
import {
  createOrModifyExpoConfigAsync,
  getPrivateExpoConfigAsync,
} from '../../../project/expoConfig';
import { findProjectIdByAccountNameAndSlugNullableAsync } from '../../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import { promptAsync } from '../../../prompts';
import { Actor, getActorUsername } from '../../../user/User';
import New, {
  cloneTemplateAsync,
  copyProjectTemplatesAsync,
  createProjectAsync,
  formatScriptCommand,
  generateAppConfigAsync,
  generateEasConfigAsync,
  getAccountChoices,
  initializeGitRepositoryAsync,
  installProjectDependenciesAsync,
  mergeReadmeAsync,
  promptForTargetDirectoryAsync,
  updatePackageJsonAsync,
} from '../new';

jest.mock('../../../prompts');
jest.mock('../../../onboarding/git');
jest.mock('../../../onboarding/runCommand');
jest.mock('../../../graphql/mutations/AppMutation');
jest.mock('../../../project/expoConfig');
jest.mock('../../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync');
jest.mock('../../../user/User', () => ({
  getActorUsername: jest.fn(),
}));
jest.mock('../../../ora');
jest.mock('fs-extra');
jest.mock('../../../onboarding/installDependencies');
jest.mock('../../../api');
jest.mock('../../../build/utils/url');
jest.mock('../../../utils/easCli', () => ({
  easCliVersion: '5.0.0',
}));
// Remove Log module mocking entirely - use the actual module

describe(New.name, () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Capture console.log calls
    consoleLogSpy = jest.spyOn(console, 'log');

    jest.mocked(fs.writeFile).mockImplementation(() => Promise.resolve());
    jest.mocked(fs.readJson).mockImplementation(() => Promise.resolve({}));
    jest.mocked(fs.writeJson).mockImplementation(() => Promise.resolve());
    jest.mocked(fs.copy).mockImplementation(() => Promise.resolve());
    jest.mocked(fs.remove).mockImplementation(() => Promise.resolve());
    jest.mocked(fs.readFile).mockImplementation(() => Promise.resolve(''));
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  // Helper function to get all console output as strings
  const getConsoleOutput = (): string[] => {
    return consoleLogSpy.mock.calls.map(call => (call.length === 0 ? '' : call.join(' ')));
  };

  // Helper function to check if a specific message was logged
  const expectConsoleToContain = (message: string): void => {
    const output = getConsoleOutput();
    // strip out ANSI codes and special characters like the tick
    const outputWithoutAnsi = output.map(line =>
      line.replace(/\x1b\[[0-9;]*m/g, '').replace(/✔\s*/, '')
    );
    // throw new Error(message + '\n' + outputWithoutAnsi.join('\n'));
    expect(outputWithoutAnsi.some(line => line.includes(message))).toBeTruthy();
  };

  // Helper function to verify prompt was called with expected message
  const expectPromptToHaveMessage = (expectedMessage: string): void => {
    expect(promptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expectedMessage,
      })
    );
  };

  // Helper function to simulate user input via prompt
  const mockUserInput = (inputValue: any): void => {
    jest.mocked(promptAsync).mockResolvedValue(inputValue);
  };

  describe('helper functions', () => {
    describe('promptForTargetDirectoryAsync', () => {
      it('should prompt for target directory', async () => {
        const promptedDirectory = '/test/prompted-project';
        mockUserInput({ targetProjectDir: promptedDirectory });

        const result = await promptForTargetDirectoryAsync();

        expectConsoleToContain(
          `🚚 Let's start by cloning the default Expo template project from GitHub and installing dependencies.`
        );
        expectPromptToHaveMessage('Where would you like to create your new project directory?');
        expect(result).toBe(promptedDirectory);
      });

      it('should handle the target directory from args', async () => {
        const providedDirectory = '/test/provided-project';
        const result = await promptForTargetDirectoryAsync(providedDirectory);

        expectConsoleToContain(
          `🚚 Let's start by cloning the default Expo template project from GitHub and installing dependencies.`
        );

        expect(promptAsync).not.toHaveBeenCalled();

        expect(result).toBe(providedDirectory);
      });
    });

    describe('cloneTemplateAsync', () => {
      it('should clone the template project with ssh', async () => {
        const targetProjectDir = '/test/target-project';
        const finalTargetProjectDir = '/test/final-target-project';

        jest.mocked(canAccessRepositoryUsingSshAsync).mockResolvedValue(true);
        jest.mocked(runGitCloneAsync).mockResolvedValue({
          targetProjectDir: finalTargetProjectDir,
        });

        const result = await cloneTemplateAsync(targetProjectDir);

        expectConsoleToContain(`📂 Cloning the project to ${targetProjectDir}`);
        expectConsoleToContain('We detected that ssh is your preferred git clone method');

        expect(runGitCloneAsync).toHaveBeenCalledWith({
          githubUsername: 'expo',
          githubRepositoryName: 'expo-template-default',
          targetProjectDir,
          cloneMethod: 'ssh',
        });

        expect(result).toBe(finalTargetProjectDir);
      });

      it('should clone the template project with https', async () => {
        const targetProjectDir = '/test/target-project';
        const finalTargetProjectDir = '/test/final-target-project';

        jest.mocked(canAccessRepositoryUsingSshAsync).mockResolvedValue(false);
        jest.mocked(runGitCloneAsync).mockResolvedValue({
          targetProjectDir: finalTargetProjectDir,
        });

        const result = await cloneTemplateAsync(targetProjectDir);

        expectConsoleToContain(`📂 Cloning the project to ${targetProjectDir}`);
        expectConsoleToContain('We detected that https is your preferred git clone method');

        expect(runGitCloneAsync).toHaveBeenCalledWith({
          githubUsername: 'expo',
          githubRepositoryName: 'expo-template-default',
          targetProjectDir,
          cloneMethod: 'https',
        });

        expect(result).toBe(finalTargetProjectDir);
      });
    });

    describe('installProjectDependenciesAsync', () => {
      it('should install the project dependencies', async () => {
        const projectDir = '/test/project-directory';

        jest.mocked(promptForPackageManagerAsync).mockResolvedValue('npm');
        jest.mocked(installDependenciesAsync).mockResolvedValue();
        jest.mocked(runCommandAsync).mockResolvedValue();

        const packageManager = await installProjectDependenciesAsync(projectDir);
        expect(packageManager).toBe('npm');

        expect(promptForPackageManagerAsync).toHaveBeenCalled();
        expect(installDependenciesAsync).toHaveBeenCalledWith({
          projectDir,
          packageManager: 'npm',
        });

        expect(runCommandAsync).toHaveBeenCalledWith({
          cwd: projectDir,
          command: 'npx',
          args: ['expo', 'install', 'expo-updates'],
        });

        expect(runCommandAsync).toHaveBeenCalledWith({
          cwd: projectDir,
          command: 'npx',
          args: ['expo', 'install', '@expo/metro-runtime'],
        });
      });
    });

    describe('getAccountChoices', () => {
      it('should return mapped account choices', () => {
        // Use jester fixture which has multiple accounts with different permissions
        const namesWithSufficientPermissions = new Set(['jester']); // Only personal account has permissions

        const result = getAccountChoices(jester, namesWithSufficientPermissions);

        expect(result).toEqual([
          {
            title: 'jester (personal account)',
            value: { name: 'jester' },
          },
          {
            title: 'other',
            value: { name: 'other' },
            disabled: true,
            description:
              'You do not have the required permissions to create projects on this account.',
          },
        ]);
      });
    });

    describe('createProjectAsync', () => {
      const mockGraphqlClient = {} as ExpoGraphqlClient;
      const projectDir = '/test/project-dir';
      const mockProjectId = 'test-project-id';

      beforeEach(() => {
        // use single-account jester for most of the tests
        jest.mocked(getActorUsername).mockReturnValue('jester2');

        jest.mocked(getPrivateExpoConfigAsync).mockResolvedValue({
          name: 'test-app',
          slug: 'test-app',
          extra: {},
        } as ExpoConfig);

        jest.mocked(createOrModifyExpoConfigAsync).mockResolvedValue({
          type: 'success' as const,
          message: 'Config updated',
          config: {
            name: 'test-app',
            slug: 'test-app',
            extra: { eas: { projectId: 'test-project-id' } },
          } as ExpoConfig,
        });

        const mockSpinner: Partial<Ora> = {
          start: jest.fn().mockReturnThis(),
          succeed: jest.fn().mockReturnThis(),
          fail: jest.fn().mockReturnThis(),
        };
        jest.mocked(ora).mockReturnValue(mockSpinner as Ora);
      });

      it('should create a project', async () => {
        const mockActor = jester2 as Actor;

        jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);
        jest.mocked(AppMutation.createAppAsync).mockResolvedValue(mockProjectId);

        const result = await createProjectAsync(mockGraphqlClient, mockActor, projectDir);

        expect(findProjectIdByAccountNameAndSlugNullableAsync).toHaveBeenCalledWith(
          mockGraphqlClient,
          'jester2',
          'jester2-app'
        );

        expect(AppMutation.createAppAsync).toHaveBeenCalledWith(mockGraphqlClient, {
          accountId: 'jester2-account-id',
          projectName: 'jester2-app',
        });

        expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith(
          projectDir,
          {
            extra: { eas: { projectId: mockProjectId } },
          },
          { skipSDKVersionRequirement: true }
        );

        expect(result).toBe(mockProjectId);
      });

      it('should create a project when there are multiple accounts', async () => {
        // Use jester fixture which has multiple accounts
        const mockActor = jester;

        jest.mocked(getActorUsername).mockReturnValue('jester');
        jest.mocked(promptAsync).mockResolvedValue({
          account: { name: 'jester' },
        });

        jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);

        jest.mocked(AppMutation.createAppAsync).mockResolvedValue(mockProjectId);

        const result = await createProjectAsync(mockGraphqlClient, mockActor, projectDir);

        expect(promptAsync).toHaveBeenCalledWith({
          type: 'select',
          name: 'account',
          message: 'Which account should own this project?',
          choices: expect.any(Array),
        });

        expect(findProjectIdByAccountNameAndSlugNullableAsync).toHaveBeenCalledWith(
          mockGraphqlClient,
          'jester',
          'jester-app'
        );

        expect(AppMutation.createAppAsync).toHaveBeenCalledWith(mockGraphqlClient, {
          accountId: 'jester-account-id',
          projectName: 'jester-app',
        });

        expect(result).toBe(mockProjectId);
      });

      it('should throw when the project already exists', async () => {
        const mockActor = jester2 as Actor;

        const existingProjectId = 'existing-project-id';
        jest
          .mocked(findProjectIdByAccountNameAndSlugNullableAsync)
          .mockResolvedValue(existingProjectId);

        await expect(createProjectAsync(mockGraphqlClient, mockActor, projectDir)).rejects.toThrow(
          `Existing project found: @jester2/jester2-app (ID: ${existingProjectId}). Project ID configuration canceled. Re-run the command to select a different account/project.`
        );

        expect(AppMutation.createAppAsync).not.toHaveBeenCalled();
      });

      it('should throw when the user does not have permission to create projects on account', async () => {
        // Create a custom actor with ViewOnly permissions for this test
        const mockActor = merge(jester2, {
          accounts: [{ users: [{ actor: { id: 'view-only-jester' }, role: Role.ViewOnly }] }],
        }) as Actor;

        jest.mocked(getActorUsername).mockReturnValue('view-only-jester');
        jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);

        await expect(createProjectAsync(mockGraphqlClient, mockActor, projectDir)).rejects.toThrow(
          `You don't have permission to create a new project on the jester account and no matching project already exists on the account.`
        );

        expect(AppMutation.createAppAsync).not.toHaveBeenCalled();
      });
    });

    describe('generateAppConfigAsync', () => {
      const projectDir = '/test/project-dir';
      const mockUpdateUrl = 'https://u.expo.dev/test-project-id';

      const createMockApp = (overrides: Partial<AppFragment> = {}): AppFragment => ({
        id: 'test-project-id',
        name: 'Test App',
        fullName: '@testowner/test-app',
        slug: 'test-app',
        ownerAccount: {
          id: 'testowner-account-id',
          name: 'testowner',
          users: [],
        },
        ...overrides,
      });

      beforeEach(() => {
        jest.mocked(getEASUpdateURL).mockReturnValue(mockUpdateUrl);

        jest.mocked(fs.readJson).mockResolvedValue({
          expo: {} as ExpoConfig,
        });
      });

      it('should generate the app config', async () => {
        const mockApp = createMockApp();
        jest.mocked(fs.readJson).mockResolvedValue({
          expo: {
            name: 'value-to-override',
            slug: 'value-to-override',
            icon: 'value-to-keep',
          } as ExpoConfig,
        });

        await generateAppConfigAsync(projectDir, mockApp);

        expect(getEASUpdateURL).toHaveBeenCalledWith('test-project-id', null);

        const expectedConfig = {
          expo: {
            name: 'Test App',
            slug: 'test-app',
            scheme: 'TestApp',
            icon: 'value-to-keep',
            extra: {
              eas: {
                projectId: 'test-project-id',
              },
            },
            owner: 'testowner',
            updates: {
              url: mockUpdateUrl,
            },
            runtimeVersion: {
              policy: 'appVersion',
            },
            ios: {
              bundleIdentifier: 'com.testowner.testapp',
            },
            android: {
              package: 'com.testowner.testapp',
            },
          },
        };

        expect(fs.writeJson).toHaveBeenCalledWith(`${projectDir}/app.json`, expectedConfig, {
          spaces: 2,
        });

        expectConsoleToContain('Generated app.json');
      });

      it('should handle invalid characters in the bundle identifier', async () => {
        const mockApp = createMockApp({
          slug: 'test-app-with-dashes',
          ownerAccount: {
            id: 'test-owner-account-id',
            name: 'test-owner',
            users: [],
          },
        });

        await generateAppConfigAsync(projectDir, mockApp);

        expect(fs.writeJson).toHaveBeenCalledWith(
          `${projectDir}/app.json`,
          expect.objectContaining({
            expo: expect.objectContaining({
              ios: expect.objectContaining({
                bundleIdentifier: 'com.testowner.testappwithdashes',
              }),
            }),
          }),
          { spaces: 2 }
        );
      });

      it('should handle invalid characters in the owner account name', async () => {
        const mockApp = createMockApp({
          slug: 'testapp',
          ownerAccount: {
            id: 'test-owner-123-account-id',
            name: 'test-owner-123',
            users: [],
          },
        });

        await generateAppConfigAsync(projectDir, mockApp);

        expect(fs.writeJson).toHaveBeenCalledWith(
          `${projectDir}/app.json`,
          expect.objectContaining({
            expo: expect.objectContaining({
              ios: expect.objectContaining({
                bundleIdentifier: 'com.testowner123.testapp',
              }),
            }),
          }),
          { spaces: 2 }
        );
      });

      it('should handle invalid characters in the slug', async () => {
        const mockApp = createMockApp({
          slug: 'test@app#with$symbols',
          fullName: '@testowner/test@app#with$symbols',
        });

        await generateAppConfigAsync(projectDir, mockApp);

        expect(fs.writeJson).toHaveBeenCalledWith(
          `${projectDir}/app.json`,
          expect.objectContaining({
            expo: expect.objectContaining({
              ios: expect.objectContaining({
                bundleIdentifier: 'com.testowner.testappwithsymbols',
              }),
            }),
          }),
          { spaces: 2 }
        );
      });
    });

    describe('generateEasConfigAsync', () => {
      const projectDir = '/test/project-dir';

      it('should generate the eas config', async () => {
        const expectedEasConfig = {
          cli: {
            version: '>= 5.0.0',
            appVersionSource: 'remote',
          },
          build: {
            development: {
              developmentClient: true,
              distribution: 'internal',
              android: { image: 'latest' },
              ios: { image: 'latest' },
            },
            'development-simulator': {
              extends: 'development',
              ios: { simulator: true },
            },
            preview: {
              distribution: 'internal',
              channel: 'main',
              android: { image: 'latest' },
              ios: { image: 'latest' },
            },
            production: {
              channel: 'production',
              autoIncrement: true,
              android: { image: 'latest' },
              ios: { image: 'latest' },
            },
          },
          submit: {
            production: {},
          },
        };

        await generateEasConfigAsync(projectDir);

        expect(fs.writeJson).toHaveBeenCalledWith(`${projectDir}/eas.json`, expectedEasConfig, {
          spaces: 2,
        });

        expectConsoleToContain('Generated eas.json');
      });
    });

    describe('updatePackageJsonAsync', () => {
      it('should update the package.json', async () => {
        jest.mocked(fs.readJson).mockResolvedValue({
          name: 'test-app',
          version: '1.0.0',
        });
        const projectDir = '/test/project-dir';
        await updatePackageJsonAsync(projectDir);

        const expectedPackageJson = {
          name: 'test-app',
          version: '1.0.0',
          scripts: {
            preview: 'npx eas-cli@latest workflow:run publish-preview-update.yml',
            'development-builds': 'npx eas-cli@latest workflow:run create-development-builds.yml',
            deploy: 'npx eas-cli@latest workflow:run deploy-to-production.yml',
          },
        };

        expect(fs.writeJson).toHaveBeenCalledWith(
          `${projectDir}/package.json`,
          expectedPackageJson,
          { spaces: 2 }
        );

        expectConsoleToContain('Updated package.json with scripts');
      });
    });

    describe('copyProjectTemplatesAsync', () => {
      it('should copy the project templates', async () => {
        const projectDir = '/test/project-dir';

        await copyProjectTemplatesAsync(projectDir);

        expect(fs.copy).toHaveBeenCalledWith(
          expect.stringContaining('templates/.eas/workflows'),
          expect.stringContaining('.eas/workflows'),
          { errorOnExist: false, overwrite: true }
        );

        expectConsoleToContain('Created EAS workflow files');
      });
    });

    describe('mergeReadmeAsync', () => {
      const projectDir = '/test/project-dir';

      it('should merge readme when target section is found', async () => {
        const existingReadme = `# My App

This is my app.

## Get a fresh project

Some content here.`;

        const readmeAdditions = `## Workflows

This project uses EAS Workflows.`;

        (jest.mocked(fs.readFile) as jest.Mock).mockResolvedValueOnce(readmeAdditions);
        (jest.mocked(fs.readFile) as jest.Mock).mockResolvedValueOnce(existingReadme);

        await mergeReadmeAsync(projectDir);

        const expectedMergedReadme = `# My App

This is my app.

## Workflows

This project uses EAS Workflows.

## Get a fresh project

Some content here.`;

        expect(fs.writeFile).toHaveBeenCalledWith(`${projectDir}/README.md`, expectedMergedReadme);

        expectConsoleToContain('Updated README.md with EAS configuration details');
      });

      it('should append readme when target section is not found', async () => {
        const existingReadme = `# My App

This is my app.`;

        const readmeAdditions = `## Workflows

This project uses EAS Workflows.`;

        (jest.mocked(fs.readFile) as jest.Mock).mockResolvedValueOnce(readmeAdditions);
        (jest.mocked(fs.readFile) as jest.Mock).mockResolvedValueOnce(existingReadme);

        await mergeReadmeAsync(projectDir);

        const expectedMergedReadme = `# My App

This is my app.

## Workflows

This project uses EAS Workflows.
`;

        expect(fs.writeFile).toHaveBeenCalledWith(`${projectDir}/README.md`, expectedMergedReadme);

        expectConsoleToContain('Updated README.md with EAS configuration details');
      });
    });

    describe('initializeGitRepositoryAsync', () => {
      it('should initialize git repository', async () => {
        const projectDir = '/test/project-dir';

        await initializeGitRepositoryAsync(projectDir);

        expect(fs.remove).toHaveBeenCalledWith(`${projectDir}/.git`);

        expect(runCommandAsync).toHaveBeenCalledWith({
          command: 'git',
          args: ['init'],
          cwd: projectDir,
        });

        expect(runCommandAsync).toHaveBeenCalledWith({
          command: 'git',
          args: ['add', '.'],
          cwd: projectDir,
        });

        expect(runCommandAsync).toHaveBeenCalledWith({
          command: 'git',
          args: ['commit', '-m', 'Initial commit'],
          cwd: projectDir,
        });
      });
    });

    describe('formatScriptCommand', () => {
      it('should format script commands for package managers', () => {
        expect(formatScriptCommand('start', 'npm')).toBe('npm run start');
        expect(formatScriptCommand('start', 'yarn')).toBe('yarn start');
        expect(formatScriptCommand('start', 'pnpm')).toBe('pnpm start');
      });
    });
  });
});
