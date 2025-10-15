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

// Mock project lookup
jest.mock('../../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync', () => ({
  findProjectIdByAccountNameAndSlugNullableAsync: jest.fn().mockResolvedValue(null),
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
    it('should orchestrate account selection and project configuration', async () => {
      const mockGraphqlClient = {} as ExpoGraphqlClient;

      const result = await generateConfigsAsync({ path: undefined }, jester, mockGraphqlClient);

      // Verify orchestration: account selected, config generated
      expect(result).toBeDefined();
      expect(result.projectName).toBeDefined();
      expect(result.projectDirectory).toBeDefined();
      expect(result.projectAccount).toBe('jester');
    });

    it('should pass through path argument to config generation', async () => {
      const mockGraphqlClient = {} as ExpoGraphqlClient;
      const customPath = 'my-custom-project';

      const result = await generateConfigsAsync({ path: customPath }, jester, mockGraphqlClient);

      expect(result.projectName).toBe('my-custom-project');
      expect(result.projectDirectory).toContain('my-custom-project');
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
