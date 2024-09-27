import { Env } from '@expo/eas-build-job';
import { EasJson } from '@expo/eas-json';

import { Analytics } from '../../../../analytics/AnalyticsManager';
import { ExpoGraphqlClient } from '../../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  Account,
  AppleAppIdentifierFragment,
  AppleDevice,
  AppleDeviceClass,
  AppleDeviceFragment,
  AppleDistributionCertificateFragment,
  IosAppBuildCredentialsFragment,
} from '../../../../graphql/generated';
import Log from '../../../../log';
import { getApplePlatformFromTarget } from '../../../../project/ios/target';
import { selectAsync } from '../../../../prompts';
import { Actor } from '../../../../user/User';
import { Client } from '../../../../vcs/vcs';
import { CredentialsContext, CredentialsContextProjectInfo } from '../../../context';
import { ProvisioningProfile } from '../../appstore/Credentials.types';
import { ApplePlatform } from '../../appstore/constants';
import { assignBuildCredentialsAsync, getBuildCredentialsAsync } from '../BuildCredentialsUtils';
import { chooseDevicesAsync } from '../DeviceUtils';
import { SetUpAdhocProvisioningProfile, doUDIDsMatch } from '../SetUpAdhocProvisioningProfile';

jest.mock('../BuildCredentialsUtils');
jest.mock('../../../context');
jest.mock('../../../ios/api/GraphqlClient');
jest.mock('../DeviceUtils', () => {
  return {
    __esModule: true,
    chooseDevicesAsync: jest.fn(),
    formatDeviceLabel: jest.requireActual('../DeviceUtils').formatDeviceLabel,
  };
});
jest.mock('../../../../project/ios/target');
jest.mock('../../../../prompts');

describe(doUDIDsMatch, () => {
  it('return false if UDIDs do not match', () => {
    const udidsA: string[] = ['00001111-001122334455662E', '11110000-771122334455662E'];
    const udidsB: string[] = ['34330000-771122334455662E', '00001111-001122334455662E'];
    expect(doUDIDsMatch(udidsA, udidsB)).toBe(false);
  });
  it('return true if UDIDs match', () => {
    const udidsA: string[] = ['00001111-001122334455662E', '11110000-771122334455662E'];
    const udidsB: string[] = ['11110000-771122334455662E', '00001111-001122334455662E'];
    expect(doUDIDsMatch(udidsA, udidsB)).toBe(true);
  });
});
describe('runWithDistributionCertificateAsync', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });
  const setUpAdhocProvisioningProfile = new SetUpAdhocProvisioningProfile({
    app: { account: {} as Account, projectName: 'projName', bundleIdentifier: 'bundleId' },
    target: { targetName: 'targetName', bundleIdentifier: 'bundleId', entitlements: {} },
  });
  describe('compare chosen and provisioned devices', () => {
    describe('not all devices provisioned', () => {
      describe('still not provisioned after an update', () => {
        it('displays warning to the user and lists the missing devices', async () => {
          const { ctx, distCert } = setUpTest();
          jest.mocked(getBuildCredentialsAsync).mockResolvedValue({
            provisioningProfile: {
              appleTeam: {},
              appleDevices: [{ identifier: 'id1' }],
              developerPortalIdentifier: 'provisioningProfileId',
            },
          } as IosAppBuildCredentialsFragment);
          jest.mocked(selectAsync).mockImplementation(async () => true);
          ctx.ios.updateProvisioningProfileAsync = jest.fn().mockResolvedValue({
            appleTeam: {},
            appleDevices: [{ identifier: 'id1' }],
            developerPortalIdentifier: 'provisioningProfileId',
          });
          const LogWarnSpy = jest.spyOn(Log, 'warn');
          const LogLogSpy = jest.spyOn(Log, 'log');
          const result = await setUpAdhocProvisioningProfile.runWithDistributionCertificateAsync(
            ctx,
            distCert
          );
          expect(result).toEqual({} as IosAppBuildCredentialsFragment);
          expect(LogWarnSpy).toHaveBeenCalledTimes(3);
          expect(LogWarnSpy).toHaveBeenCalledWith('Failed to provision 2 of the selected devices:');
          expect(LogWarnSpy).toHaveBeenCalledWith('- id2 (iPhone) (Device 2)');
          expect(LogWarnSpy).toHaveBeenCalledWith('- id3 (Mac) (Device 3)');
          expect(LogLogSpy).toHaveBeenCalledTimes(1);
          expect(LogLogSpy).toHaveBeenCalledWith(
            'Most commonly devices fail to to be provisioned while they are still being processed by Apple, which can take up to 24-72 hours. Check your Apple Developer Portal page at https://developer.apple.com/account/resources/devices/list, the devices in "Processing" status cannot be provisioned yet'
          );
        });
      });
      describe('all devices provisioned after an update', () => {
        it('does not display warning', async () => {
          const { ctx, distCert } = setUpTest();
          jest.mocked(getBuildCredentialsAsync).mockResolvedValue({
            provisioningProfile: {
              appleTeam: {},
              appleDevices: [{ identifier: 'id1' }],
              developerPortalIdentifier: 'provisioningProfileId',
            },
          } as IosAppBuildCredentialsFragment);
          ctx.ios.updateProvisioningProfileAsync = jest.fn().mockResolvedValue({
            appleTeam: {},
            appleDevices: [{ identifier: 'id1' }, { identifier: 'id2' }, { identifier: 'id3' }],
            developerPortalIdentifier: 'provisioningProfileId',
          });
          const LogWarnSpy = jest.spyOn(Log, 'warn');
          const LogLogSpy = jest.spyOn(Log, 'log');
          const result = await setUpAdhocProvisioningProfile.runWithDistributionCertificateAsync(
            ctx,
            distCert
          );
          expect(result).toEqual({} as IosAppBuildCredentialsFragment);
          expect(LogWarnSpy).not.toHaveBeenCalled();
          expect(LogLogSpy).not.toHaveBeenCalled();
        });
      });
    });
    describe('all devices provisioned', () => {
      it('does not display warning', async () => {
        const { ctx, distCert } = setUpTest();
        jest.mocked(getBuildCredentialsAsync).mockResolvedValue({
          provisioningProfile: {
            appleTeam: {},
            appleDevices: [{ identifier: 'id1' }, { identifier: 'id2' }, { identifier: 'id3' }],
            developerPortalIdentifier: 'provisioningProfileId',
          },
        } as IosAppBuildCredentialsFragment);
        ctx.ios.updateProvisioningProfileAsync = jest.fn().mockResolvedValue({
          appleTeam: {},
          appleDevices: [{ identifier: 'id1' }, { identifier: 'id2' }, { identifier: 'id3' }],
          developerPortalIdentifier: 'provisioningProfileId',
        });
        const LogWarnSpy = jest.spyOn(Log, 'warn');
        const LogLogSpy = jest.spyOn(Log, 'log');
        const result = await setUpAdhocProvisioningProfile.runWithDistributionCertificateAsync(
          ctx,
          distCert
        );
        expect(result).toEqual({} as IosAppBuildCredentialsFragment);
        expect(LogWarnSpy).not.toHaveBeenCalled();
        expect(LogLogSpy).not.toHaveBeenCalled();
      });
    });
  });
});

