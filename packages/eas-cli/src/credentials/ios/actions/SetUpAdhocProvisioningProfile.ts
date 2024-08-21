import { ProfileType } from '@expo/apple-utils';
import { Errors } from '@oclif/core';
import assert from 'assert';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

import { resolveAppleTeamIfAuthenticatedAsync } from './AppleTeamUtils';
import { assignBuildCredentialsAsync, getBuildCredentialsAsync } from './BuildCredentialsUtils';
import { chooseDevicesAsync, formatDeviceLabel } from './DeviceUtils';
import { SetUpDistributionCertificate } from './SetUpDistributionCertificate';
import DeviceCreateAction, { RegistrationMethod } from '../../../devices/actions/create/action';
import {
  AppleAppIdentifierFragment,
  AppleDeviceFragment,
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileFragment,
  AppleTeamFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../../graphql/generated';
import Log from '../../../log';
import { getApplePlatformFromTarget } from '../../../project/ios/target';
import {
  confirmAsync,
  pressAnyKeyToContinueAsync,
  promptAsync,
  selectAsync,
} from '../../../prompts';
import differenceBy from '../../../utils/expodash/differenceBy';
import { CredentialsContext } from '../../context';
import { MissingCredentialsNonInteractiveError } from '../../errors';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';
import { ProvisioningProfile } from '../appstore/Credentials.types';
import { ApplePlatform } from '../appstore/constants';
import { Target } from '../types';
import { validateProvisioningProfileAsync } from '../validators/validateProvisioningProfile';

enum ReuseAction {
  Yes,
  ShowDevices,
  No,
}

interface Options {
  app: AppLookupParams;
  target: Target;
}

export class SetUpAdhocProvisioningProfile {
  constructor(private readonly options: Options) {}

  async runAsync(ctx: CredentialsContext): Promise<IosAppBuildCredentialsFragment> {
    const { app } = this.options;
    const distCert = await new SetUpDistributionCertificate(
      app,
      IosDistributionType.AdHoc
    ).runAsync(ctx);

    const areBuildCredentialsSetup = await this.areBuildCredentialsSetupAsync(ctx);

    if (ctx.nonInteractive) {
      if (areBuildCredentialsSetup) {
        return nullthrows(await getBuildCredentialsAsync(ctx, app, IosDistributionType.AdHoc));
      } else {
        throw new MissingCredentialsNonInteractiveError(
          'Provisioning profile is not configured correctly. Run this command again in interactive mode.'
        );
      }
    }

    const currentBuildCredentials = await getBuildCredentialsAsync(
      ctx,
      app,
      IosDistributionType.AdHoc
    );
    if (areBuildCredentialsSetup) {
      const buildCredentials = nullthrows(currentBuildCredentials);
      if (await this.shouldUseExistingProfileAsync(ctx, buildCredentials)) {
        return buildCredentials;
      }
    }

    return await this.runWithDistributionCertificateAsync(ctx, distCert);
  }

  async runWithDistributionCertificateAsync(
    ctx: CredentialsContext,
    distCert: AppleDistributionCertificateFragment
  ): Promise<IosAppBuildCredentialsFragment> {
    const { app, target } = this.options;

    const currentBuildCredentials = await getBuildCredentialsAsync(
      ctx,
      app,
      IosDistributionType.AdHoc
    );

    // 1. Resolve Apple Team
    let appleTeam: AppleTeamFragment | null =
      distCert.appleTeam ?? currentBuildCredentials?.provisioningProfile?.appleTeam ?? null;
    if (!appleTeam) {
      await ctx.appStore.ensureAuthenticatedAsync();
      appleTeam = await resolveAppleTeamIfAuthenticatedAsync(ctx, app);
    }
    assert(appleTeam, 'Apple Team must be defined here');

    // 2. Fetch devices registered on EAS servers
    let registeredAppleDevices = await ctx.ios.getDevicesForAppleTeamAsync(
      ctx.graphqlClient,
      app,
      appleTeam
    );
    if (registeredAppleDevices.length === 0) {
      const shouldRegisterDevices = await confirmAsync({
        message: `You don't have any registered devices yet. Would you like to register them now?`,
        initial: true,
      });

      if (shouldRegisterDevices) {
        registeredAppleDevices = await this.registerDevicesAsync(ctx, appleTeam);
      } else {
        throw new Error(`Run 'eas device:create' to register your devices first`);
      }
    }

    // 3. Choose devices for internal distribution
    const provisionedDeviceIdentifiers = (
      currentBuildCredentials?.provisioningProfile?.appleDevices ?? []
    ).map(i => i.identifier);
    const chosenDevices = await chooseDevicesAsync(
      registeredAppleDevices,
      provisionedDeviceIdentifiers
    );

    // 4. Reuse or create the profile on Apple Developer Portal
    const applePlatform = await getApplePlatformFromTarget(target);
    const profileType =
      applePlatform === ApplePlatform.TV_OS
        ? ProfileType.TVOS_APP_ADHOC
        : ProfileType.IOS_APP_ADHOC;
    const provisioningProfileStoreInfo =
      await ctx.appStore.createOrReuseAdhocProvisioningProfileAsync(
        chosenDevices.map(({ identifier }) => identifier),
        app.bundleIdentifier,
        distCert.serialNumber,
        profileType
      );

    // 5. Create or update the profile on servers
    const appleAppIdentifier = await ctx.ios.createOrGetExistingAppleAppIdentifierAsync(
      ctx.graphqlClient,
      app,
      appleTeam
    );
    let appleProvisioningProfile: AppleProvisioningProfileFragment | null;
    if (currentBuildCredentials?.provisioningProfile) {
      appleProvisioningProfile = await this.reuseCurrentProvisioningProfileAsync(
        currentBuildCredentials.provisioningProfile,
        provisioningProfileStoreInfo,
        ctx,
        app,
        appleAppIdentifier
      );
    } else {
      appleProvisioningProfile = await ctx.ios.createProvisioningProfileAsync(
        ctx.graphqlClient,
        app,
        appleAppIdentifier,
        {
          appleProvisioningProfile: provisioningProfileStoreInfo.provisioningProfile,
          developerPortalIdentifier: provisioningProfileStoreInfo.provisioningProfileId,
        }
      );
    }

    // 6. Compare selected devices with the ones actually provisioned
    const diffList = differenceBy(
      chosenDevices,
      appleProvisioningProfile.appleDevices,
      'identifier'
    );
    if (diffList.length > 0) {
      Log.warn(`Failed to provision ${diffList.length} of the selected devices:`);
      for (const missingDevice of diffList) {
        Log.warn(`- ${formatDeviceLabel(missingDevice)}`);
      }
      Log.log(
        'Most commonly devices fail to to be provisioned while they are still being processed by Apple, which can take up to 24-72 hours. Check your Apple Developer Portal page at https://developer.apple.com/account/resources/devices/list, the devices in "Processing" status cannot be provisioned yet'
      );
      const shouldContinue = await selectAsync(
        'Do you want to continue without provisioning these devices?',
        [
          {
            title: 'Yes',
            value: true,
          },
          {
            title: 'No (EAS CLI will exit)',
            value: false,
          },
        ]
      );
      if (!shouldContinue) {
        Errors.exit(1);
      }
    }

    // 7. Create (or update) app build credentials
    assert(appleProvisioningProfile);
    return await assignBuildCredentialsAsync(
      ctx,
      app,
      IosDistributionType.AdHoc,
      distCert,
      appleProvisioningProfile,
      appleTeam
    );
  }

  private async reuseCurrentProvisioningProfileAsync(
    currentProvisioningProfile: AppleProvisioningProfileFragment,
    provisioningProfileStoreInfo: ProvisioningProfile,
    ctx: CredentialsContext,
    app: AppLookupParams,
    appleAppIdentifier: AppleAppIdentifierFragment
  ): Promise<AppleProvisioningProfileFragment> {
    if (
      currentProvisioningProfile.developerPortalIdentifier !==
      provisioningProfileStoreInfo.provisioningProfileId
    ) {
      // If IDs don't match, the profile needs to be deleted and re-created
      await ctx.ios.deleteProvisioningProfilesAsync(ctx.graphqlClient, [
        currentProvisioningProfile.id,
      ]);
      return await ctx.ios.createProvisioningProfileAsync(
        ctx.graphqlClient,
        app,
        appleAppIdentifier,
        {
          appleProvisioningProfile: provisioningProfileStoreInfo.provisioningProfile,
          developerPortalIdentifier: provisioningProfileStoreInfo.provisioningProfileId,
        }
      );
    } else {
      // If not, the profile needs to be updated first
      return await ctx.ios.updateProvisioningProfileAsync(
        ctx.graphqlClient,
        currentProvisioningProfile.id,
        {
          appleProvisioningProfile: provisioningProfileStoreInfo.provisioningProfile,
          developerPortalIdentifier: provisioningProfileStoreInfo.provisioningProfileId,
        }
      );
    }
  }

  private async areBuildCredentialsSetupAsync(ctx: CredentialsContext): Promise<boolean> {
    const { app, target } = this.options;
    const buildCredentials = await getBuildCredentialsAsync(ctx, app, IosDistributionType.AdHoc);
    return await validateProvisioningProfileAsync(ctx, target, app, buildCredentials);
  }

  private async shouldUseExistingProfileAsync(
    ctx: CredentialsContext,
    buildCredentials: IosAppBuildCredentialsFragment
  ): Promise<boolean> {
    const { app } = this.options;
    const provisioningProfile = nullthrows(buildCredentials.provisioningProfile);

    const appleTeam = nullthrows(provisioningProfile.appleTeam);
    const registeredAppleDevices = await ctx.ios.getDevicesForAppleTeamAsync(
      ctx.graphqlClient,
      app,
      appleTeam
    );

    const provisionedDevices = provisioningProfile.appleDevices;

    const allRegisteredDevicesAreProvisioned = doUDIDsMatch(
      registeredAppleDevices.map(({ identifier }) => identifier),
      provisionedDevices.map(({ identifier }) => identifier)
    );

    if (allRegisteredDevicesAreProvisioned) {
      const reuseAction = await this.promptForReuseActionAsync();
      if (reuseAction === ReuseAction.Yes) {
        return true;
      } else if (reuseAction === ReuseAction.No) {
        return false;
      } else {
        Log.newLine();
        Log.log('Devices registered in the Provisioning Profile:');
        for (const device of provisionedDevices) {
          Log.log(`- ${formatDeviceLabel(device)}`);
        }
        Log.newLine();
        return (
          (await this.promptForReuseActionAsync({ showShowDevicesOption: false })) ===
          ReuseAction.Yes
        );
      }
    } else {
      const missingDevices = differenceBy(registeredAppleDevices, provisionedDevices, 'identifier');
      Log.warn(`The provisioning profile is missing the following devices:`);
      for (const missingDevice of missingDevices) {
        Log.warn(`- ${formatDeviceLabel(missingDevice)}`);
      }
      return !(await confirmAsync({
        message: `Would you like to choose the devices to provision again?`,
        initial: true,
      }));
    }
  }

  private async promptForReuseActionAsync({
    showShowDevicesOption = true,
  } = {}): Promise<ReuseAction> {
    const { selected } = await promptAsync({
      type: 'select',
      name: 'selected',
      message: `${
        showShowDevicesOption
          ? 'All your registered devices are present in the Provisioning Profile. '
          : ''
      }Would you like to reuse the profile?`,
      choices: [
        { title: 'Yes', value: ReuseAction.Yes },
        ...(showShowDevicesOption
          ? [
              {
                title: 'Show devices and ask me again',
                value: ReuseAction.ShowDevices,
              },
            ]
          : []),
        {
          title: 'No, let me choose devices again',
          value: ReuseAction.No,
        },
      ],
    });
    return selected;
  }

  private async registerDevicesAsync(
    ctx: CredentialsContext,
    appleTeam: AppleTeamFragment
  ): Promise<AppleDeviceFragment[]> {
    const { app } = this.options;
    const action = new DeviceCreateAction(ctx.graphqlClient, ctx.appStore, app.account, appleTeam);
    const method = await action.runAsync();

    while (true) {
      if (method === RegistrationMethod.WEBSITE) {
        Log.log(chalk.bold("Press any key if you've already finished device registration."));
        await pressAnyKeyToContinueAsync();
      }
      Log.newLine();

      const devices = await ctx.ios.getDevicesForAppleTeamAsync(ctx.graphqlClient, app, appleTeam, {
        useCache: false,
      });
      if (devices.length === 0) {
        Log.warn('There are still no registered devices.');
        // if the user used the input method there should be some devices available
        if (method === RegistrationMethod.INPUT) {
          throw new Error('Input registration method has failed');
        }
      } else {
        return devices;
      }
    }
  }
}

export function doUDIDsMatch(udidsA: string[], udidsB: string[]): boolean {
  const setA = new Set(udidsA);
  const setB = new Set(udidsB);

  if (setA.size !== setB.size) {
    return false;
  }
  for (const a of setA) {
    if (!setB.has(a)) {
      return false;
    }
  }
  return true;
}
