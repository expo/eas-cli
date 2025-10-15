import { ExpoConfig } from '@expo/config';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { jester } from '../../../credentials/__tests__/fixtures-constants';
import { AppMutation } from '../../../graphql/mutations/AppMutation';
import {
  createOrModifyExpoConfigAsync,
  getPrivateExpoConfigAsync,
} from '../../../project/expoConfig';
import New, { createProjectAsync, generateConfigsAsync } from '../new';

jest.mock('../../../prompts', () => ({
  promptAsync: jest.fn(),
}));
jest.mock('../../../onboarding/git');
jest.mock('../../../onboarding/runCommand');
jest.mock('../../../graphql/mutations/AppMutation');
jest.mock('../../../project/expoConfig');
jest.mock('../../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync');
jest.mock('../../../user/User', () => ({
  getActorUsername: jest.fn().mockReturnValue('jester'),
}));
jest.mock('../../../ora');
jest.mock('fs-extra');
jest.mock('../../../onboarding/installDependencies');
jest.mock('../../../api');
jest.mock('../../../build/utils/url');
jest.mock('../../../utils/easCli', () => ({
  easCliVersion: '5.0.0',
}));

// Mock verification functions
jest.mock('../../../commandUtils/new/verifications', () => ({
  verifyProjectDoesNotExistAsync: jest.fn().mockResolvedValue(true),
}));

// Mock AppMutation
jest.mock('../../../graphql/mutations/AppMutation', () => ({
  AppMutation: {
    createAppAsync: jest.fn().mockResolvedValue('test-project-id'),
  },
}));

// Mock expo config functions
jest.mock('../../../project/expoConfig', () => ({
  getPrivateExpoConfigAsync: jest.fn().mockResolvedValue({ extra: {} }),
  createOrModifyExpoConfigAsync: jest.fn().mockResolvedValue(undefined),
}));

describe(New.name, () => {
  beforeEach(() => {
    // Set up default fs.pathExists mock
    const fs = require('fs-extra');
    (fs.pathExists as jest.Mock).mockResolvedValue(false);

    // Set up default prompt mock
    const { promptAsync } = require('../../../prompts');
    jest.mocked(promptAsync).mockResolvedValue({ account: { name: 'jester' } });
  });

  describe('generateConfigsAsync', () => {
    it('should handle a success', async () => {
      const mockGraphqlClient = {} as ExpoGraphqlClient;

      const result = await generateConfigsAsync({ path: undefined }, jester, mockGraphqlClient);

      expect(result).toBeDefined();
      expect(result.projectName).toBeDefined();
      expect(result.projectDirectory).toBeDefined();
      expect(result.projectAccount).toBe('jester');
    });

    it('should automatically generate unique name when project already exists', async () => {
      const mockGraphqlClient = {} as ExpoGraphqlClient;

      // Mock both filesystem and remote checks
      const fs = require('fs-extra');
      const { verifyProjectDoesNotExistAsync } = require('../../../commandUtils/new/verifications');

      (fs.pathExists as jest.Mock).mockResolvedValue(false); // Local filesystem available
      verifyProjectDoesNotExistAsync
        .mockResolvedValueOnce(false) // Original name exists remotely
        .mockResolvedValueOnce(true); // First alternative available

      const result = await generateConfigsAsync({ path: undefined }, jester, mockGraphqlClient);

      expect(result.projectName).toMatch(/^new-expo-project-jester-\d{4}-\d{2}-\d{2}$/);
      expect(result.projectDirectory).toContain('new-expo-project-jester-');
    });

    it('should throw error when all name variations are taken', async () => {
      const mockGraphqlClient = {} as ExpoGraphqlClient;

      // Mock both checks to fail
      const fs = require('fs-extra');
      const { verifyProjectDoesNotExistAsync } = require('../../../commandUtils/new/verifications');

      (fs.pathExists as jest.Mock).mockResolvedValue(true); // All taken locally
      verifyProjectDoesNotExistAsync.mockResolvedValue(false); // All taken remotely

      await expect(
        generateConfigsAsync({ path: undefined }, jester, mockGraphqlClient)
      ).rejects.toThrow('Unable to find a unique project name');
    });
  });

  describe('createProjectAsync', () => {
    it('should create a project', async () => {
      jest.mocked(AppMutation.createAppAsync).mockResolvedValue('test-project-id');
      jest
        .mocked(getPrivateExpoConfigAsync)
        .mockResolvedValue({ name: 'name', slug: 'slug' } as ExpoConfig);
      jest.mocked(createOrModifyExpoConfigAsync);

      const mockGraphqlClient = {} as ExpoGraphqlClient;
      const result = await createProjectAsync({
        graphqlClient: mockGraphqlClient,
        actor: jester,
        projectDirectory: 'test-project',
        projectAccount: 'jester',
        projectName: 'test',
      });

      expect(result).toBe('test-project-id');
      expect(AppMutation.createAppAsync).toHaveBeenCalledWith(mockGraphqlClient, {
        accountId: jester.accounts[0].id,
        projectName: 'test',
      });
      expect(createOrModifyExpoConfigAsync).toHaveBeenCalledWith(
        'test-project',
        {
          extra: { eas: { projectId: 'test-project-id' } },
        },
        { skipSDKVersionRequirement: true }
      );
    });
  });

  describe('package manager flag', () => {
    it('should have correct flag definition', () => {
      const flagDefinition = New.flags['package-manager'];
      expect(flagDefinition).toBeDefined();
      expect(flagDefinition.default).toBe('npm');
      expect(flagDefinition.char).toBe('p');
    });
  });
});
