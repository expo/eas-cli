import { Platform } from '@expo/eas-build-job';
import { vol } from 'memfs';
import { v4 as uuidv4 } from 'uuid';

import {
  jester as mockJester,
  testProjectId,
} from '../../../credentials/__tests__/fixtures-constants';
import { SubmissionMutation } from '../../../graphql/mutations/SubmissionMutation';
import { createTestProject } from '../../../project/__tests__/project-utils';
import { getOwnerAccountForProjectIdAsync, getProjectIdAsync } from '../../../project/projectUtils';
import { createSubmissionContextAsync } from '../../context';
import IosSubmitCommand from '../IosSubmitCommand';

jest.mock('fs');
jest.mock('../../../ora');
jest.mock('../../../graphql/mutations/SubmissionMutation', () => ({
  SubmissionMutation: {
    createIosSubmissionAsync: jest.fn(),
  },
}));
jest.mock('../../../user/User', () => ({
  getUserAsync: jest.fn(() => mockJester),
}));
jest.mock('../../../user/actions', () => ({
  ensureLoggedInAsync: jest.fn(() => mockJester),
}));
jest.mock('../../../project/projectUtils');

describe(IosSubmitCommand, () => {
  const testProject = createTestProject(testProjectId, mockJester.accounts[0].name, {});

  const fakeFiles: Record<string, string> = {
    '/artifacts/fake.ipa': 'fake ipa',
  };

  beforeAll(() => {
    vol.fromJSON({
      ...testProject.projectTree,
      ...fakeFiles,
    });
  });
  afterAll(() => {
    vol.reset();
    jest.unmock('@expo/config');
  });

  beforeEach(() => {
    jest.mocked(getOwnerAccountForProjectIdAsync).mockResolvedValue(mockJester.accounts[0]);
  });

  afterEach(() => {
    jest.mocked(getProjectIdAsync).mockClear();
  });

  describe('non-interactive mode', () => {
    it("throws error if didn't provide appleId and ascAppId in the submit profile", async () => {
      const projectId = uuidv4();

      const ctx = await createSubmissionContextAsync({
        platform: Platform.IOS,
        projectDir: testProject.projectRoot,
        archiveFlags: {
          url: 'http://expo.dev/fake.ipa',
        },
        profile: {
          language: 'en-US',
        },
        nonInteractive: true,
        actor: mockJester,
        getDynamicProjectConfigAsync: async () => ({ exp: testProject.appJSON.expo, projectId }),
      });
      const command = new IosSubmitCommand(ctx);
      await expect(command.runAsync()).rejects.toThrowError();
    });
  });

  describe('sending submission', () => {
    it('sends a request to Submission Service', async () => {
      const projectId = uuidv4();

      process.env.EXPO_APPLE_APP_SPECIFIC_PASSWORD = 'supersecret';

      const ctx = await createSubmissionContextAsync({
        platform: Platform.IOS,
        projectDir: testProject.projectRoot,
        archiveFlags: {
          url: 'http://expo.dev/fake.ipa',
        },
        profile: {
          language: 'en-US',
          appleId: 'test@example.com',
          ascAppId: '12345678',
        },
        nonInteractive: false,
        actor: mockJester,
        getDynamicProjectConfigAsync: async () => ({ exp: testProject.appJSON.expo, projectId }),
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
