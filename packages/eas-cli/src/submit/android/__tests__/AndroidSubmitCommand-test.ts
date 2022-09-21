import { Platform } from '@expo/eas-build-job';
import { AndroidReleaseStatus, AndroidReleaseTrack } from '@expo/eas-json';
import { vol } from 'memfs';
import { v4 as uuidv4 } from 'uuid';

import {
  jester as mockJester,
  testProjectId,
} from '../../../credentials/__tests__/fixtures-constants';
import {
  AppPlatform,
  BuildFragment,
  SubmissionAndroidReleaseStatus,
  SubmissionAndroidTrack,
} from '../../../graphql/generated';
import { SubmissionMutation } from '../../../graphql/mutations/SubmissionMutation';
import { createTestProject } from '../../../project/__tests__/project-utils';
import { getOwnerAccountForProjectIdAsync, getProjectIdAsync } from '../../../project/projectUtils';
import { createSubmissionContextAsync } from '../../context';
import { getRecentBuildsForSubmissionAsync } from '../../utils/builds';
import AndroidSubmitCommand from '../AndroidSubmitCommand';

jest.mock('fs');
jest.mock('../../../ora');
jest.mock('../../../graphql/mutations/SubmissionMutation', () => ({
  SubmissionMutation: {
    createAndroidSubmissionAsync: jest.fn(),
  },
}));
jest.mock('../../utils/builds');
jest.mock('../../../user/User', () => ({
  getUserAsync: jest.fn(() => mockJester),
}));
jest.mock('../../../user/actions', () => ({
  ensureLoggedInAsync: jest.fn(() => mockJester),
}));
jest.mock('../../../project/projectUtils');

describe(AndroidSubmitCommand, () => {
  const testProject = createTestProject(testProjectId, mockJester.accounts[0].name, {
    android: {
      package: 'com.expo.test.project',
    },
  });

  const fakeFiles: Record<string, string> = {
    '/apks/fake.apk': 'fake apk',
    '/google-service-account.json': JSON.stringify({
      type: 'service_account',
      private_key: 'super secret',
      client_email: 'beep-boop@iam.gserviceaccount.com',
    }),
  };

  const fakeBuildFragment: Partial<BuildFragment> = {
    id: uuidv4(),
    artifacts: { buildUrl: 'http://expo.dev/fake.apk' },
    appVersion: '1.2.3',
    platform: AppPlatform.Android,
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
  });

  beforeEach(() => {
    jest.mocked(getOwnerAccountForProjectIdAsync).mockResolvedValue(mockJester.accounts[0]);
  });

  afterEach(() => {
    jest.mocked(getProjectIdAsync).mockClear();
  });

  describe('non-interactive mode', () => {
    it("throws error if didn't provide serviceAccountKeyPath in the submit profile", async () => {
      const projectId = uuidv4();

      const ctx = await createSubmissionContextAsync({
        platform: Platform.ANDROID,
        projectDir: testProject.projectRoot,
        projectId,
        archiveFlags: {
          url: 'http://expo.dev/fake.apk',
        },
        profile: {
          track: AndroidReleaseTrack.internal,
          releaseStatus: AndroidReleaseStatus.draft,
          changesNotSentForReview: false,
        },
        nonInteractive: true,
        actor: mockJester,
      });
      const command = new AndroidSubmitCommand(ctx);
      await expect(command.runAsync()).rejects.toThrowError();
    });
  });

  describe('sending submission', () => {
    it('sends a request to Submission Service', async () => {
      const projectId = uuidv4();

      const ctx = await createSubmissionContextAsync({
        platform: Platform.ANDROID,
        projectDir: testProject.projectRoot,
        projectId,
        archiveFlags: {
          url: 'http://expo.dev/fake.apk',
        },
        profile: {
          serviceAccountKeyPath: '/google-service-account.json',
          track: AndroidReleaseTrack.internal,
          releaseStatus: AndroidReleaseStatus.draft,
          changesNotSentForReview: false,
        },
        nonInteractive: false,
        actor: mockJester,
      });
      const command = new AndroidSubmitCommand(ctx);
      await command.runAsync();

      expect(SubmissionMutation.createAndroidSubmissionAsync).toHaveBeenCalledWith({
        appId: projectId,
        config: {
          archiveUrl: 'http://expo.dev/fake.apk',
          googleServiceAccountKeyJson: fakeFiles['/google-service-account.json'],
          releaseStatus: SubmissionAndroidReleaseStatus.Draft,
          track: SubmissionAndroidTrack.Internal,
          changesNotSentForReview: false,
        },
      });
    });

    it('assigns the build ID to submission', async () => {
      const projectId = uuidv4();
      jest
        .mocked(getRecentBuildsForSubmissionAsync)
        .mockResolvedValueOnce([fakeBuildFragment as BuildFragment]);

      const ctx = await createSubmissionContextAsync({
        platform: Platform.ANDROID,
        projectDir: testProject.projectRoot,
        projectId,
        archiveFlags: {
          latest: true,
        },
        profile: {
          serviceAccountKeyPath: '/google-service-account.json',
          track: AndroidReleaseTrack.internal,
          releaseStatus: AndroidReleaseStatus.draft,
          changesNotSentForReview: false,
        },
        nonInteractive: false,
        actor: mockJester,
      });
      const command = new AndroidSubmitCommand(ctx);
      await command.runAsync();

      expect(SubmissionMutation.createAndroidSubmissionAsync).toHaveBeenCalledWith({
        appId: projectId,
        config: {
          googleServiceAccountKeyJson: fakeFiles['/google-service-account.json'],
          releaseStatus: SubmissionAndroidReleaseStatus.Draft,
          track: SubmissionAndroidTrack.Internal,
          changesNotSentForReview: false,
        },
        submittedBuildId: fakeBuildFragment.id,
      });
    });
  });
});
