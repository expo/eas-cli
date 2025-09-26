import { canAccessRepositoryUsingSshAsync, runGitCloneAsync } from '../../../onboarding/git';
import { runCommandAsync } from '../../../onboarding/runCommand';
import { promptAsync } from '../../../prompts';
import { Actor } from '../../../user/User';
import New, {
  cloneTemplateAsync,
  getAccountChoices,
  installProjectDependenciesAsync,
  promptForTargetDirectoryAsync,
} from '../new';

jest.mock('../../../prompts');
jest.mock('../../../onboarding/git');
jest.mock('../../../onboarding/runCommand');

describe(New.name, () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
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
    // strip out ANSI codes like the tick
    const outputWithoutAnsi = output.map(line => line.replace(/\x1b\[[0-9;]*m/g, ''));
    expect(outputWithoutAnsi).toContain(message);
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

  // describe('happy path');

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

        // Mock runCommandAsync to resolve
        jest.mocked(runCommandAsync).mockResolvedValue();

        await installProjectDependenciesAsync(projectDir);

        // Should call runCommandAsync for npm install
        expect(runCommandAsync).toHaveBeenCalledWith({
          command: 'npm',
          args: ['install'],
          cwd: projectDir,
          shouldShowStderrLine: expect.any(Function),
        });

        // Should call runCommandAsync for expo-updates
        expect(runCommandAsync).toHaveBeenCalledWith({
          cwd: projectDir,
          command: 'npx',
          args: ['expo', 'install', 'expo-updates'],
        });

        // Should call runCommandAsync for @expo/metro-runtime
        expect(runCommandAsync).toHaveBeenCalledWith({
          cwd: projectDir,
          command: 'npx',
          args: ['expo', 'install', '@expo/metro-runtime'],
        });

        // Should have called runCommandAsync exactly 3 times (npm install + 2 expo dependencies)
        expect(runCommandAsync).toHaveBeenCalledTimes(3);
      });
    });

    describe('getAccountChoices', () => {
      it('should return mapped account choices', () => {
        // Mock accounts - one personal, one team, one disabled, not in sort order
        const mockActor: Actor = {
          __typename: 'User',
          username: 'testuser',
          id: 'user-123',
          featureGates: {},
          isExpoAdmin: false,
          primaryAccount: {
            id: 'account-1',
            name: 'testuser',
            users: [],
          },
          preferences: {},
          accounts: [
            { id: 'account-2', name: 'teamaccount', users: [] }, // team account
            { id: 'account-1', name: 'testuser', users: [] }, // personal account (should be sorted first)
            { id: 'account-3', name: 'disabledaccount', users: [] }, // disabled account
          ],
        };

        const namesWithSufficientPermissions = new Set(['testuser', 'teamaccount']);

        const result = getAccountChoices(mockActor, namesWithSufficientPermissions);

        expect(result).toEqual([
          {
            title: 'testuser (personal account)',
            value: { name: 'testuser' },
          },
          {
            title: 'teamaccount',
            value: { name: 'teamaccount' },
          },
          {
            title: 'disabledaccount',
            value: { name: 'disabledaccount' },
            disabled: true,
            description:
              'You do not have the required permissions to create projects on this account.',
          },
        ]);
      });
    });
  });
});
