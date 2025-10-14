import { ExpoConfig } from '@expo/config';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { jester } from '../../../credentials/__tests__/fixtures-constants';
import { AppMutation } from '../../../graphql/mutations/AppMutation';
import {
  createOrModifyExpoConfigAsync,
  getPrivateExpoConfigAsync,
} from '../../../project/expoConfig';
import New, { createProjectAsync, verifyConfigsAsync } from '../new';

jest.mock('../../../prompts', () => ({
  promptAsync: jest.fn(),
  selectAsync: jest.fn(),
}));
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

// Mock verification functions
jest.mock('../../../commandUtils/new/verifications', () => ({
  verifyAccountPermissionsAsync: jest.fn().mockResolvedValue(true),
  verifyProjectDoesNotExistAsync: jest.fn().mockResolvedValue(true),
  verifyProjectDirectoryDoesNotExistAsync: jest.fn().mockResolvedValue(true),
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
  describe('verifyConfigsAsync', () => {
    it('should handle a success', async () => {
      const mockGraphqlClient = {} as ExpoGraphqlClient;
      const configs = {
        projectName: 'test',
        projectDirectory: 'test',
        projectAccount: 'test',
      };

      const result = await verifyConfigsAsync(configs, jester, mockGraphqlClient);

      expect(result).toEqual(configs);
    });

    it('should handle failure then success', async () => {
      const mockGraphqlClient = {} as ExpoGraphqlClient;
      const configs = {
        projectName: 'test',
        projectDirectory: 'test',
        projectAccount: 'test',
      };

      // Mock verification functions to fail first, then succeed
      const { verifyAccountPermissionsAsync } = require('../../../commandUtils/new/verifications');
      verifyAccountPermissionsAsync.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      // Mock promptForProjectAccountAsync to return a valid account
      const { promptAsync } = require('../../../prompts');
      promptAsync.mockResolvedValue({ account: { name: 'jester' } });

      const result = await verifyConfigsAsync(configs, jester, mockGraphqlClient);

      expect(result).toBeDefined();
    });

    it('should handle max retries failure', async () => {
      const mockGraphqlClient = {} as ExpoGraphqlClient;
      const configs = {
        projectName: 'test',
        projectDirectory: 'test',
        projectAccount: 'test',
      };

      // Mock verification functions to always fail
      const { verifyAccountPermissionsAsync } = require('../../../commandUtils/new/verifications');
      verifyAccountPermissionsAsync.mockResolvedValue(false);

      // Mock promptForProjectAccountAsync to return the same account (so it keeps failing)
      const { promptAsync } = require('../../../prompts');
      promptAsync.mockResolvedValue({ account: { name: 'test' } });

      await expect(verifyConfigsAsync(configs, jester, mockGraphqlClient)).rejects.toThrow(
        'Unable to resolve project configuration conflicts after multiple attempts. Please try again with different values.'
      );
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
