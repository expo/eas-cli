import { vol } from 'memfs';
import { v4 as uuidv4 } from 'uuid';

import { asMock } from '../../../__tests__/utils';
import { jester as mockJester } from '../../../credentials/__tests__/fixtures-constants';
import { AppPlatform, BuildFragment } from '../../../graphql/generated';
import { SubmissionMutation } from '../../../graphql/mutations/SubmissionMutation';
import { createTestProject } from '../../../project/__tests__/project-utils';
import { getProjectIdAsync } from '../../../project/projectUtils';
import { AndroidArchiveType, AndroidSubmitCommandFlags } from '../../types';
import { getLatestBuildForSubmissionAsync } from '../../utils/builds';
import { AndroidSubmissionConfig, ReleaseStatus, ReleaseTrack } from '../AndroidSubmissionConfig';
import AndroidSubmitCommand from '../AndroidSubmitCommand';

jest.mock('fs');
jest.mock('ora');
jest.mock('../../../graphql/mutations/SubmissionMutation', () => ({
  SubmissionMutation: {
    createSubmissionAsync: jest.fn(),
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

    jest.unmock('@expo/config');
  });

  afterEach(() => {
    asMock(getProjectIdAsync).mockClear();
  });

  describe('sending submission', () => {
    it('sends a request to Submission Service', async () => {
      const projectId = uuidv4();

      const commandFlags: AndroidSubmitCommandFlags = {
        latest: false,
        url: 'http://expo.dev/fake.apk',
        type: 'apk',
        serviceAccountKeyPath: '/google-service-account.json',
        track: 'internal',
        releaseStatus: 'draft',
        changesNotSentForReview: false,
      };
      const ctx = AndroidSubmitCommand.createContext({
        projectDir: testProject.projectRoot,
        projectId,
        commandFlags,
      });
      const command = new AndroidSubmitCommand(ctx);
      await command.runAsync();

      const androidSubmissionConfig: AndroidSubmissionConfig = {
        archiveUrl: 'http://expo.dev/fake.apk',
        archiveType: AndroidArchiveType.apk,
        androidPackage: testProject.appJSON.expo.android?.package,
        serviceAccount: fakeFiles['/google-service-account.json'],
        releaseStatus: ReleaseStatus.draft,
        track: ReleaseTrack.internal,
        changesNotSentForReview: false,
        projectId,
      };

      expect(SubmissionMutation.createSubmissionAsync).toHaveBeenCalledWith({
        appId: projectId,
        config: androidSubmissionConfig,
        platform: AppPlatform.Android,
      });
    });

    it('assigns the build ID to submission', async () => {
      const projectId = uuidv4();
      asMock(getLatestBuildForSubmissionAsync).mockResolvedValueOnce(fakeBuildFragment);

      const commandFlags: AndroidSubmitCommandFlags = {
        latest: true,
        type: 'apk',
        serviceAccountKeyPath: '/google-service-account.json',
        track: 'internal',
        releaseStatus: 'draft',
        changesNotSentForReview: false,
      };
      const ctx = AndroidSubmitCommand.createContext({
        projectDir: testProject.projectRoot,
        projectId,
        commandFlags,
      });
      const command = new AndroidSubmitCommand(ctx);
      await command.runAsync();

      const androidSubmissionConfig: AndroidSubmissionConfig = {
        archiveUrl: 'http://expo.dev/fake.apk',
        archiveType: AndroidArchiveType.apk,
        androidPackage: testProject.appJSON.expo.android?.package,
        serviceAccount: fakeFiles['/google-service-account.json'],
        releaseStatus: ReleaseStatus.draft,
        track: ReleaseTrack.internal,
        projectId,
        changesNotSentForReview: false,
      };

      expect(SubmissionMutation.createSubmissionAsync).toHaveBeenCalledWith({
        appId: projectId,
        config: androidSubmissionConfig,
        platform: AppPlatform.Android,
        submittedBuildId: fakeBuildFragment.id,
      });
    });
  });
});
