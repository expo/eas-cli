import { jester } from '../../credentials/__tests__/fixtures-constants';
import { promptAsync } from '../../prompts';
import {
  getAccountChoices,
  promptForProjectAccountAsync,
  promptForProjectNameAsync,
  promptForTargetDirectoryAsync,
  promptToChangeProjectNameOrAccountAsync,
} from '../prompts';

jest.mock('../../../prompts');
jest.mock('../../../log');

describe('prompts', () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log');
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

  describe('promptForProjectNameAsync', () => {
    it('should use project name from args when provided', async () => {
      const projectNameFromArgs = 'my-test-app';
      const result = await promptForProjectNameAsync(jester, projectNameFromArgs);

      expect(result).toBe(projectNameFromArgs);
      expectConsoleToContain(`Using project name from args: ${projectNameFromArgs}`);
      expect(promptAsync).not.toHaveBeenCalled();
    });

    it('should prompt for project name when not provided in args', async () => {
      const promptedProjectName = 'prompted-app-name';
      mockUserInput({ projectName: promptedProjectName });

      const result = await promptForProjectNameAsync(jester);

      expect(result).toBe(promptedProjectName);
      expectPromptToHaveMessage('What is the name of your app?');
    });
  });

  describe('promptForTargetDirectoryAsync', () => {
    it('should prompt for target directory', async () => {
      const promptedDirectory = '/test/prompted-project';
      mockUserInput({ targetProjectDir: promptedDirectory });

      const result = await promptForTargetDirectoryAsync('test-project');

      expectConsoleToContain(
        `🚚 Let's start by cloning the default Expo template project from GitHub and installing dependencies.`
      );
      expectPromptToHaveMessage('Where would you like to create your new project directory?');
      expect(result).toBe(promptedDirectory);
    });

    it('should handle the target directory from args', async () => {
      const providedDirectory = '/test/provided-project';
      const result = await promptForTargetDirectoryAsync('test-project', providedDirectory);

      expectConsoleToContain(
        `🚚 Let's start by cloning the default Expo template project from GitHub and installing dependencies.`
      );
      expectConsoleToContain(`Using project directory from args: ${providedDirectory}`);
      expect(promptAsync).not.toHaveBeenCalled();
      expect(result).toBe(providedDirectory);
    });
  });

  describe('promptForProjectAccountAsync', () => {
    it('should prompt for project account', async () => {
      const selectedAccount = 'test-account';
      mockUserInput({ projectAccount: selectedAccount });

      const result = await promptForProjectAccountAsync(jester);

      expect(result).toBe(selectedAccount);
      expectPromptToHaveMessage('Which account should we use for this project?');
    });
  });

  describe('promptToChangeProjectNameOrAccountAsync', () => {
    it('should prompt to change project name or account', async () => {
      const newProjectName = 'new-project-name';
      const newAccount = 'new-account';
      mockUserInput({
        projectName: newProjectName,
        projectAccount: newAccount,
      });

      const result = await promptToChangeProjectNameOrAccountAsync(
        jester,
        'old-project-name',
        'old-account'
      );

      expect(result).toEqual({
        projectName: newProjectName,
        projectAccount: newAccount,
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
});
