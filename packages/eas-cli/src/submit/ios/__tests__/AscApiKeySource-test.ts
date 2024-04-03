import { Platform } from '@expo/eas-build-job';
import { vol } from 'memfs';
import { instance, mock } from 'ts-mockito';
import { v4 as uuidv4 } from 'uuid';

import { Analytics } from '../../../analytics/AnalyticsManager';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  jester as mockJester,
  testAppQueryByIdResponse,
  testProjectId,
} from '../../../credentials/__tests__/fixtures-constants';
import { testCommonIosAppCredentialsFragment } from '../../../credentials/__tests__/fixtures-ios';
import { SetUpAscApiKey } from '../../../credentials/ios/actions/SetUpAscApiKey';
import { getCredentialsFromUserAsync } from '../../../credentials/utils/promptForCredentials';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import { createTestProject } from '../../../project/__tests__/project-utils';
import { getBundleIdentifierAsync } from '../../../project/ios/bundleIdentifier';
import { promptAsync } from '../../../prompts';
import { resolveVcsClient } from '../../../vcs';
import { SubmissionContext, createSubmissionContextAsync } from '../../context';
import {
  AscApiKeySource,
  AscApiKeySourceType,
  getAscApiKeyPathAsync,
  getAscApiKeyResultAsync,
} from '../AscApiKeySource';

jest.mock('fs');
jest.mock('../../../prompts');
jest.mock('../../../credentials/utils/promptForCredentials');
jest.mock('../../../user/User', () => ({
  getUserAsync: jest.fn(() => mockJester),
}));
jest.mock('../../../graphql/queries/AppQuery');
jest.mock('../../../project/ios/bundleIdentifier');

const testProject = createTestProject(testProjectId, mockJester.accounts[0].name, {
  android: {
    package: 'com.expo.test.project',
  },
});
const projectId = uuidv4();

const vcsClient = resolveVcsClient();

