import { LogSpy } from './testUtils';
import { jester } from '../../../credentials/__tests__/fixtures-constants';
import { promptAsync, selectAsync } from '../../../prompts';
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
  let logSpy: LogSpy;

  beforeAll(() => {
    logSpy = new LogSpy('log');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    logSpy.restore();
  });

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
      logSpy.expectLogToContain(`Using project name from args: ${projectNameFromArgs}`);
      expect(promptAsync).not.toHaveBeenCalled();
    });

    it('should prompt for project name when not provided in args', async () => {
      const promptedProjectName = 'prompted-app-name';
      mockUserInput({ projectName: promptedProjectName });

      const result = await promptForProjectNameAsync(jester);

      expect(result).toBe(promptedProjectName);
      expectPromptToHaveMessage('What is the name of your project?');
    });
  });

  describe('promptForTargetDirectoryAsync', () => {
    it('should prompt for target directory', async () => {
      const promptedDirectory = '/test/prompted-project';
      mockUserInput({ targetProjectDir: promptedDirectory });

      const result = await promptForTargetDirectoryAsync('test-project');

      expectPromptToHaveMessage('Where would you like to create your new project?');
      expect(result).toBe(promptedDirectory);
    });

    it('should handle the target directory from args', async () => {
      const providedDirectory = '/test/provided-project';
      const result = await promptForTargetDirectoryAsync('test-project', providedDirectory);

      logSpy.expectLogToContain(`Using project directory from args: ${providedDirectory}`);
      expect(promptAsync).not.toHaveBeenCalled();
      expect(result).toBe(providedDirectory);
    });
  });

  describe('promptForProjectAccountAsync', () => {
    it('should prompt for a project account when there are multiple accounts', async () => {
      const selectedAccount = 'jester';
      mockUserInput({ account: { name: selectedAccount } });

      const result = await promptForProjectAccountAsync(jester);

      expect(result).toBe(selectedAccount);
      expectPromptToHaveMessage('Which account should own this project?');
    });

    it('should prompt for a project account when there is only one account', async () => {
      const result = await promptForProjectAccountAsync(jester);
      expect(result).toBe(jester.accounts[0].name);
    });
  });

  describe('getAccountChoices', () => {
    it('should return mapped account choices', () => {
      const result = getAccountChoices(jester);

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

  describe('promptToChangeProjectNameOrAccountAsync', () => {
    it('should prompt to change a project name', async () => {
      const newProjectName = 'new-project-name';
      jest.mocked(selectAsync).mockResolvedValue('name');
      mockUserInput({ projectName: newProjectName });

      const result = await promptToChangeProjectNameOrAccountAsync(
        jester,
        'old-project-name',
        'old-account'
      );

      expect(result).toEqual({
        projectName: newProjectName,
        projectAccount: 'old-account', // Account should remain unchanged
      });
    });

    it('should prompt to change a project account', async () => {
      const newProjectAccount = 'new-project-account';
      jest.mocked(selectAsync).mockResolvedValue('account');
      mockUserInput({ account: { name: newProjectAccount } });

      const result = await promptToChangeProjectNameOrAccountAsync(
        jester,
        'old-project-name',
        'old-account'
      );

      expect(result).toEqual({
        projectName: 'old-project-name',
        projectAccount: newProjectAccount,
      });
    });
  });
});
