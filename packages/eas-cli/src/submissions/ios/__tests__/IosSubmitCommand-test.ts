import { vol } from 'memfs';
import { v4 as uuidv4 } from 'uuid';

import { asMock } from '../../../__tests__/utils';
import { jester as mockJester } from '../../../credentials/__tests__/fixtures-constants';
import { SubmissionMutation } from '../../../graphql/mutations/SubmissionMutation';
import { createTestProject } from '../../../project/__tests__/project-utils';
import { getProjectIdAsync } from '../../../project/projectUtils';
import IosSubmitCommand from '../IosSubmitCommand';

jest.mock('fs');
jest.mock('ora');
jest.mock('../../../graphql/mutations/SubmissionMutation', () => ({
  SubmissionMutation: {
    createIosSubmissionAsync: jest.fn(),
  },
}));
jest.mock('../../../project/ensureProjectExists');
jest.mock('../../../user/User', () => ({
  getUserAsync: jest.fn(() => mockJester),
}));
jest.mock('../../../user/actions', () => ({
  ensureLoggedInAsync: jest.fn(() => mockJester),
}));
jest.mock('../../../project/projectUtils');

describe(IosSubmitCommand, () => {
  const testProject = createTestProject(mockJester, {});

  const fakeFiles: Record<string, string> = {
    '/artifacts/fake.ipa': 'fake ipa',
  };

  beforeAll(() => {
    vol.fromJSON({
      ...testProject.projectTree,
      ...fakeFiles,
    });

    const mockManifest = { exp: testProject.appJSON.expo };
    jest.mock('@expo/config', () => ({
      getConfig: jest.fn(() => mockManifest),
    }));
  });
  afterAll(() => {
    vol.reset();
    jest.unmock('@expo/config');
  });

  afterEach(() => {
    asMock(getProjectIdAsync).mockClear();
  });

  describe('sending submission', () => {
    it('sends a request to Submission Service', async () => {
      const projectId = uuidv4();

      process.env.EXPO_APPLE_APP_SPECIFIC_PASSWORD = 'supersecret';

      const ctx = IosSubmitCommand.createContext({
        projectDir: testProject.projectRoot,
        projectId,
        archiveFlags: {
          url: 'http://expo.dev/fake.ipa',
        },
        profile: {
          language: 'en-US',
          appleId: 'test@example.com',
          ascAppId: '12345678',
        },
      });
      const command = new IosSubmitCommand(ctx);
      await command.runAsync();

      expect(SubmissionMutation.createIosSubmissionAsync).toHaveBeenCalledWith({
        appId: projectId,
        config: {
          archiveUrl: 'http://expo.dev/fake.ipa',
          appleIdUsername: 'test@example.com',
          appleAppSpecificPassword: 'supersecret',
          ascAppIdentifier: '12345678',
        },
      });

      delete process.env.EXPO_APPLE_APP_SPECIFIC_PASSWORD;
    });
  });
});
