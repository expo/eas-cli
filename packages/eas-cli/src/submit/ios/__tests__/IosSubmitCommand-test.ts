import { Platform } from '@expo/eas-build-job';
import { vol } from 'memfs';
import { instance, mock } from 'ts-mockito';
import { v4 as uuidv4 } from 'uuid';

import { Analytics } from '../../../analytics/AnalyticsManager';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  jester as mockJester,
  testProjectId,
} from '../../../credentials/__tests__/fixtures-constants';
import { SubmissionArchiveSourceType } from '../../../graphql/generated';
import { SubmissionMutation } from '../../../graphql/mutations/SubmissionMutation';
import { createTestProject } from '../../../project/__tests__/project-utils';
import { getOwnerAccountForProjectIdAsync } from '../../../project/projectUtils';
import { getVcsClient } from '../../../vcs';
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

const vcsClient = getVcsClient();

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

  describe('non-interactive mode', () => {
    it("throws error if didn't provide appleId and ascAppId in the submit profile", async () => {
      const projectId = uuidv4();
      const graphqlClient = {} as any as ExpoGraphqlClient;
      const analytics = instance(mock<Analytics>());

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
        graphqlClient,
        analytics,
        exp: testProject.appJSON.expo,
        projectId,
        vcsClient,
      });
      const command = new IosSubmitCommand(ctx);
      await expect(command.runAsync()).rejects.toThrowError();
    });
  });

  describe('sending submission', () => {
    it('sends a request to EAS Submit', async () => {
      const projectId = uuidv4();
      const graphqlClient = {} as any as ExpoGraphqlClient;
      const analytics = instance(mock<Analytics>());

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
        graphqlClient,
        analytics,
        exp: testProject.appJSON.expo,
        projectId,
        vcsClient,
      });
      const command = new IosSubmitCommand(ctx);
      await command.runAsync();

      expect(SubmissionMutation.createIosSubmissionAsync).toHaveBeenCalledWith(graphqlClient, {
        appId: projectId,
        archiveSource: { type: SubmissionArchiveSourceType.Url, url: 'http://expo.dev/fake.ipa' },
        config: {
          appleIdUsername: 'test@example.com',
          appleAppSpecificPassword: 'supersecret',
          ascAppIdentifier: '12345678',
        },
      });

      delete process.env.EXPO_APPLE_APP_SPECIFIC_PASSWORD;
    });
  });
});