function setUpTest(): { ctx: CredentialsContext; distCert: AppleDistributionCertificateFragment } {
  const ctx = jest.mocked(
    new CredentialsContext(
      {} as {
        projectInfo: CredentialsContextProjectInfo | null;
        easJsonCliConfig?: EasJson['cli'];
        nonInteractive: boolean;
        projectDir: string;
        user: Actor;
        graphqlClient: ExpoGraphqlClient;
        analytics: Analytics;
        env?: Env;
        vcsClient: Client;
      }
    )
  );
  Object.defineProperty(ctx, 'ios', { value: jest.mock('../../../ios/api/GraphqlClient') });
  ctx.ios.getDevicesForAppleTeamAsync = jest
    .fn()
    .mockResolvedValue([
      { identifier: 'id1' },
      { identifier: 'id2' },
      { identifier: 'id3' },
    ] as AppleDeviceFragment[]);
  jest.mocked(chooseDevicesAsync).mockResolvedValue([
    { identifier: 'id1', name: 'Device 1', deviceClass: AppleDeviceClass.Ipad },
    { identifier: 'id2', name: 'Device 2', deviceClass: AppleDeviceClass.Iphone },
    { identifier: 'id3', name: 'Device 3', deviceClass: AppleDeviceClass.Mac },
  ] as AppleDevice[]);
  // @ts-expect-error
  jest.mocked(getApplePlatformFromTarget).mockResolvedValue(ApplePlatform.IOS);
  Object.defineProperty(ctx, 'appStore', { value: jest.mock('../../appstore/AppStoreApi') });
  ctx.appStore.createOrReuseAdhocProvisioningProfileAsync = jest.fn().mockResolvedValue({
    provisioningProfileId: 'provisioningProfileId',
  } as ProvisioningProfile);
  ctx.ios.createOrGetExistingAppleAppIdentifierAsync = jest
    .fn()
    .mockResolvedValue({} as AppleAppIdentifierFragment);
  jest.mocked(assignBuildCredentialsAsync).mockResolvedValue({} as IosAppBuildCredentialsFragment);
  const distCert = {} as AppleDistributionCertificateFragment;
  return { ctx, distCert };
}
