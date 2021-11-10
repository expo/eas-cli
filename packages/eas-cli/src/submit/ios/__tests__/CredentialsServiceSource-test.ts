import { Platform } from '@expo/eas-build-job';
import { v4 as uuidv4 } from 'uuid';

import { asMock } from '../../../__tests__/utils';
import { jester as mockJester } from '../../../credentials/__tests__/fixtures-constants';
import { testCommonIosAppCredentialsFragment } from '../../../credentials/__tests__/fixtures-ios';
import { SetUpSubmissionCredentials } from '../../../credentials/ios/actions/SetUpSubmissionCredentials';
import { createTestProject } from '../../../project/__tests__/project-utils';
import { getBundleIdentifierAsync } from '../../../project/ios/bundleIdentifier';
import { promptAsync } from '../../../prompts';
import { createSubmissionContextAsync } from '../../context';
import { getFromCredentialsServiceAsync } from '../CredentialsServiceSource';

jest.mock('fs');
jest.mock('../../../prompts');
jest.mock('../../../credentials/utils/promptForCredentials');
jest.mock('../../../user/User', () => ({
  getUserAsync: jest.fn(() => mockJester),
}));
jest.mock('../../../user/Account', () => ({
  findAccountByName: jest.fn(() => mockJester.accounts[0]),
}));
jest.mock('../../../project/ios/bundleIdentifier');

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

beforeEach(() => {
  jest.restoreAllMocks();
});

describe(getFromCredentialsServiceAsync, () => {
  it('returns an App Specific Password from the credentialService source', async () => {
    const ctx = await createSubmissionContextAsync({
      platform: Platform.IOS,
      projectDir: testProject.projectRoot,
      projectId,
      archiveFlags: {
        url: 'http://expo.dev/fake.apk',
      },
      profile: {
        language: 'en-US',
      },
      nonInteractive: false,
    });
    jest
      .spyOn(SetUpSubmissionCredentials.prototype, 'runAsync')
      .mockImplementation(async _ctx => 'super secret');
    asMock(getBundleIdentifierAsync).mockImplementation(() => 'com.hello.world');
    asMock(promptAsync).mockImplementationOnce(() => ({ appleId: 'quin@expo.io' }));

    const result = await getFromCredentialsServiceAsync(ctx);
    expect(result).toEqual({
      appSpecificPassword: { password: 'super secret', appleIdUsername: 'quin@expo.io' },
    });
  });
  it('returns an ASC API Key from the credentialService source', async () => {
    const ctx = await createSubmissionContextAsync({
      platform: Platform.IOS,
      projectDir: testProject.projectRoot,
      projectId,
      archiveFlags: {
        url: 'http://expo.dev/fake.apk',
      },
      profile: {
        language: 'en-US',
      },
      nonInteractive: true,
    });
    jest
      .spyOn(SetUpSubmissionCredentials.prototype, 'runAsync')
      .mockImplementation(async _ctx => testCommonIosAppCredentialsFragment);
    asMock(getBundleIdentifierAsync).mockImplementation(() => 'com.hello.world');

    const result = await getFromCredentialsServiceAsync(ctx);
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
