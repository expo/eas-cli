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
import { getAscApiKeyForAppSubmissionsAsync } from '../../api/GraphqlClient';
import { AuthenticationMode, AppleTeamType } from '../../appstore/authenticateTypes';
import { hasAscEnvVars } from '../../appstore/resolveCredentials';
import { AppStoreConnectApiKeyQuery } from '../../../../graphql/queries/AppStoreConnectApiKeyQuery';

jest.mock('../BuildCredentialsUtils');
jest.mock('../../../context');
jest.mock('../../../ios/api/GraphqlClient', () => ({
  ...jest.requireActual('../../../ios/api/GraphqlClient'),
  getAscApiKeyForAppSubmissionsAsync: jest.fn(),
}));
jest.mock('../../appstore/resolveCredentials', () => ({
  hasAscEnvVars: jest.fn(),
}));
jest.mock('../../../../graphql/queries/AppStoreConnectApiKeyQuery', () => ({
  AppStoreConnectApiKeyQuery: {
    getByIdAsync: jest.fn(),
  },
}));
jest.mock('../DeviceUtils', () => {
  return {
    __esModule: true,
    chooseDevicesAsync: jest.fn(),
    formatDeviceLabel: jest.requireActual('../DeviceUtils').formatDeviceLabel,
  };
});
jest.mock('../SetUpDistributionCertificate', () => ({
  SetUpDistributionCertificate: jest.fn(),
}));
import { SetUpDistributionCertificate } from '../SetUpDistributionCertificate';
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

describe('runAsync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    jest.mocked(SetUpDistributionCertificate).mockImplementation(
      () =>
        ({
          runAsync: jest.fn().mockResolvedValue({} as AppleDistributionCertificateFragment),
        }) as any
    );
  });

  const setUpAdhocProvisioningProfile = new SetUpAdhocProvisioningProfile({
    app: { account: {} as Account, projectName: 'projName', bundleIdentifier: 'bundleId' },
    target: { targetName: 'targetName', bundleIdentifier: 'bundleId', entitlements: {} },
  });

  it('skips non-interactive reuse when refresh is enabled', async () => {
    const { ctx } = setUpTest();
    Object.defineProperty(ctx, 'nonInteractive', { value: true });
    Object.defineProperty(ctx, 'refreshAdHocProvisioningProfile', { value: true });
    const areBuildCredentialsSetupAsyncSpy = jest
      .spyOn(SetUpAdhocProvisioningProfile.prototype as any, 'areBuildCredentialsSetupAsync')
      .mockResolvedValue(true);
    const ensureAppStoreAuthenticatedForAdhocRefreshAsyncSpy = jest
      .spyOn(
        SetUpAdhocProvisioningProfile.prototype as any,
        'ensureAppStoreAuthenticatedForAdhocRefreshAsync'
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(SetUpAdhocProvisioningProfile.prototype, 'runWithDistributionCertificateAsync')
      .mockResolvedValue({} as IosAppBuildCredentialsFragment);

    await setUpAdhocProvisioningProfile.runAsync(ctx);

    expect(areBuildCredentialsSetupAsyncSpy).not.toHaveBeenCalled();
    expect(ensureAppStoreAuthenticatedForAdhocRefreshAsyncSpy).toHaveBeenCalledWith(ctx, {
      account: {} as Account,
      projectName: 'projName',
      bundleIdentifier: 'bundleId',
    });
    expect(
      SetUpAdhocProvisioningProfile.prototype.runWithDistributionCertificateAsync
    ).toHaveBeenCalled();
    expect(getBuildCredentialsAsync).not.toHaveBeenCalled();
  });

  it('fails when refresh is enabled and credentials are frozen', async () => {
    const { ctx } = setUpTest();
    Object.defineProperty(ctx, 'nonInteractive', { value: true });
    Object.defineProperty(ctx, 'refreshAdHocProvisioningProfile', { value: true });
    Object.defineProperty(ctx, 'freezeCredentials', { value: true });

    await expect(setUpAdhocProvisioningProfile.runAsync(ctx)).rejects.toThrow(
      'Cannot refresh ad-hoc provisioning profile when credentials are frozen'
    );
  });
});

