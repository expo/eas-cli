import { AndroidReleaseStatus, AndroidReleaseTrack } from '@expo/eas-json';
import { vol } from 'memfs';
import { v4 as uuidv4 } from 'uuid';

import { asMock } from '../../../__tests__/utils';
import { jester as mockJester } from '../../../credentials/__tests__/fixtures-constants';
import {
  AppPlatform,
  BuildFragment,
  SubmissionAndroidReleaseStatus,
  SubmissionAndroidTrack,
} from '../../../graphql/generated';
import { SubmissionMutation } from '../../../graphql/mutations/SubmissionMutation';
import { createTestProject } from '../../../project/__tests__/project-utils';
import { getProjectIdAsync } from '../../../project/projectUtils';
import { getLatestBuildForSubmissionAsync } from '../../utils/builds';
import AndroidSubmitCommand from '../AndroidSubmitCommand';

jest.mock('fs');
jest.mock('ora');
jest.mock('../../../graphql/mutations/SubmissionMutation', () => ({
  SubmissionMutation: {
    createAndroidSubmissionAsync: jest.fn(),
  },
}));
jest.mock('../../../project/ensureProjectExists');
jest.mock('../../utils/builds');
jest.mock('../../../user/User', () => ({
  getUserAsync: jest.fn(() => mockJester),
}));
jest.mock('../../../user/actions', () => ({
  ensureLoggedInAsync: jest.fn(() => mockJester),
}));
jest.mock('../../../project/projectUtils');

describe(AndroidSubmitCommand, () => {
  const testProject = createTestProject(mockJester, {
    android: {
      package: 'com.expo.test.project',
    },
  });

  const fakeFiles: Record<string, string> = {
    '/apks/fake.apk': 'fake apk',
    '/google-service-account.json': JSON.stringify({ service: 'account' }),
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

  afterEach(() => {
    asMock(getProjectIdAsync).mockClear();
  });

  describe('sending submission', () => {
    it('sends a request to Submission Service', async () => {
      const projectId = uuidv4();

      const ctx = AndroidSubmitCommand.createContext({
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
      });
      const command = new AndroidSubmitCommand(ctx);
      await command.runAsync();

      expect(SubmissionMutation.createAndroidSubmissionAsync).toHaveBeenCalledWith({
        appId: projectId,
        config: {
          archiveUrl: 'http://expo.dev/fake.apk',
          applicationIdentifier: testProject.appJSON.expo.android?.package,
          googleServiceAccountKeyJson: fakeFiles['/google-service-account.json'],
          releaseStatus: SubmissionAndroidReleaseStatus.Draft,
          track: SubmissionAndroidTrack.Internal,
          changesNotSentForReview: false,
        },
      });
    });

    it('assigns the build ID to submission', async () => {
      const projectId = uuidv4();
      asMock(getLatestBuildForSubmissionAsync).mockResolvedValueOnce(fakeBuildFragment);

      const ctx = AndroidSubmitCommand.createContext({
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
      });
      const command = new AndroidSubmitCommand(ctx);
      await command.runAsync();

      expect(SubmissionMutation.createAndroidSubmissionAsync).toHaveBeenCalledWith({
        appId: projectId,
        config: {
          archiveUrl: 'http://expo.dev/fake.apk',
          applicationIdentifier: testProject.appJSON.expo.android?.package,
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
