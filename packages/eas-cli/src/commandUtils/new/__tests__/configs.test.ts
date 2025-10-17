import fs from 'fs-extra';

import { LogSpy } from './testUtils';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { jester } from '../../../credentials/__tests__/fixtures-constants';
import { findProjectIdByAccountNameAndSlugNullableAsync } from '../../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync';
import { promptAsync } from '../../../prompts';
import {
  findAvailableProjectNameAsync,
  generateProjectConfigAsync,
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
    logSpy = new LogSpy('withInfo');
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

        const result = await generateProjectConfigAsync(undefined, mockOptions);

        expect(result).toEqual({
          projectName: 'expo-project',
          projectDirectory: expect.stringContaining('/expo-project'),
        });
        logSpy.expectLogToContain('Using project name: expo-project');
      });

      it('should use shortid when base name exists', async () => {
        (fs.pathExists as jest.Mock).mockResolvedValue(true); // base name exists
        jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);

        const result = await generateProjectConfigAsync(undefined, mockOptions);

        expect(result).toEqual({
          projectName: expect.stringMatching(/^expo-project-[a-zA-Z0-9_-]{6}$/),
          projectDirectory: expect.stringContaining(result.projectName),
        });
        logSpy.expectLogToContain('Using alternate project name:');
      });
    });

    describe('when path is provided', () => {
      it('should use absolute path and extract name from basename', async () => {
        (fs.pathExists as jest.Mock).mockResolvedValue(false);
        jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);
        const absolutePath = '/absolute/path/to/my-project';
        const result = await generateProjectConfigAsync(absolutePath, mockOptions);

        expect(result).toEqual({
          projectName: 'my-project',
          projectDirectory: absolutePath,
        });
        logSpy.expectLogToContain('Using project directory:');
      });

      it('should resolve relative path and extract name from basename', async () => {
        (fs.pathExists as jest.Mock).mockResolvedValue(false);
        jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);
        const relativePath = 'some/relative/my-app';
        const result = await generateProjectConfigAsync(relativePath, mockOptions);

        expect(result).toEqual({
          projectName: 'my-app',
          projectDirectory: expect.stringContaining('some/relative/my-app'),
        });
        logSpy.expectLogToContain('Using project directory:');
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

  describe('findAvailableProjectNameAsync', () => {
    const mockGraphqlClient = {} as ExpoGraphqlClient;
    const mockOptions = {
      graphqlClient: mockGraphqlClient,
      projectAccount: 'jester',
    };

    it('should find first available name when checking both local and remote', async () => {
      (fs.pathExists as jest.Mock).mockResolvedValue(false);
      jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);

      const result = await findAvailableProjectNameAsync('test-project', '/base/path', mockOptions);

      expect(result).toEqual({
        projectName: 'test-project',
        projectDirectory: '/base/path/test-project',
      });
      expect(fs.pathExists).toHaveBeenCalledTimes(1);
      expect(findProjectIdByAccountNameAndSlugNullableAsync).toHaveBeenCalledWith(
        mockGraphqlClient,
        'jester',
        'test-project'
      );
    });

    it('should use shortid variant when base name exists locally', async () => {
      (fs.pathExists as jest.Mock).mockResolvedValue(true); // Base name exists locally
      jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);

      const result = await findAvailableProjectNameAsync('test-project', '/base/path', mockOptions);

      expect(result).toEqual({
        projectName: expect.stringMatching(/^test-project-[a-zA-Z0-9_-]{6}$/),
        projectDirectory: expect.stringContaining('/base/path/test-project-'),
      });
      expect(fs.pathExists).toHaveBeenCalledTimes(1);
      expect(fs.pathExists).toHaveBeenCalledWith('/base/path/test-project');
    });

    it('should use shortid variant when base name exists remotely', async () => {
      (fs.pathExists as jest.Mock).mockResolvedValue(false);
      jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue('project-id'); // Base name exists remotely

      const result = await findAvailableProjectNameAsync('test-project', '/base/path', mockOptions);

      expect(result).toEqual({
        projectName: expect.stringMatching(/^test-project-[a-zA-Z0-9_-]{6}$/),
        projectDirectory: expect.stringContaining('/base/path/test-project-'),
      });
      expect(findProjectIdByAccountNameAndSlugNullableAsync).toHaveBeenCalledTimes(1);
      expect(findProjectIdByAccountNameAndSlugNullableAsync).toHaveBeenCalledWith(
        mockGraphqlClient,
        'jester',
        'test-project'
      );
    });

    it('should use shortid variant when base name is taken both locally and remotely', async () => {
      (fs.pathExists as jest.Mock).mockResolvedValue(true);
      jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue('project-id');

      const result = await findAvailableProjectNameAsync('test-project', '/base/path', mockOptions);

      expect(result).toEqual({
        projectName: expect.stringMatching(/^test-project-[a-zA-Z0-9_-]{6}$/),
        projectDirectory: expect.stringContaining('/base/path/test-project-'),
      });
    });

    it('should log when using alternative name', async () => {
      (fs.pathExists as jest.Mock).mockResolvedValue(true);
      jest.mocked(findProjectIdByAccountNameAndSlugNullableAsync).mockResolvedValue(null);

      await findAvailableProjectNameAsync('test-project', '/base/path', mockOptions);

      logSpy.expectLogToContain('Using alternate project name:');
    });
  });
});
