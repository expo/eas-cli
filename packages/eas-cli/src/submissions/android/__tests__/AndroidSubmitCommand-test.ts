import { vol } from 'memfs';
import { v4 as uuidv4 } from 'uuid';

import { asMock } from '../../../__tests__/utils';
import { jester as mockJester } from '../../../credentials/__tests__/fixtures-constants';
import { AppPlatform, SubmissionFragment, SubmissionStatus } from '../../../graphql/generated';
import { createTestProject } from '../../../project/__tests__/project-utils';
import { getProjectIdAsync } from '../../../project/projectUtils';
import SubmissionService from '../../SubmissionService';
import { AndroidArchiveType, AndroidSubmitCommandFlags } from '../../types';
import { getLatestBuildInfoAsync } from '../../utils/builds';
import { AndroidSubmissionConfig, ReleaseStatus, ReleaseTrack } from '../AndroidSubmissionConfig';
import AndroidSubmitCommand from '../AndroidSubmitCommand';

jest.mock('fs');
jest.mock('ora');
jest.mock('../../SubmissionService');
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

  const fakeBuildDetails = {
    buildId: uuidv4(),
    artifactUrl: 'http://expo.io/fake.apk',
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
    const originalStartSubmissionAsync = SubmissionService.startSubmissionAsync;
    const originalGetSubmissionAsync = SubmissionService.getSubmissionAsync;
    beforeAll(() => {
      SubmissionService.startSubmissionAsync = jest.fn(SubmissionService.startSubmissionAsync);
      SubmissionService.getSubmissionAsync = jest.fn(SubmissionService.getSubmissionAsync);
    });
    afterAll(() => {
      SubmissionService.startSubmissionAsync = originalStartSubmissionAsync;
      SubmissionService.getSubmissionAsync = originalGetSubmissionAsync;
    });
    afterEach(() => {
      asMock(SubmissionService.startSubmissionAsync).mockClear();
      asMock(SubmissionService.getSubmissionAsync).mockClear();
    });

    it('sends a request to Submission Service', async () => {
      const projectId = uuidv4();
      asMock(SubmissionService.getSubmissionAsync).mockImplementationOnce(
        async (submissionId: string): Promise<SubmissionFragment> => {
          const actualSubmission = await originalGetSubmissionAsync(submissionId);
          return {
            ...actualSubmission,
            status: SubmissionStatus.Finished,
          };
        }
      );
      asMock(getProjectIdAsync).mockImplementationOnce(() => projectId);

      const options: AndroidSubmitCommandFlags = {
        latest: false,
        url: 'http://expo.io/fake.apk',
        type: 'apk',
        key: '/google-service-account.json',
        track: 'internal',
        releaseStatus: 'draft',
        verbose: false,
      };
      const ctx = AndroidSubmitCommand.createContext(testProject.projectRoot, projectId, options);
      const command = new AndroidSubmitCommand(ctx);
      await command.runAsync();

      const androidSubmissionConfig: AndroidSubmissionConfig = {
        archiveUrl: 'http://expo.io/fake.apk',
        archiveType: AndroidArchiveType.apk,
        androidPackage: testProject.appJSON.expo.android?.package,
        serviceAccount: fakeFiles['/google-service-account.json'],
        releaseStatus: ReleaseStatus.draft,
        track: ReleaseTrack.internal,
        projectId,
      };

      expect(SubmissionService.startSubmissionAsync).toHaveBeenCalledWith(
        AppPlatform.Android,
        projectId,
        androidSubmissionConfig,
        undefined
      );
    });

    it('assigns the build ID to submission', async () => {
      const projectId = uuidv4();
      asMock(SubmissionService.getSubmissionAsync).mockImplementationOnce(
        async (submissionId: string): Promise<SubmissionFragment> => {
          const actualSubmission = await originalGetSubmissionAsync(submissionId);
          return {
            ...actualSubmission,
            status: SubmissionStatus.Finished,
          };
        }
      );
      asMock(getProjectIdAsync).mockImplementationOnce(() => projectId);
      asMock(getLatestBuildInfoAsync).mockResolvedValueOnce(fakeBuildDetails);

      const options: AndroidSubmitCommandFlags = {
        latest: true,
        type: 'apk',
        key: '/google-service-account.json',
        track: 'internal',
        releaseStatus: 'draft',
        verbose: false,
      };
      const ctx = AndroidSubmitCommand.createContext(testProject.projectRoot, projectId, options);
      const command = new AndroidSubmitCommand(ctx);
      await command.runAsync();

      const androidSubmissionConfig: AndroidSubmissionConfig = {
        archiveUrl: 'http://expo.io/fake.apk',
        archiveType: AndroidArchiveType.apk,
        androidPackage: testProject.appJSON.expo.android?.package,
        serviceAccount: fakeFiles['/google-service-account.json'],
        releaseStatus: ReleaseStatus.draft,
        track: ReleaseTrack.internal,
        projectId,
      };

      expect(SubmissionService.startSubmissionAsync).toHaveBeenCalledWith(
        AppPlatform.Android,
        projectId,
        androidSubmissionConfig,
        fakeBuildDetails.buildId
      );
    });
  });
});
