import { Platform } from '@expo/eas-build-job';
import { AndroidReleaseStatus, AndroidReleaseTrack } from '@expo/eas-json';
import { vol } from 'memfs';
import { instance, mock } from 'ts-mockito';
import { v4 as uuidv4 } from 'uuid';

import { Analytics } from '../../../analytics/AnalyticsManager';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { testAndroidAppCredentialsFragment } from '../../../credentials/__tests__/fixtures-android';
import {
  jester as mockJester,
  testProjectId,
} from '../../../credentials/__tests__/fixtures-constants';
import { SetUpGoogleServiceAccountKeyForSubmissions } from '../../../credentials/android/actions/SetUpGoogleServiceAccountKeyForSubmissions';
import { createTestProject } from '../../../project/__tests__/project-utils';
import { getOwnerAccountForProjectIdAsync } from '../../../project/projectUtils';
import { promptAsync } from '../../../prompts';
import { resolveVcsClient } from '../../../vcs';
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
jest.mock('../../../credentials/android/actions/SetUpGoogleServiceAccountKeyForSubmissions');
jest.mock('../../../user/User', () => ({
  getUserAsync: jest.fn(() => mockJester),
}));

const testProject = createTestProject(testProjectId, mockJester.accounts[0].name, {
  android: {
    package: 'com.expo.test.project',
  },
});

const projectId = uuidv4();
const mockDetectableServiceAccountJson = JSON.stringify({
  type: 'service_account',
  private_key: 'super secret',
  client_email: 'beep-boop@iam.gserviceaccount.com',
});

const vcsClient = resolveVcsClient();

beforeAll(() => {
  vol.fromJSON({
    '/google-service-account.json': mockDetectableServiceAccountJson,
    '/project_dir/subdir/service-account.json': mockDetectableServiceAccountJson,
    '/project_dir/another-service-account.json': mockDetectableServiceAccountJson,
    '/other_dir/invalid_file.txt': 'this is not even a JSON',
  });
  jest
    .spyOn(SetUpGoogleServiceAccountKeyForSubmissions.prototype, 'runAsync')
    .mockImplementation(async () => testAndroidAppCredentialsFragment);
});
afterAll(() => {
  vol.reset();
});

beforeEach(() => {
  jest.mocked(getOwnerAccountForProjectIdAsync).mockResolvedValue(mockJester.accounts[0]);
});

afterEach(() => {
  jest.mocked(promptAsync).mockClear();
  jest.restoreAllMocks();
});

describe(getServiceAccountKeyPathAsync, () => {
  describe('when source is ServiceAccountSourceType.path', () => {
    it("prompts for path if the provided file doesn't exist", async () => {
      jest.mocked(promptAsync).mockImplementationOnce(async () => ({
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
      jest.mocked(promptAsync).mockImplementationOnce(async () => ({
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
      jest
        .mocked(promptAsync)
        .mockImplementationOnce(async () => ({
          filePath: '/doesnt-exist.json',
        }))
        .mockImplementationOnce(async () => ({
          filePath: '/googl-service-account.json',
        }))
        .mockImplementationOnce(async () => ({
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
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    const analytics = instance(mock<Analytics>());
    const ctx = await createSubmissionContextAsync({
      platform: Platform.ANDROID,
      projectDir: testProject.projectRoot,
      archiveFlags: {
        url: 'http://expo.dev/fake.apk',
      },
      profile: {
        track: AndroidReleaseTrack.internal,
        releaseStatus: AndroidReleaseStatus.draft,
        changesNotSentForReview: false,
      },
      nonInteractive: true,
      isVerboseFastlaneEnabled: false,
      actor: mockJester,
      graphqlClient,
      analytics,
      exp: testProject.appJSON.expo,
      projectId,
      vcsClient,
    });
    const source: ServiceAccountSource = {
      sourceType: ServiceAccountSourceType.path,
      path: '/project_dir/subdir/service-account.json',
    };
    const serviceAccountResult = await getServiceAccountKeyResultAsync(ctx, source);
    expect(serviceAccountResult).toMatchObject({
      result: {
        googleServiceAccountKeyJson: mockDetectableServiceAccountJson,
      },
      summary: {
        source: 'local',
        path: '/project_dir/subdir/service-account.json',
        email: 'beep-boop@iam.gserviceaccount.com',
      },
    });
  });

  it('returns a local Service Account Key file with a ServiceAccountSourceType.prompt source', async () => {
    jest.mocked(promptAsync).mockImplementationOnce(async () => ({
      filePath: '/project_dir/subdir/service-account.json',
    }));
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    const analytics = instance(mock<Analytics>());
    const ctx = await createSubmissionContextAsync({
      platform: Platform.ANDROID,
      projectDir: testProject.projectRoot,
      archiveFlags: {
        url: 'http://expo.dev/fake.apk',
      },
      profile: {
        track: AndroidReleaseTrack.internal,
        releaseStatus: AndroidReleaseStatus.draft,
        changesNotSentForReview: false,
      },
      nonInteractive: true,
      isVerboseFastlaneEnabled: false,
      actor: mockJester,
      graphqlClient,
      analytics,
      exp: testProject.appJSON.expo,
      projectId,
      vcsClient,
    });
    const source: ServiceAccountSource = {
      sourceType: ServiceAccountSourceType.prompt,
    };
    const serviceAccountResult = await getServiceAccountKeyResultAsync(ctx, source);
    expect(serviceAccountResult).toMatchObject({
      result: {
        googleServiceAccountKeyJson: mockDetectableServiceAccountJson,
      },
      summary: {
        source: 'local',
        path: '/project_dir/subdir/service-account.json',
        email: 'beep-boop@iam.gserviceaccount.com',
      },
    });
  });

  it('returns a remote Service Account Key file with a ServiceAccountSourceType.credentialService source', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    const analytics = instance(mock<Analytics>());
    const ctx = await createSubmissionContextAsync({
      platform: Platform.ANDROID,
      projectDir: testProject.projectRoot,
      archiveFlags: {
        url: 'http://expo.dev/fake.apk',
      },
      profile: {
        track: AndroidReleaseTrack.internal,
        releaseStatus: AndroidReleaseStatus.draft,
        changesNotSentForReview: false,
      },
      nonInteractive: true,
      isVerboseFastlaneEnabled: false,
      actor: mockJester,
      graphqlClient,
      analytics,
      exp: testProject.appJSON.expo,
      projectId,
      vcsClient,
    });
    const serviceAccountResult = await getServiceAccountKeyResultAsync(ctx, {
      sourceType: ServiceAccountSourceType.credentialsService,
      androidApplicationIdentifier: 'test.application.identiifer',
    });
    expect(serviceAccountResult).toMatchObject({
      result: { googleServiceAccountKeyId: 'test-id' },
      summary: { source: 'EAS servers', email: 'quin@expo.io' },
    });
  });
});
