import fs from 'fs-extra';

import { LogSpy } from './testUtils';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { jester } from '../../../credentials/__tests__/fixtures-constants';
import { findProjectIdByAccountNameAndSlugNullableAsync } from '../../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import { promptAsync } from '../../../prompts';
import {
  findAvailableProjectNameAsync,
  generateProjectConfigAsync,
  generateProjectNameVariations,
  getAccountChoices,
  promptForProjectAccountAsync,
} from '../configs';

jest.mock('../../../prompts');
jest.mock('../../../log');
jest.mock('fs-extra');
jest.mock('../../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync');

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
    const mockOptions = {
      graphqlClient: {} as ExpoGraphqlClient,
      projectAccount: 'test-account',
    };

    describe('when no path is provided', () => {
      it('should generate name and directory when base name is available', async () => {
        (fs.pathExists as jest.Mock).mockResolvedValue(false);
        jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);

        const result = await generateProjectConfigAsync(jester, undefined, mockOptions);

        expect(result.projectName).toBe('new-expo-project');
        expect(result.projectDirectory).toContain('new-expo-project');
        logSpy.expectLogToContain('Using project name: new-expo-project');
        expect(promptAsync).not.toHaveBeenCalled();
      });

      it('should use username-date when base name exists', async () => {
        (fs.pathExists as jest.Mock)
          .mockResolvedValueOnce(true) // base name exists
          .mockResolvedValueOnce(false); // username-date doesn't exist
        jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);

        const result = await generateProjectConfigAsync(jester, undefined, mockOptions);

        expect(result.projectName).toMatch(/^new-expo-project-jester-\d{4}-\d{2}-\d{2}$/);
        expect(result.projectDirectory).toContain(result.projectName);
        logSpy.expectLogToContain('Using alternate project name:');
        expect(promptAsync).not.toHaveBeenCalled();
      });

      it('should use username-date-shortID when base name and username-date exist', async () => {
        (fs.pathExists as jest.Mock)
          .mockResolvedValueOnce(true) // base name exists
          .mockResolvedValueOnce(true); // username-date exists
        jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);

        const result = await generateProjectConfigAsync(jester, undefined, mockOptions);

        expect(result.projectName).toMatch(
          /^new-expo-project-jester-\d{4}-\d{2}-\d{2}-[a-zA-Z0-9_-]{6}$/
        );
        expect(result.projectDirectory).toContain(result.projectName);
        logSpy.expectLogToContain('Using alternate project name:');
        expect(promptAsync).not.toHaveBeenCalled();
      });
    });

    describe('when path is provided', () => {
      it('should use absolute path and extract name from basename', async () => {
        (fs.pathExists as jest.Mock).mockResolvedValue(false);
        jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);
        const absolutePath = '/absolute/path/to/my-project';
        const result = await generateProjectConfigAsync(jester, absolutePath, mockOptions);

        expect(result.projectName).toBe('my-project');
        expect(result.projectDirectory).toBe(absolutePath);
        logSpy.expectLogToContain('Using project directory:');
        expect(promptAsync).not.toHaveBeenCalled();
      });

      it('should resolve relative path and extract name from basename', async () => {
        (fs.pathExists as jest.Mock).mockResolvedValue(false);
        jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);
        const relativePath = 'some/relative/my-app';
        const result = await generateProjectConfigAsync(jester, relativePath, mockOptions);

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

    it('should automatically select single account with permissions', async () => {
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

  describe('generateProjectNameVariations', () => {
    it('should generate name variations', () => {
      const baseName = 'my-project';
      const result = generateProjectNameVariations(jester, baseName);

      expect(result).toHaveLength(3);
      expect(result[0]).toBe('my-project');
      expect(result[1]).toMatch(/^my-project-jester-\d{4}-\d{2}-\d{2}$/);
      expect(result[2]).toMatch(/^my-project-jester-\d{4}-\d{2}-\d{2}-[a-zA-Z0-9_-]{6}$/);
    });
  });

  describe('findAvailableProjectNameAsync', () => {
    const mockGraphqlClient = {} as ExpoGraphqlClient;
    const mockOptions = {
      graphqlClient: mockGraphqlClient,
      projectAccount: 'jester',
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should find first available name when checking both local and remote', async () => {
      (fs.pathExists as jest.Mock).mockResolvedValue(false);
      jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);

      const result = await findAvailableProjectNameAsync(
        jester,
        'test-project',
        '/base/path',
        mockOptions
      );

      expect(result.projectName).toBe('test-project');
      expect(result.projectDirectory).toBe('/base/path/test-project');
      expect(fs.pathExists).toHaveBeenCalledTimes(1);
      expect(findProjectIdByAccountNameAndSlugNullableAsync).toHaveBeenCalledWith(
        mockGraphqlClient,
        'jester',
        'test-project'
      );
    });

    it('should try alternatives when first name exists locally', async () => {
      (fs.pathExists as jest.Mock)
        .mockResolvedValueOnce(true) // First exists
        .mockResolvedValueOnce(false); // Second available
      jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);

      const result = await findAvailableProjectNameAsync(
        jester,
        'test-project',
        '/base/path',
        mockOptions
      );

      expect(result.projectName).toMatch(/^test-project-jester-\d{4}-\d{2}-\d{2}$/);
      expect(result.projectDirectory).toContain('/base/path/test-project-jester-');
      expect(fs.pathExists).toHaveBeenCalledTimes(2);
    });

    it('should skip name if local is available but remote exists', async () => {
      (fs.pathExists as jest.Mock).mockResolvedValue(false);
      jest
        .mocked(findProjectIdByAccountNameAndSlugNullableAsync)
        .mockResolvedValueOnce('project-id') // First name exists remotely
        .mockResolvedValueOnce(null); // Second available remotely

      const result = await findAvailableProjectNameAsync(
        jester,
        'test-project',
        '/base/path',
        mockOptions
      );

      expect(result.projectName).toMatch(/^test-project-jester-\d{4}-\d{2}-\d{2}$/);
      expect(findProjectIdByAccountNameAndSlugNullableAsync).toHaveBeenCalledTimes(2);
    });

    it('should throw error when all variations taken', async () => {
      (fs.pathExists as jest.Mock).mockResolvedValue(true);
      jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue('project-id');

      await expect(
        findAvailableProjectNameAsync(jester, 'test-project', '/base/path', mockOptions)
      ).rejects.toThrow('Unable to find a unique project name');
    });

    it('should log when using alternative name', async () => {
      (fs.pathExists as jest.Mock).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);

      await findAvailableProjectNameAsync(jester, 'test-project', '/base/path', mockOptions);

      logSpy.expectLogToContain('Using alternate project name:');
    });
  });
});