describe('refresh ad-hoc provisioning profile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    jest.mocked(SetUpDistributionCertificate).mockImplementation(
      () =>
        ({
          runAsync: jest.fn().mockResolvedValue({} as AppleDistributionCertificateFragment),
        }) as any
    );
    jest.mocked(hasAscEnvVars).mockReturnValue(false);
    jest.mocked(getAscApiKeyForAppSubmissionsAsync).mockResolvedValue(null);
  });

  const setUpAdhocProvisioningProfile = new SetUpAdhocProvisioningProfile({
    app: { account: {} as Account, projectName: 'projName', bundleIdentifier: 'bundleId' },
    target: { targetName: 'targetName', bundleIdentifier: 'bundleId', entitlements: {} },
  });

  it('provisions all registered devices without prompting in refresh mode', async () => {
    const { ctx, distCert } = setUpRefreshTest();
    Object.defineProperty(ctx, 'nonInteractive', { value: true });
    Object.defineProperty(ctx, 'refreshAdHocProvisioningProfile', { value: true });

    await setUpAdhocProvisioningProfile.runWithDistributionCertificateAsync(ctx, distCert);

    expect(chooseDevicesAsync).not.toHaveBeenCalled();
    expect(ctx.appStore.createOrReuseAdhocProvisioningProfileAsync).toHaveBeenCalledWith(
      ['id1', 'id2', 'id3'],
      'bundleId',
      distCert.serialNumber,
      expect.anything()
    );
  });

  it('continues without prompting when some devices are not provisioned in refresh mode', async () => {
    const { ctx, distCert } = setUpRefreshTest();
    Object.defineProperty(ctx, 'nonInteractive', { value: true });
    Object.defineProperty(ctx, 'refreshAdHocProvisioningProfile', { value: true });
    jest.mocked(getBuildCredentialsAsync).mockResolvedValue({
      provisioningProfile: {
        appleTeam: { appleTeamIdentifier: 'team' },
        appleDevices: [{ identifier: 'id1' }],
        developerPortalIdentifier: 'provisioningProfileId',
      },
    } as IosAppBuildCredentialsFragment);
    ctx.ios.updateProvisioningProfileAsync = jest.fn().mockResolvedValue({
      appleTeam: { appleTeamIdentifier: 'team' },
      appleDevices: [{ identifier: 'id1' }],
      developerPortalIdentifier: 'provisioningProfileId',
    });

    await setUpAdhocProvisioningProfile.runWithDistributionCertificateAsync(ctx, distCert);

    expect(selectAsync).not.toHaveBeenCalled();
    expect(assignBuildCredentialsAsync).toHaveBeenCalled();
  });

  it('errors when no devices are registered in refresh mode', async () => {
    const { ctx, distCert } = setUpRefreshTest();
    Object.defineProperty(ctx, 'nonInteractive', { value: true });
    Object.defineProperty(ctx, 'refreshAdHocProvisioningProfile', { value: true });
    ctx.ios.getDevicesForAppleTeamAsync = jest.fn().mockResolvedValue([]);

    await expect(
      setUpAdhocProvisioningProfile.runWithDistributionCertificateAsync(ctx, distCert)
    ).rejects.toThrow(
      'No devices are registered for this Apple team. Register devices with eas device:create before refreshing ad-hoc provisioning profile.'
    );
  });

  describe('ensureAppStoreAuthenticatedForAdhocRefreshAsync', () => {
    it('authenticates with ASC environment variables when present', async () => {
      const { ctx } = setUpRefreshTest();
      jest.mocked(hasAscEnvVars).mockReturnValue(true);
      jest
        .spyOn(SetUpAdhocProvisioningProfile.prototype, 'runWithDistributionCertificateAsync')
        .mockResolvedValue({} as IosAppBuildCredentialsFragment);

      await setUpAdhocProvisioningProfile.runAsync(ctx);

      expect(ctx.appStore.ensureAuthenticatedAsync).toHaveBeenCalledWith({
        mode: AuthenticationMode.API_KEY,
      });
      expect(getAscApiKeyForAppSubmissionsAsync).not.toHaveBeenCalled();
    });

    it('authenticates with the stored submissions ASC API key when env vars are absent', async () => {
      const { ctx } = setUpRefreshTest();
      jest.mocked(hasAscEnvVars).mockReturnValue(false);
      jest.mocked(getAscApiKeyForAppSubmissionsAsync).mockResolvedValue({
        id: 'asc-key-id',
        appleTeam: {
          appleTeamIdentifier: 'TEAM123',
          appleTeamName: 'Team Name',
        },
      } as any);
      jest.mocked(AppStoreConnectApiKeyQuery.getByIdAsync).mockResolvedValue({
        keyP8: 'key-p8',
        keyIdentifier: 'key-id',
        issuerIdentifier: 'issuer-id',
      } as any);
      jest
        .spyOn(SetUpAdhocProvisioningProfile.prototype, 'runWithDistributionCertificateAsync')
        .mockResolvedValue({} as IosAppBuildCredentialsFragment);

      await setUpAdhocProvisioningProfile.runAsync(ctx);

      expect(ctx.appStore.ensureAuthenticatedAsync).toHaveBeenCalledWith({
        mode: AuthenticationMode.API_KEY,
        ascApiKey: {
          keyP8: 'key-p8',
          keyId: 'key-id',
          issuerId: 'issuer-id',
        },
        teamId: 'TEAM123',
        teamName: 'Team Name',
        teamType: AppleTeamType.COMPANY_OR_ORGANIZATION,
      });
    });
  });
});

function setUpRefreshTest(): {
  ctx: CredentialsContext;
  distCert: AppleDistributionCertificateFragment;
} {
  const { ctx, distCert } = setUpTest();
  Object.defineProperty(ctx, 'nonInteractive', { value: true });
  Object.defineProperty(ctx, 'refreshAdHocProvisioningProfile', { value: true });
  distCert.appleTeam = {
    appleTeamIdentifier: 'team',
  } as AppleDistributionCertificateFragment['appleTeam'];
  distCert.serialNumber = 'serial-number';
  ctx.appStore.ensureAuthenticatedAsync = jest.fn().mockResolvedValue({});
  jest.mocked(getBuildCredentialsAsync).mockResolvedValue(null);
  return { ctx, distCert };
}

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
  ctx.ios.createProvisioningProfileAsync = jest.fn().mockResolvedValue({
    appleTeam: { appleTeamIdentifier: 'team' },
    appleDevices: [{ identifier: 'id1' }, { identifier: 'id2' }, { identifier: 'id3' }],
    developerPortalIdentifier: 'provisioningProfileId',
  });
  jest.mocked(assignBuildCredentialsAsync).mockResolvedValue({} as IosAppBuildCredentialsFragment);
  const distCert = {} as AppleDistributionCertificateFragment;
  return { ctx, distCert };
}
