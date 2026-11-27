import { Ios } from '@expo/eas-build-job';
import { Client } from '@urql/core';

import { createTestProvisioningProfileBase64 } from '../../../../../__tests__/utils/provisioningProfile';
import { resolveStoredIosBuildCredentialsAsync } from '../storedCredentials';
import {
  IosDistributionType,
  readStoredIosAppCredentialsAsync,
  readStoredIosBuildCredentialsAsync,
} from '../storedCredentialsQueries';

jest.mock('../storedCredentialsQueries');

const APP_ID = 'app-id';
const TARGETS = [
  { name: 'NativeApp', bundleIdentifier: 'dev.expo.nativeapp' },
  { name: 'Widget', bundleIdentifier: 'dev.expo.nativeapp.widget' },
];
const graphqlClient = {} as Client;

const DISTRIBUTION_CERTIFICATE = { dataBase64: 'Y2VydGlmaWNhdGU=', password: 'password' };

function createTargetCredentials(
  bundleIdentifier: string,
  type: IosDistributionType
): Ios.TargetCredentials {
  return {
    provisioningProfileBase64: createTestProvisioningProfileBase64({
      bundleIdentifierPattern: bundleIdentifier,
      type,
    }),
    distributionCertificate: DISTRIBUTION_CERTIFICATE,
  };
}

function mockStoredCredentials(
  iosDistributionTypes: IosDistributionType[],
  targetCredentialsByBundleIdentifier: Record<string, Ios.TargetCredentials>
): void {
  const storedAppCredentials = Object.keys(targetCredentialsByBundleIdentifier).map(
    bundleIdentifier => ({
      appleAppIdentifierId: `id-of-${bundleIdentifier}`,
      bundleIdentifier,
      iosDistributionTypes,
    })
  );
  jest.mocked(readStoredIosAppCredentialsAsync).mockResolvedValue(storedAppCredentials);
  jest
    .mocked(readStoredIosBuildCredentialsAsync)
    .mockImplementation(async (_graphqlClient, { appleAppIdentifierId }) => {
      const { bundleIdentifier } = storedAppCredentials.find(
        stored => stored.appleAppIdentifierId === appleAppIdentifierId
      )!;
      const { provisioningProfileBase64, distributionCertificate } =
        targetCredentialsByBundleIdentifier[bundleIdentifier];
      return {
        provisioningProfileBase64,
        distributionCertificate: {
          ...distributionCertificate,
          validityNotBefore: new Date('2000-01-01T00:00:00.000Z'),
          validityNotAfter: new Date('2100-01-01T00:00:00.000Z'),
        },
      };
    });
}

describe(resolveStoredIosBuildCredentialsAsync, () => {
  it('returns for each target the stored credentials of its bundle identifier, of the type that the distribution needs', async () => {
    const appCredentials = createTargetCredentials('dev.expo.nativeapp', 'APP_STORE');
    const widgetCredentials = createTargetCredentials('dev.expo.nativeapp.widget', 'APP_STORE');
    mockStoredCredentials(['APP_STORE', 'AD_HOC'], {
      'dev.expo.nativeapp': appCredentials,
      'dev.expo.nativeapp.widget': widgetCredentials,
    });

    await expect(
      resolveStoredIosBuildCredentialsAsync(graphqlClient, {
        appId: APP_ID,
        targets: TARGETS,
        distribution: 'store',
      })
    ).resolves.toEqual({ NativeApp: appCredentials, Widget: widgetCredentials });

    expect(readStoredIosAppCredentialsAsync).toHaveBeenCalledWith(graphqlClient, { appId: APP_ID });
    expect(jest.mocked(readStoredIosBuildCredentialsAsync).mock.calls).toEqual([
      [
        graphqlClient,
        {
          appId: APP_ID,
          appleAppIdentifierId: 'id-of-dev.expo.nativeapp',
          iosDistributionType: 'APP_STORE',
        },
      ],
      [
        graphqlClient,
        {
          appId: APP_ID,
          appleAppIdentifierId: 'id-of-dev.expo.nativeapp.widget',
          iosDistributionType: 'APP_STORE',
        },
      ],
    ]);
  });

  it('fails before it reads a certificate or a profile when a target has no stored credentials', async () => {
    mockStoredCredentials(['APP_STORE'], {
      'dev.expo.nativeapp': createTargetCredentials('dev.expo.nativeapp', 'APP_STORE'),
    });

    await expect(
      resolveStoredIosBuildCredentialsAsync(graphqlClient, {
        appId: APP_ID,
        targets: TARGETS,
        distribution: 'store',
      })
    ).rejects.toMatchObject({
      errorCode: 'NATIVE_IOS_CREDENTIALS_NOT_USABLE',
      message: expect.stringContaining(
        'No App Store credentials are stored for the bundle identifier "dev.expo.nativeapp.widget" (target "Widget")'
      ),
    });
    expect(readStoredIosBuildCredentialsAsync).not.toHaveBeenCalled();
  });

  it('checks the provisioning profile against the distribution of the build, not against the type of the record', async () => {
    const appCredentials = createTargetCredentials('dev.expo.nativeapp', 'DEVELOPMENT');
    mockStoredCredentials(['AD_HOC'], { 'dev.expo.nativeapp': appCredentials });

    await expect(
      resolveStoredIosBuildCredentialsAsync(graphqlClient, {
        appId: APP_ID,
        targets: [TARGETS[0]],
        distribution: 'internal',
      })
    ).resolves.toEqual({ NativeApp: appCredentials });
    await expect(
      resolveStoredIosBuildCredentialsAsync(graphqlClient, {
        appId: APP_ID,
        targets: [TARGETS[0]],
        distribution: 'internal',
        enterpriseProvisioning: 'adhoc',
      })
    ).rejects.toMatchObject({
      errorCode: 'NATIVE_IOS_CREDENTIALS_NOT_USABLE',
      message: expect.stringContaining(
        'has the type "development". A build with distribution "internal" and enterprise_provisioning "adhoc" cannot use a provisioning profile of that type.'
      ),
    });
  });

  it('compares the expiry of the stored credentials with the current time', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-24T12:00:00.000Z') });
    try {
      mockStoredCredentials(['APP_STORE'], {
        'dev.expo.nativeapp': {
          ...createTargetCredentials('dev.expo.nativeapp', 'APP_STORE'),
          provisioningProfileBase64: createTestProvisioningProfileBase64({
            bundleIdentifierPattern: 'dev.expo.nativeapp',
            expirationDate: new Date('2026-11-24T12:00:00.000Z'),
          }),
        },
      });

      await expect(
        resolveStoredIosBuildCredentialsAsync(graphqlClient, {
          appId: APP_ID,
          targets: [TARGETS[0]],
          distribution: 'store',
        })
      ).rejects.toMatchObject({
        errorCode: 'NATIVE_IOS_CREDENTIALS_NOT_USABLE',
        message: expect.stringContaining('expired on 11/24/2026, 12:00:00 PM UTC'),
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
