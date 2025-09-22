import fs from 'fs-extra';
import { vol } from 'memfs';
import path from 'path';
import { instance, mock } from 'ts-mockito';

import LoggedInContextField from '../../../commandUtils/context/LoggedInContextField';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import FeatureGateEnvOverrides from '../../../commandUtils/gating/FeatureGateEnvOverrides';
import FeatureGating from '../../../commandUtils/gating/FeatureGating';
import { jester, robot } from '../../../credentials/__tests__/fixtures-constants';
import { canAccessRepositoryUsingSshAsync, runGitCloneAsync } from '../../../onboarding/git';
import {
  getLockFileName,
  installDependenciesAsync,
  promptForPackageManagerAsync,
} from '../../../onboarding/installDependencies';
import { runCommandAsync } from '../../../onboarding/runCommand';
import { promptAsync } from '../../../prompts';
import { Actor } from '../../../user/User';
import GitClient from '../../../vcs/clients/git';
import New from '../new';

jest.mock('fs');
jest.mock('fs-extra');
jest.mock('../../../onboarding/git');
jest.mock('../../../onboarding/installDependencies');
jest.mock('../../../onboarding/runCommand');
jest.mock('../../../prompts');
jest.mock('../../../vcs/clients/git');
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
      jest.mocked(getLockFileName).mockReturnValue('package-lock.json');

      // Mock fs operations
      (fs.remove as jest.Mock).mockResolvedValue(undefined);

      // Mock GitClient
      const mockGitClient = {
        trackFileAsync: jest.fn().mockResolvedValue(undefined),
      } as unknown as GitClient;
      jest.mocked(GitClient).mockImplementation(() => mockGitClient);
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

    it('tracks package-lock.json file', async () => {
      const mockTrackFileAsync = jest.fn().mockResolvedValue(undefined);
      const mockGitClient = {
        trackFileAsync: mockTrackFileAsync,
      } as unknown as GitClient;
      jest.mocked(GitClient).mockImplementation(() => mockGitClient);

      const command = new New([targetProjectDir], commandOptions);
      await command.run();

      expect(mockTrackFileAsync).toHaveBeenCalledWith('package-lock.json');
    });

    it('logs appropriate messages during project creation', async () => {
      mockLoggedInContext(jester);
      mockFileSystem(targetProjectDir);

      jest.mocked(canAccessRepositoryUsingSshAsync).mockResolvedValue(true);
      jest.mocked(runGitCloneAsync).mockResolvedValue({ targetProjectDir });
      (fs.remove as jest.Mock).mockResolvedValue(undefined);
      jest.mocked(runCommandAsync).mockResolvedValue();
      jest.mocked(installDependenciesAsync).mockResolvedValue();

      const mockGitClient = {
        trackFileAsync: jest.fn().mockResolvedValue(undefined),
      };
      jest.mocked(GitClient).mockImplementation(() => mockGitClient as any);

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
      jest.mocked(getLockFileName).mockReturnValueOnce('yarn.lock');

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
      jest.mocked(getLockFileName).mockReturnValueOnce('package-lock.json');

      const command = new New([], commandOptions);
      await command.run();

      expect(installDependenciesAsync).toHaveBeenCalledWith({
        projectDir: targetProjectDir,
        packageManager: 'npm',
      });
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
