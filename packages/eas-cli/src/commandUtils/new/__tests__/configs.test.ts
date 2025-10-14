import fs from 'fs-extra';

import { LogSpy } from './testUtils';
import { jester } from '../../../credentials/__tests__/fixtures-constants';
import { promptAsync, selectAsync } from '../../../prompts';
import {
  generateProjectConfigAsync,
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

  describe('generateProjectConfigAsync', () => {
    describe('when no path is provided', () => {
      it('should generate name and directory when base name is available', async () => {
        (fs.pathExists as jest.Mock).mockResolvedValue(false);

        const result = await generateProjectConfigAsync(jester);

        expect(result.projectName).toBe('new-expo-project');
        expect(result.projectDirectory).toContain('new-expo-project');
        logSpy.expectLogToContain('Using project name: new-expo-project');
        expect(promptAsync).not.toHaveBeenCalled();
      });

      it('should use username-date when base name exists', async () => {
        (fs.pathExists as jest.Mock)
          .mockResolvedValueOnce(true) // base name exists
          .mockResolvedValueOnce(false); // username-date doesn't exist

        const result = await generateProjectConfigAsync(jester);

        expect(result.projectName).toMatch(/^new-expo-project-jester-\d{4}-\d{2}-\d{2}$/);
        expect(result.projectDirectory).toContain(result.projectName);
        logSpy.expectLogToContain('Using project name:');
        expect(promptAsync).not.toHaveBeenCalled();
      });

      it('should use username-date-shortID when base name and username-date exist', async () => {
        (fs.pathExists as jest.Mock)
          .mockResolvedValueOnce(true) // base name exists
          .mockResolvedValueOnce(true); // username-date exists

        const result = await generateProjectConfigAsync(jester);

        expect(result.projectName).toMatch(
          /^new-expo-project-jester-\d{4}-\d{2}-\d{2}-[a-zA-Z0-9_-]{6}$/
        );
        expect(result.projectDirectory).toContain(result.projectName);
        logSpy.expectLogToContain('Using project name:');
        expect(promptAsync).not.toHaveBeenCalled();
      });
    });

    describe('when path is provided', () => {
      it('should use absolute path and extract name from basename', async () => {
        const absolutePath = '/absolute/path/to/my-project';
        const result = await generateProjectConfigAsync(jester, absolutePath);

        expect(result.projectName).toBe('my-project');
        expect(result.projectDirectory).toBe(absolutePath);
        logSpy.expectLogToContain('Using project directory:');
        expect(promptAsync).not.toHaveBeenCalled();
      });

      it('should resolve relative path and extract name from basename', async () => {
        const relativePath = 'some/relative/my-app';
        const result = await generateProjectConfigAsync(jester, relativePath);

        expect(result.projectName).toBe('my-app');
        expect(result.projectDirectory).toContain('some/relative/my-app');
        logSpy.expectLogToContain('Using project directory:');
        expect(promptAsync).not.toHaveBeenCalled();
      });
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
