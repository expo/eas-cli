import { Platform } from '@expo/eas-build-job';
import { instance, mock } from 'ts-mockito';
import { v4 as uuidv4 } from 'uuid';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  jester as mockJester,
  testAppQueryByIdResponse,
  testProjectId,
} from '../../../credentials/__tests__/fixtures-constants';
import { testCommonIosAppCredentialsFragment } from '../../../credentials/__tests__/fixtures-ios';
import { SetUpSubmissionCredentials } from '../../../credentials/ios/actions/SetUpSubmissionCredentials';
import { AppQuery } from '../../../graphql/queries/AppQuery';
import { createTestProject } from '../../../project/__tests__/project-utils';
import { getBundleIdentifierAsync } from '../../../project/ios/bundleIdentifier';
import { promptAsync } from '../../../prompts';
import { createSubmissionContextAsync } from '../../context';
import {
  CREDENTIALS_SERVICE_SOURCE,
  getFromCredentialsServiceAsync,
} from '../CredentialsServiceSource';

jest.mock('fs');
jest.mock('../../../prompts');
jest.mock('../../../credentials/utils/promptForCredentials');
jest.mock('../../../user/User', () => ({
  getUserAsync: jest.fn(() => mockJester),
}));
jest.mock('../../../project/ios/bundleIdentifier');
jest.mock('../../../graphql/queries/AppQuery');

const testProject = createTestProject(testProjectId, mockJester.accounts[0].name, {
  android: {
    package: 'com.expo.test.project',
  },
});
const projectId = uuidv4();

beforeEach(() => {
  jest.restoreAllMocks();
});

describe(getFromCredentialsServiceAsync, () => {
  beforeEach(() => {
    jest.mocked(AppQuery.byIdAsync).mockResolvedValue(testAppQueryByIdResponse);
  });

  it('returns an App Specific Password from the credentialService source', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
    const ctx = await createSubmissionContextAsync({
      platform: Platform.IOS,
      projectDir: testProject.projectRoot,
      archiveFlags: {
        url: 'http://expo.dev/fake.apk',
      },
      profile: {
        language: 'en-US',
      },
      nonInteractive: false,
      actor: mockJester,
      graphqlClient,
      exp: testProject.appJSON.expo,
      projectId,
    });
    jest
      .spyOn(SetUpSubmissionCredentials.prototype, 'runAsync')
      .mockImplementation(async _ctx => 'super secret');
    jest.mocked(getBundleIdentifierAsync).mockImplementation(async () => 'com.hello.world');
    jest.mocked(promptAsync).mockImplementationOnce(async () => ({ appleId: 'quin@expo.io' }));

    const result = await getFromCredentialsServiceAsync(ctx, {
      sourceType: CREDENTIALS_SERVICE_SOURCE,
      bundleIdentifier: 'com.expo.test.project',
    });
    expect(result).toEqual({
      appSpecificPassword: { password: 'super secret', appleIdUsername: 'quin@expo.io' },
    });
  });
  it('returns an ASC API Key from the credentialService source', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());
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
      actor: mockJester,
      graphqlClient,
      exp: testProject.appJSON.expo,
      projectId,
    });
    jest
      .spyOn(SetUpSubmissionCredentials.prototype, 'runAsync')
      .mockImplementation(async _ctx => testCommonIosAppCredentialsFragment);
    jest.mocked(getBundleIdentifierAsync).mockImplementation(async () => 'com.hello.world');

    const result = await getFromCredentialsServiceAsync(ctx, {
      sourceType: CREDENTIALS_SERVICE_SOURCE,
      bundleIdentifier: 'com.expo.test.project',
    });
    expect(result).toEqual({
      ascApiKeyResult: {
        result: {
          ascApiKeyId: testCommonIosAppCredentialsFragment.appStoreConnectApiKeyForSubmissions?.id,
        },
        summary: {
          keyId:
            testCommonIosAppCredentialsFragment.appStoreConnectApiKeyForSubmissions?.keyIdentifier,
          name: testCommonIosAppCredentialsFragment.appStoreConnectApiKeyForSubmissions?.name,
          source: 'EAS servers',
        },
      },
    });
  });
});
