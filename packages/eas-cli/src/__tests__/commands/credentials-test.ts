import Credentials from '../../commands/credentials';
import * as AndroidGraphqlClient from '../../credentials/android/api/GraphqlClient';
import { getAppLookupParamsFromContextAsync } from '../../credentials/android/actions/BuildCredentialsUtils';
import { testJksAndroidKeystoreFragment } from '../../credentials/__tests__/fixtures-android';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import { getMockEasJson, getMockExpoConfig, mockCommandContext, mockTestCommand } from './utils';

jest.mock('fs');
jest.mock('../../credentials/android/api/GraphqlClient');
jest.mock('../../credentials/android/actions/BuildCredentialsUtils');
jest.mock('../../utils/json');

describe(Credentials, () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('--json --non-interactive --platform android', () => {
    const expWithAndroidPackage = {
      ...getMockExpoConfig(),
      android: { package: 'com.eas.test' },
    };

    test('outputs keystore info as JSON when credentials exist', async () => {
      const ctx = mockCommandContext(Credentials, {
        easJson: getMockEasJson(),
        exp: expWithAndroidPackage,
      });
      jest.mocked(getAppLookupParamsFromContextAsync).mockResolvedValue({
        account: { id: 'account-id', name: 'testuser' } as any,
        projectName: 'testapp',
        androidApplicationIdentifier: 'com.eas.test',
      });
      jest.mocked(AndroidGraphqlClient.getDefaultAndroidAppBuildCredentialsAsync).mockResolvedValue({
        id: 'build-creds-id',
        name: 'production',
        isDefault: true,
        isLegacy: false,
        androidKeystore: testJksAndroidKeystoreFragment,
      } as any);

      const cmd = mockTestCommand(Credentials, [
        '--json',
        '--non-interactive',
        '--platform',
        'android',
      ], ctx);
      await cmd.run();

      expect(enableJsonOutput).toHaveBeenCalled();
      expect(printJsonOnlyOutput).toHaveBeenCalledWith({
        keystore: {
          id: testJksAndroidKeystoreFragment.id,
          type: testJksAndroidKeystoreFragment.type,
          keyAlias: testJksAndroidKeystoreFragment.keyAlias,
          md5CertificateFingerprint: testJksAndroidKeystoreFragment.md5CertificateFingerprint,
          sha1CertificateFingerprint: testJksAndroidKeystoreFragment.sha1CertificateFingerprint,
          sha256CertificateFingerprint: testJksAndroidKeystoreFragment.sha256CertificateFingerprint,
          createdAt: testJksAndroidKeystoreFragment.createdAt,
          updatedAt: testJksAndroidKeystoreFragment.updatedAt,
        },
      });
    });

    test('outputs keystore null when no credentials exist', async () => {
      const ctx = mockCommandContext(Credentials, {
        easJson: getMockEasJson(),
        exp: expWithAndroidPackage,
      });
      jest.mocked(getAppLookupParamsFromContextAsync).mockResolvedValue({
        account: { id: 'account-id', name: 'testuser' } as any,
        projectName: 'testapp',
        androidApplicationIdentifier: 'com.eas.test',
      });
      jest.mocked(AndroidGraphqlClient.getDefaultAndroidAppBuildCredentialsAsync).mockResolvedValue(
        null
      );

      const cmd = mockTestCommand(Credentials, [
        '--json',
        '--non-interactive',
        '--platform',
        'android',
      ], ctx);
      await cmd.run();

      expect(enableJsonOutput).toHaveBeenCalled();
      expect(printJsonOnlyOutput).toHaveBeenCalledWith({ keystore: null });
    });

    test('outputs keystore null when build credentials exist but have no keystore', async () => {
      const ctx = mockCommandContext(Credentials, {
        easJson: getMockEasJson(),
        exp: expWithAndroidPackage,
      });
      jest.mocked(getAppLookupParamsFromContextAsync).mockResolvedValue({
        account: { id: 'account-id', name: 'testuser' } as any,
        projectName: 'testapp',
        androidApplicationIdentifier: 'com.eas.test',
      });
      jest.mocked(AndroidGraphqlClient.getDefaultAndroidAppBuildCredentialsAsync).mockResolvedValue({
        id: 'build-creds-id',
        name: 'production',
        isDefault: true,
        isLegacy: false,
        androidKeystore: null,
      } as any);

      const cmd = mockTestCommand(Credentials, [
        '--json',
        '--non-interactive',
        '--platform',
        'android',
      ], ctx);
      await cmd.run();

      expect(enableJsonOutput).toHaveBeenCalled();
      expect(printJsonOnlyOutput).toHaveBeenCalledWith({ keystore: null });
    });

    test('throws when no project directory', async () => {
      const ctx = mockCommandContext(Credentials, {
        easJson: getMockEasJson(),
        optionalPrivateProjectConfig: null,
      });

      const cmd = mockTestCommand(Credentials, [
        '--json',
        '--non-interactive',
        '--platform',
        'android',
      ], ctx);

      await expect(cmd.run()).rejects.toThrow(
        'Run this command from a project directory with app.json and eas.json to output Android keystore info as JSON.'
      );
      expect(printJsonOnlyOutput).not.toHaveBeenCalled();
    });
  });

});
