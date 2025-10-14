import fs from 'fs-extra';

import { LogSpy } from './testUtils';
import { jester } from '../../../credentials/__tests__/fixtures-constants';
import { promptAsync, selectAsync } from '../../../prompts';
import {
  generateDirectoryAsync,
  generateProjectNameAsync,
  getAccountChoices,
  promptForProjectAccountAsync,
  promptToChangeProjectNameOrAccountAsync,
} from '../configs';

jest.mock('../../../prompts');
jest.mock('../../../log');
jest.mock('fs-extra');

describe('configs', () => {
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

  describe('generateProjectNameAsync', () => {
    it('should generate default project name when directory does not exist', async () => {
      (fs.pathExists as jest.Mock).mockResolvedValue(false);

      const result = await generateProjectNameAsync(jester);

      expect(result).toBe('new-expo-project');
      logSpy.expectLogToContain('Using default project name: new-expo-project');
      expect(promptAsync).not.toHaveBeenCalled();
    });

    it('should generate name with username-date when base name exists', async () => {
      (fs.pathExists as jest.Mock)
        .mockResolvedValueOnce(true) // base name exists
        .mockResolvedValueOnce(false); // username-date doesn't exist

      const result = await generateProjectNameAsync(jester);

      expect(result).toMatch(/^new-expo-project-jester-\d{4}-\d{2}-\d{2}$/);
      logSpy.expectLogToContain('Using default project name:');
      expect(promptAsync).not.toHaveBeenCalled();
    });

    it('should generate name with short ID when base name and username-date exist', async () => {
      (fs.pathExists as jest.Mock)
        .mockResolvedValueOnce(true) // base name exists
        .mockResolvedValueOnce(true); // username-date exists

      const result = await generateProjectNameAsync(jester);

      expect(result).toMatch(/^new-expo-project-[a-zA-Z0-9_-]{6}$/);
      logSpy.expectLogToContain('Using default project name:');
      expect(promptAsync).not.toHaveBeenCalled();
    });
  });

  describe('generateDirectoryAsync', () => {
    it('should use default directory when no path provided', async () => {
      const result = await generateDirectoryAsync('test-project');

      expect(result).toContain('test-project');
      logSpy.expectLogToContain('Using default project directory:');
      expect(promptAsync).not.toHaveBeenCalled();
    });

    it('should handle absolute paths', async () => {
      const absolutePath = '/absolute/path/to/project';
      const result = await generateDirectoryAsync('test-project', absolutePath);

      expect(result).toBe(absolutePath);
      logSpy.expectLogToContain('Using absolute project directory:');
      expect(promptAsync).not.toHaveBeenCalled();
    });

    it('should handle relative paths with slashes', async () => {
      const relativePath = 'some/relative/path';
      const result = await generateDirectoryAsync('test-project', relativePath);

      expect(result).toContain('some/relative/path');
      logSpy.expectLogToContain('Using relative project directory:');
      expect(promptAsync).not.toHaveBeenCalled();
    });

    it('should handle simple directory name without slashes', async () => {
      const simpleName = 'my-project';
      const result = await generateDirectoryAsync('test-project', simpleName);

      expect(result).toContain('my-project');
      logSpy.expectLogToContain('Using project directory:');
      expect(promptAsync).not.toHaveBeenCalled();
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
    it('should generate a new project name when changing name', async () => {
      jest.mocked(selectAsync).mockResolvedValue('name');
      (fs.pathExists as jest.Mock).mockResolvedValue(false);

      const result = await promptToChangeProjectNameOrAccountAsync(
        jester,
        'old-project-name',
        'old-account'
      );

      expect(result.projectName).toBe('new-expo-project'); // Generated default
      expect(result.projectAccount).toBe('old-account'); // Account should remain unchanged
      expect(promptAsync).not.toHaveBeenCalled();
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
