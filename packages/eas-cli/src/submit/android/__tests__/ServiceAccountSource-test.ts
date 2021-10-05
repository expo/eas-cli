import { Platform } from '@expo/eas-build-job';
import { AndroidReleaseStatus, AndroidReleaseTrack } from '@expo/eas-json';
import { vol } from 'memfs';
import { v4 as uuidv4 } from 'uuid';

import { asMock } from '../../../__tests__/utils';
import { testAndroidAppCredentialsFragment } from '../../../credentials/__tests__/fixtures-android';
import { jester as mockJester } from '../../../credentials/__tests__/fixtures-constants';
import { SetupGoogleServiceAccountKey } from '../../../credentials/android/actions/SetupGoogleServiceAccountKey';
import { createTestProject } from '../../../project/__tests__/project-utils';
import { promptAsync } from '../../../prompts';
import { createSubmissionContextAsync } from '../../context';
import {
  ServiceAccountSource,
  ServiceAccountSourceType,
  getServiceAccountKeyPathAsync,
  getServiceAccountKeyResultAsync,
} from '../ServiceAccountSource';

jest.mock('fs');
jest.mock('../../../prompts');
jest.mock('../../../project/projectUtils');
jest.mock('../../../credentials/android/actions/SetupGoogleServiceAccountKey');
jest.mock('../../../user/User', () => ({
  getUserAsync: jest.fn(() => mockJester),
}));
jest.mock('../../../user/Account', () => ({
  findAccountByName: jest.fn(() => mockJester.accounts[0]),
}));
const testProject = createTestProject(mockJester, {
  android: {
    package: 'com.expo.test.project',
  },
});
const mockManifest = { exp: testProject.appJSON.expo };
jest.mock('@expo/config', () => ({
  getConfig: jest.fn(() => mockManifest),
}));

const projectId = uuidv4();
const mockDetectableServiceAccountJson = JSON.stringify({
  type: 'service_account',
  private_key: 'super secret',
  client_email: 'foo@bar.com',
});

beforeAll(() => {
  vol.fromJSON({
    '/google-service-account.json': JSON.stringify({ service: 'account' }),
    '/project_dir/subdir/service-account.json': mockDetectableServiceAccountJson,
    '/project_dir/another-service-account.json': mockDetectableServiceAccountJson,
    '/other_dir/invalid_file.txt': 'this is not even a JSON',
  });
  jest
    .spyOn(SetupGoogleServiceAccountKey.prototype, 'runAsync')
    .mockImplementation(async () => testAndroidAppCredentialsFragment);
});
afterAll(() => {
  vol.reset();
});

afterEach(() => {
  asMock(promptAsync).mockClear();
  jest.restoreAllMocks();
});

describe(getServiceAccountKeyPathAsync, () => {
  describe('when source is ServiceAccountSourceType.path', () => {
    it("prompts for path if the provided file doesn't exist", async () => {
      asMock(promptAsync).mockImplementationOnce(() => ({
        filePath: '/google-service-account.json',
      }));
      const source: ServiceAccountSource = {
        sourceType: ServiceAccountSourceType.path,
        path: '/doesnt-exist.json',
      };
      const serviceAccountPath = await getServiceAccountKeyPathAsync(source);
      expect(promptAsync).toHaveBeenCalled();
      expect(serviceAccountPath).toBe('/google-service-account.json');
    });

    it("doesn't prompt for path if the provided file exists", async () => {
      const source: ServiceAccountSource = {
        sourceType: ServiceAccountSourceType.path,
        path: '/google-service-account.json',
      };
      await getServiceAccountKeyPathAsync(source);
      expect(promptAsync).not.toHaveBeenCalled();
    });

    it('returns the provided file path if the file exists', async () => {
      const source: ServiceAccountSource = {
        sourceType: ServiceAccountSourceType.path,
        path: '/google-service-account.json',
      };
      const serviceAccountPath = await getServiceAccountKeyPathAsync(source);
      expect(serviceAccountPath).toBe('/google-service-account.json');
    });
  });

  describe('when source is ServiceAccountSourceType.prompt', () => {
    it('prompts for path', async () => {
      asMock(promptAsync).mockImplementationOnce(() => ({
        filePath: '/google-service-account.json',
      }));
      const source: ServiceAccountSource = {
        sourceType: ServiceAccountSourceType.prompt,
      };
      const serviceAccountPath = await getServiceAccountKeyPathAsync(source);
      expect(promptAsync).toHaveBeenCalled();
      expect(serviceAccountPath).toBe('/google-service-account.json');
    });

    it('prompts for path until the user provides an existing file', async () => {
      asMock(promptAsync)
        .mockImplementationOnce(() => ({
          filePath: '/doesnt-exist.json',
        }))
        .mockImplementationOnce(() => ({
          filePath: '/googl-service-account.json',
        }))
        .mockImplementationOnce(() => ({
          filePath: '/google-service-account.json',
        }));
      const source: ServiceAccountSource = {
        sourceType: ServiceAccountSourceType.prompt,
      };
      const serviceAccountPath = await getServiceAccountKeyPathAsync(source);
      expect(promptAsync).toHaveBeenCalledTimes(3);
      expect(serviceAccountPath).toBe('/google-service-account.json');
    });
  });
});

describe(getServiceAccountKeyResultAsync, () => {
  it('returns a local Service Account Key file with a ServiceAccountSourceType.path source', async () => {
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
    });
    const source: ServiceAccountSource = {
      sourceType: ServiceAccountSourceType.path,
      path: '/project_dir/subdir/service-account.json',
    };
    const serviceAccountResult = await getServiceAccountKeyResultAsync(ctx, source, 'test.sdf');
    expect(serviceAccountResult).toMatchObject({
      result: {
        googleServiceAccountKeyJson: mockDetectableServiceAccountJson,
      },
      summary: {
        source: 'local',
        path: '/project_dir/subdir/service-account.json',
        email: 'foo@bar.com',
      },
    });
  });

  it('returns a local Service Account Key file with a ServiceAccountSourceType.prompt source', async () => {
    asMock(promptAsync).mockImplementationOnce(() => ({
      filePath: '/project_dir/subdir/service-account.json',
    }));
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
    });
    const source: ServiceAccountSource = {
      sourceType: ServiceAccountSourceType.prompt,
    };
    const serviceAccountResult = await getServiceAccountKeyResultAsync(ctx, source, 'test.sdf');
    expect(serviceAccountResult).toMatchObject({
      result: {
        googleServiceAccountKeyJson: mockDetectableServiceAccountJson,
      },
      summary: {
        source: 'local',
        path: '/project_dir/subdir/service-account.json',
        email: 'foo@bar.com',
      },
    });
  });

  it('returns a remote Service Account Key file with a ServiceAccountSourceType.credentialService source', async () => {
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
    });
    const serviceAccountResult = await getServiceAccountKeyResultAsync(
      ctx,
      {
        sourceType: ServiceAccountSourceType.credentialsService,
      },
      'test.application.identiifer'
    );
    expect(serviceAccountResult).toMatchObject({
      result: { googleServiceAccountKeyId: 'test-id' },
      summary: { source: 'EAS servers', email: 'quin@expo.io' },
    });
  });
});