async function getIosSubmissionContextAsync(): Promise<SubmissionContext<Platform.IOS>> {
  const graphqlClient = instance(mock<ExpoGraphqlClient>());
  const analytics = instance(mock<Analytics>());
  return await createSubmissionContextAsync({
    platform: Platform.IOS,
    projectDir: testProject.projectRoot,
    archiveFlags: {
      url: 'http://expo.dev/fake.apk',
    },
    profile: {
      language: 'en-US',
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
}

beforeAll(() => {
  vol.fromJSON({
    '/asc-api-key.p8': 'super secret',
    '/project_dir/subdir/asc-api-key.p8': 'super secret',
    '/project_dir/another-asc-api-key.p8': 'super secret',
  });
});
afterAll(() => {
  vol.reset();
});

beforeEach(() => {
  jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
});

afterEach(() => {
  jest.mocked(promptAsync).mockClear();
});

describe(getAscApiKeyPathAsync, () => {
  describe('when source is AscApiKeySourceType.path', () => {
    it("prompts for path if the provided file doesn't exist", async () => {
      jest.mocked(promptAsync).mockImplementationOnce(async () => ({
        keyP8Path: '/asc-api-key.p8',
      }));
      jest.mocked(getCredentialsFromUserAsync).mockImplementation(async () => ({
        keyId: 'test-key-id',
        issuerId: 'test-issuer-id',
      }));
      const ctx = await getIosSubmissionContextAsync();
      const source: AscApiKeySource = {
        sourceType: AscApiKeySourceType.path,
        path: { keyP8Path: '/doesnt-exist.p8', keyId: 'test-key-id', issuerId: 'test-issuer-id' },
      };
      const ascApiKeyPath = await getAscApiKeyPathAsync(ctx, source);
      expect(promptAsync).toHaveBeenCalled();
      expect(ascApiKeyPath).toEqual({
        keyP8Path: '/asc-api-key.p8',
        keyId: 'test-key-id',
        issuerId: 'test-issuer-id',
      });
    });

    it("doesn't prompt for path if the provided file exists", async () => {
      const ctx = await getIosSubmissionContextAsync();
      const source: AscApiKeySource = {
        sourceType: AscApiKeySourceType.path,
        path: { keyP8Path: '/asc-api-key.p8', keyId: 'test-key-id', issuerId: 'test-issuer-id' },
      };
      await getAscApiKeyPathAsync(ctx, source);
      expect(promptAsync).not.toHaveBeenCalled();
    });

    it('returns the provided file path if the file exists', async () => {
      const ctx = await getIosSubmissionContextAsync();
      const source: AscApiKeySource = {
        sourceType: AscApiKeySourceType.path,
        path: { keyP8Path: '/asc-api-key.p8', keyId: 'test-key-id', issuerId: 'test-issuer-id' },
      };
      const ascApiKeyPath = await getAscApiKeyPathAsync(ctx, source);
      expect(ascApiKeyPath).toEqual({
        issuerId: 'test-issuer-id',
        keyId: 'test-key-id',
        keyP8Path: '/asc-api-key.p8',
      });
    });
  });

  describe('when source is AscApiKeySourceType.prompt', () => {
    it('prompts for path', async () => {
      jest.mocked(promptAsync).mockImplementationOnce(async () => ({
        keyP8Path: '/asc-api-key.p8',
      }));
      jest.mocked(getCredentialsFromUserAsync).mockImplementation(async () => ({
        keyId: 'test-key-id',
        issuerId: 'test-issuer-id',
      }));
      const ctx = await getIosSubmissionContextAsync();
      const source: AscApiKeySource = {
        sourceType: AscApiKeySourceType.prompt,
      };
      const ascApiKeyPath = await getAscApiKeyPathAsync(ctx, source);
      expect(promptAsync).toHaveBeenCalled();
      expect(ascApiKeyPath).toEqual({
        keyP8Path: '/asc-api-key.p8',
        keyId: 'test-key-id',
        issuerId: 'test-issuer-id',
      });
    });

    it('prompts for path until the user provides an existing file', async () => {
      jest
        .mocked(promptAsync)
        .mockImplementationOnce(async () => ({
          keyP8Path: '/doesnt-exist.p8',
        }))
        .mockImplementationOnce(async () => ({
          keyP8Path: '/blah.p8',
        }))
        .mockImplementationOnce(async () => ({
          keyP8Path: '/asc-api-key.p8',
        }));
      jest.mocked(getCredentialsFromUserAsync).mockImplementation(async () => ({
        keyId: 'test-key-id',
        issuerId: 'test-issuer-id',
      }));
      const ctx = await getIosSubmissionContextAsync();
      const source: AscApiKeySource = {
        sourceType: AscApiKeySourceType.prompt,
      };
      const ascApiKeyPath = await getAscApiKeyPathAsync(ctx, source);
      expect(promptAsync).toHaveBeenCalledTimes(3);
      expect(ascApiKeyPath).toEqual({
        keyP8Path: '/asc-api-key.p8',
        keyId: 'test-key-id',
        issuerId: 'test-issuer-id',
      });
    });
  });
});

describe(getAscApiKeyResultAsync, () => {
  it('returns a local Asc API Key file with a AscApiKeySourceType.path source', async () => {
    const ctx = await getIosSubmissionContextAsync();
    const source: AscApiKeySource = {
      sourceType: AscApiKeySourceType.path,
      path: { keyP8Path: '/asc-api-key.p8', keyId: 'test-key-id', issuerId: 'test-issuer-id' },
    };
    const ascApiKeyResult = await getAscApiKeyResultAsync(ctx, source);
    expect(ascApiKeyResult).toMatchObject({
      result: {
        keyP8: 'super secret',
        keyId: 'test-key-id',
        issuerId: 'test-issuer-id',
      },
      summary: {
        source: 'local',
        path: '/asc-api-key.p8',
        keyId: 'test-key-id',
      },
    });
  });

  it('returns a local Asc API Key file with a AscApiKeySourceType.prompt source', async () => {
    jest.mocked(promptAsync).mockImplementationOnce(async () => ({
      keyP8Path: '/asc-api-key.p8',
    }));
    jest.mocked(getCredentialsFromUserAsync).mockImplementationOnce(async () => ({
      keyId: 'test-key-id',
      issuerId: 'test-issuer-id',
    }));
    const ctx = await getIosSubmissionContextAsync();
    const source: AscApiKeySource = {
      sourceType: AscApiKeySourceType.prompt,
    };
    const serviceAccountResult = await getAscApiKeyResultAsync(ctx, source);
    expect(serviceAccountResult).toMatchObject({
      result: {
        keyP8: 'super secret',
        keyId: 'test-key-id',
        issuerId: 'test-issuer-id',
      },
      summary: {
        source: 'local',
        path: '/asc-api-key.p8',
        keyId: 'test-key-id',
      },
    });
  });

  it('returns an Asc Api Key from server with a AscApiKeySourceType.credentialService source', async () => {
    const graphqlClient = {} as any as ExpoGraphqlClient;
    const analytics = instance(mock<Analytics>());
    const ctx = await createSubmissionContextAsync({
      platform: Platform.IOS,
      projectDir: testProject.projectRoot,
      archiveFlags: {
        url: 'http://expo.dev/fake.apk',
      },
      profile: {
        language: 'en-US',
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
    const source: AscApiKeySource = {
      sourceType: AscApiKeySourceType.credentialsService,
    };
    jest
      .spyOn(SetUpAscApiKey.prototype, 'runAsync')
      .mockImplementation(async _ctx => testCommonIosAppCredentialsFragment);
    jest.mocked(getBundleIdentifierAsync).mockImplementation(async () => 'com.hello.world');

    const result = await getAscApiKeyResultAsync(ctx, source);
    expect(result).toEqual({
      result: {
        ascApiKeyId: testCommonIosAppCredentialsFragment.appStoreConnectApiKeyForSubmissions?.id,
      },
      summary: {
        keyId:
          testCommonIosAppCredentialsFragment.appStoreConnectApiKeyForSubmissions?.keyIdentifier,
        name: testCommonIosAppCredentialsFragment.appStoreConnectApiKeyForSubmissions?.name,
        source: 'EAS servers',
      },
    });
  });
});
