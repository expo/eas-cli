import { ExpoConfig } from '@expo/config';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { jester } from '../../../credentials/__tests__/fixtures-constants';
import { AppMutation } from '../../../graphql/mutations/AppMutation';
import {
  createOrModifyExpoConfigAsync,
  getPrivateExpoConfigAsync,
} from '../../../project/expoConfig';
import New, { createProjectAsync, generateConfigsAsync } from '../new';

jest.mock('fs-extra', () => ({
  ...jest.requireActual('fs-extra'),
  pathExists: jest.fn().mockResolvedValue(false),
}));

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

jest.mock('../../../project/fetchOrCreateProjectIDForWriteToConfigWithConfirmationAsync', () => ({
  findProjectIdByAccountNameAndSlugNullableAsync: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../../graphql/mutations/AppMutation', () => ({
  AppMutation: {
    createAppAsync: jest.fn().mockResolvedValue('test-project-id'),
  },
}));

jest.mock('../../../project/expoConfig', () => ({
  getPrivateExpoConfigAsync: jest.fn().mockResolvedValue({ extra: {} }),
  createOrModifyExpoConfigAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../prompts', () => ({
  ...jest.requireActual('../../../prompts'),
  promptAsync: jest.fn().mockImplementation(async (options: any) => {
    if (options.name === 'account') {
      return { account: { name: 'jester' } };
    }
    if (options.name === 'name') {
      return { name: options.initial || 'expo-project' };
    }
    return {};
  }),
}));

describe(New.name, () => {
  const mockGraphqlClient = {} as ExpoGraphqlClient;
  describe('generateConfigsAsync', () => {
    it('should orchestrate account selection and project configuration', async () => {
      const result = await generateConfigsAsync({ path: undefined }, jester, mockGraphqlClient);

      expect(result).toEqual({
        projectAccount: 'jester',
        projectDirectory: expect.stringContaining('/expo-project'),
        projectName: 'expo-project',
      });
    });

    it('should pass through path argument to config generation', async () => {
      const customPath = 'my-custom-project';

      const result = await generateConfigsAsync({ path: customPath }, jester, mockGraphqlClient);

      expect(result).toEqual({
        projectAccount: 'jester',
        projectDirectory: expect.stringContaining('/my-custom-project'),
        projectName: 'my-custom-project',
      });
    });
  });

  describe('createProjectAsync', () => {
    it('should create a project', async () => {
      jest.mocked(AppMutation.createAppAsync).mockResolvedValue('test-project-id');
      jest
        .mocked(getPrivateExpoConfigAsync)
        .mockResolvedValue({ name: 'name', slug: 'slug' } as ExpoConfig);
      jest.mocked(createOrModifyExpoConfigAsync);

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
});
