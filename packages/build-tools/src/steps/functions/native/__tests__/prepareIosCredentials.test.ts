import { Ios, UserError } from '@expo/eas-build-job';
import { Client } from '@urql/core';

import { createGlobalContextMock } from '../../../../__tests__/utils/context';
import { CustomBuildContext } from '../../../../customBuildContext';
import IosCredentialsManager from '../../../utils/ios/credentials/manager';
import { DistributionType } from '../../../utils/ios/credentials/provisioningProfile';
import { resolveStoredIosBuildCredentialsAsync } from '../../../utils/ios/credentials/storedCredentials';
import { createPrepareIosCredentialsBuildFunction } from '../prepareIosCredentials';

jest.mock('../../../utils/ios/credentials/manager');
jest.mock('../../../utils/ios/credentials/storedCredentials');

const TARGETS = [
  { id: 'APP', name: 'NativeApp', bundleIdentifier: 'dev.expo.nativeapp' },
  { id: 'WIDGET', name: 'Widget', bundleIdentifier: 'dev.expo.nativeapp.widget' },
];
const SIGNING_TARGETS = TARGETS.map(({ name, bundleIdentifier }) => ({ name, bundleIdentifier }));
const APP_ID = 'app-id';
const graphqlClient = {} as Client;

const DISTRIBUTION_CERTIFICATE = { dataBase64: 'Y2VydGlmaWNhdGU=', password: '' };
const BUILD_CREDENTIALS: Ios.BuildCredentials = {
  NativeApp: {
    provisioningProfileBase64: 'YXBwLXByb2ZpbGU=',
    distributionCertificate: DISTRIBUTION_CERTIFICATE,
  },
  Widget: {
    provisioningProfileBase64: 'd2lkZ2V0LXByb2ZpbGU=',
    distributionCertificate: DISTRIBUTION_CERTIFICATE,
  },
};

function createStep(
  callInputs: Record<string, unknown>
): ReturnType<
  ReturnType<typeof createPrepareIosCredentialsBuildFunction>['createBuildStepFromFunctionCall']
> {
  return createPrepareIosCredentialsBuildFunction({
    graphqlClient,
  } as CustomBuildContext<Ios.Job>).createBuildStepFromFunctionCall(
    createGlobalContextMock({ staticContextContent: { job: { appId: APP_ID } } }),
    { callInputs }
  );
}

beforeEach(() => {
  jest.mocked(resolveStoredIosBuildCredentialsAsync).mockResolvedValue(BUILD_CREDENTIALS);
});

describe(createPrepareIosCredentialsBuildFunction, () => {
  it('installs the stored credentials of every target and describes what it installed', async () => {
    jest.mocked(IosCredentialsManager.prototype.prepare).mockResolvedValue({
      keychainPath: '/keychains/build.keychain',
      distributionType: DistributionType.APP_STORE,
      teamId: 'ABCDE12345',
      targetProvisioningProfiles: {
        NativeApp: {
          name: 'App Profile',
          uuid: 'app-uuid',
          path: '/profiles/app-uuid.mobileprovision',
          teamId: 'ABCDE12345',
          certificateCommonName: 'iPhone Distribution: Example (ABCDE12345)',
          developerCertificate: Buffer.from('certificate'),
        },
        Widget: {
          name: 'Widget Profile',
          uuid: 'widget-uuid',
          path: '/profiles/widget-uuid.mobileprovision',
          teamId: 'ABCDE12345',
          certificateCommonName: 'iPhone Distribution: Example (ABCDE12345)',
          developerCertificate: Buffer.from('certificate'),
        },
      },
    } as any);
    const step = createStep({ targets: TARGETS, distribution: 'store' });

    await step.executeAsync();

    expect(resolveStoredIosBuildCredentialsAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: APP_ID,
      targets: SIGNING_TARGETS,
      distribution: 'store',
      enterpriseProvisioning: undefined,
    });
    expect(IosCredentialsManager).toHaveBeenCalledWith(BUILD_CREDENTIALS);
    expect(JSON.parse(step.outputById.installed_credentials.value as string)).toEqual({
      keychainPath: '/keychains/build.keychain',
      distributionType: 'app-store',
      profileByTargetName: {
        NativeApp: {
          bundleIdentifier: 'dev.expo.nativeapp',
          profileName: 'App Profile',
          profileUuid: 'app-uuid',
          teamId: 'ABCDE12345',
          certificateCommonName: 'iPhone Distribution: Example (ABCDE12345)',
        },
        Widget: {
          bundleIdentifier: 'dev.expo.nativeapp.widget',
          profileName: 'Widget Profile',
          profileUuid: 'widget-uuid',
          teamId: 'ABCDE12345',
          certificateCommonName: 'iPhone Distribution: Example (ABCDE12345)',
        },
      },
    });
  });

  it('asks for the credentials of the distribution and the enterprise provisioning of its inputs', async () => {
    jest.mocked(IosCredentialsManager.prototype.prepare).mockResolvedValue({
      keychainPath: '/keychains/build.keychain',
      distributionType: DistributionType.ENTERPRISE,
      teamId: 'ABCDE12345',
      targetProvisioningProfiles: { NativeApp: {} },
    } as any);
    const step = createStep({
      targets: [TARGETS[0]],
      distribution: 'internal',
      enterprise_provisioning: 'universal',
    });

    await step.executeAsync();

    expect(resolveStoredIosBuildCredentialsAsync).toHaveBeenCalledWith(graphqlClient, {
      appId: APP_ID,
      targets: [SIGNING_TARGETS[0]],
      distribution: 'internal',
      enterpriseProvisioning: 'universal',
    });
  });

  it('fails before it prepares the keychain when the stored credentials are not usable', async () => {
    const credentialsError = new UserError(
      'NATIVE_IOS_CREDENTIALS_NOT_USABLE',
      'No App Store credentials are stored for the bundle identifier "dev.expo.nativeapp.widget" (target "Widget").'
    );
    jest.mocked(resolveStoredIosBuildCredentialsAsync).mockRejectedValue(credentialsError);
    const step = createStep({ targets: TARGETS, distribution: 'store' });

    await expect(step.executeAsync()).rejects.toBe(credentialsError);
    expect(IosCredentialsManager).not.toHaveBeenCalled();
  });

  it('rejects a targets input that names no bundle identifier', async () => {
    const step = createStep({ targets: [{ name: 'NativeApp' }], distribution: 'store' });

    await expect(step.executeAsync()).rejects.toThrow(/bundleIdentifier/);
    expect(resolveStoredIosBuildCredentialsAsync).not.toHaveBeenCalled();
  });
});
