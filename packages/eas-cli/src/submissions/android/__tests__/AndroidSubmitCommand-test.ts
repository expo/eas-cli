import { vol } from 'memfs';
import { v4 as uuidv4 } from 'uuid';

import { asMock } from '../../../__tests__/utils';
import { jester as mockJester } from '../../../credentials/__tests__/fixtures-constants';
import { createTestProject } from '../../../project/__tests__/project-utils';
import { ensureProjectExistsAsync } from '../../../project/ensureProjectExists';
import SubmissionService from '../../SubmissionService';
import { Submission, SubmissionStatus } from '../../SubmissionService.types';
import { AndroidSubmitCommandFlags, SubmissionPlatform } from '../../types';
import {
  AndroidSubmissionConfig,
  ArchiveType,
  ReleaseStatus,
  ReleaseTrack,
} from '../AndroidSubmissionConfig';
import AndroidSubmitCommand from '../AndroidSubmitCommand';

jest.mock('fs');
jest.mock('../../SubmissionService');
jest.mock('../../../project/ensureProjectExists');
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
    asMock(ensureProjectExistsAsync).mockClear();
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
        async (projectId: string, submissionId: string): Promise<Submission> => {
          const actualSubmission = await originalGetSubmissionAsync(projectId, submissionId);
          return {
            ...actualSubmission,
            status: SubmissionStatus.FINISHED,
          };
        }
      );
      asMock(ensureProjectExistsAsync).mockImplementationOnce(() => projectId);

      const options: AndroidSubmitCommandFlags = {
        latest: false,
        url: 'http://expo.io/fake.apk',
        type: 'apk',
        key: '/google-service-account.json',
        track: 'internal',
        releaseStatus: 'draft',
        verbose: false,
      };
      const ctx = AndroidSubmitCommand.createContext(testProject.projectRoot, options);
      const command = new AndroidSubmitCommand(ctx);
      await command.runAsync();

      const androidSubmissionConfig: AndroidSubmissionConfig = {
        archiveUrl: 'http://expo.io/fake.apk',
        archiveType: ArchiveType.apk,
        androidPackage: testProject.appJSON.expo.android?.package,
        serviceAccount: fakeFiles['/google-service-account.json'],
        releaseStatus: ReleaseStatus.draft,
        track: ReleaseTrack.internal,
        projectId,
      };

      expect(SubmissionService.startSubmissionAsync).toHaveBeenCalledWith(
        SubmissionPlatform.Android,
        projectId,
        androidSubmissionConfig
      );
    });
  });
});
