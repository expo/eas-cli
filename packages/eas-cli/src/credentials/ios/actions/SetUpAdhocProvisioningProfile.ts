import assert from 'assert';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

import DeviceCreateAction, { RegistrationMethod } from '../../../devices/actions/create/action';
import {
  AppleDeviceFragment,
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileFragment,
  AppleTeamFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../../graphql/generated';
import Log from '../../../log';
import { confirmAsync, pressAnyKeyToContinueAsync, promptAsync } from '../../../prompts';
import differenceBy from '../../../utils/expodash/differenceBy';
import { CredentialsContext } from '../../context';
import { MissingCredentialsNonInteractiveError } from '../../errors';
import { AppLookupParams } from '../api/GraphqlClient';
import { validateProvisioningProfileAsync } from '../validators/validateProvisioningProfile';
import { resolveAppleTeamIfAuthenticatedAsync } from './AppleTeamUtils';
import { assignBuildCredentialsAsync, getBuildCredentialsAsync } from './BuildCredentialsUtils';
import { chooseDevicesAsync, formatDeviceLabel } from './DeviceUtils';
import { SetUpDistributionCertificate } from './SetUpDistributionCertificate';

enum ReuseAction {
  Yes,
  ShowDevices,
  No,
}

export class SetUpAdhocProvisioningProfile {
  constructor(private app: AppLookupParams) {}

  async runAsync(ctx: CredentialsContext): Promise<IosAppBuildCredentialsFragment> {
    const distCert = await new SetUpDistributionCertificate(
      this.app,
      IosDistributionType.AdHoc
    ).runAsync(ctx);

    const areBuildCredentialsSetup = await this.areBuildCredentialsSetupAsync(ctx);

    if (ctx.nonInteractive) {
      if (areBuildCredentialsSetup) {
        return nullthrows(await getBuildCredentialsAsync(ctx, this.app, IosDistributionType.AdHoc));
      } else {
        throw new MissingCredentialsNonInteractiveError(
          'Provisioning profile is not configured correctly. Run this command again in interactive mode.'
        );
      }
    }

    const currentBuildCredentials = await getBuildCredentialsAsync(
      ctx,
      this.app,
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
    const currentBuildCredentials = await getBuildCredentialsAsync(
      ctx,
      this.app,
      IosDistributionType.AdHoc
    );

    // 1. Resolve Apple Team
    let appleTeam: AppleTeamFragment | null =
      distCert.appleTeam ?? currentBuildCredentials?.provisioningProfile?.appleTeam ?? null;
    if (!appleTeam) {
      await ctx.appStore.ensureAuthenticatedAsync();
      appleTeam = await resolveAppleTeamIfAuthenticatedAsync(ctx, this.app);
    }
    assert(appleTeam, 'Apple Team must be defined here');

    // 2. Fetch devices registered on EAS servers
    let registeredAppleDevices = await ctx.ios.getDevicesForAppleTeamAsync(this.app, appleTeam);
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
    const provisioningProfileStoreInfo =
      await ctx.appStore.createOrReuseAdhocProvisioningProfileAsync(
        chosenDevices.map(({ identifier }) => identifier),
        this.app.bundleIdentifier,
        distCert.serialNumber
      );

    // 5. Create or update the profile on servers
    const appleAppIdentifier = await ctx.ios.createOrGetExistingAppleAppIdentifierAsync(
      this.app,
      appleTeam
    );
    let appleProvisioningProfile: AppleProvisioningProfileFragment | null = null;
    if (currentBuildCredentials?.provisioningProfile) {
      if (
        currentBuildCredentials.provisioningProfile.developerPortalIdentifier !==
        provisioningProfileStoreInfo.provisioningProfileId
      ) {
        await ctx.ios.deleteProvisioningProfilesAsync([
          currentBuildCredentials.provisioningProfile.id,
        ]);
        appleProvisioningProfile = await ctx.ios.createProvisioningProfileAsync(
          this.app,
          appleAppIdentifier,
          {
            appleProvisioningProfile: provisioningProfileStoreInfo.provisioningProfile,
            developerPortalIdentifier: provisioningProfileStoreInfo.provisioningProfileId,
          }
        );
      } else {
        appleProvisioningProfile = currentBuildCredentials.provisioningProfile;
      }
    } else {
      appleProvisioningProfile = await ctx.ios.createProvisioningProfileAsync(
        this.app,
        appleAppIdentifier,
        {
          appleProvisioningProfile: provisioningProfileStoreInfo.provisioningProfile,
          developerPortalIdentifier: provisioningProfileStoreInfo.provisioningProfileId,
        }
      );
    }

    // 6. Create (or update) app build credentials
    assert(appleProvisioningProfile);
    return await assignBuildCredentialsAsync(
      ctx,
      this.app,
      IosDistributionType.AdHoc,
      distCert,
      appleProvisioningProfile,
      appleTeam
    );
  }

  private async areBuildCredentialsSetupAsync(ctx: CredentialsContext): Promise<boolean> {
    const buildCredentials = await getBuildCredentialsAsync(
      ctx,
      this.app,
      IosDistributionType.AdHoc
    );
    return await validateProvisioningProfileAsync(ctx, this.app, buildCredentials);
  }

  private async shouldUseExistingProfileAsync(
    ctx: CredentialsContext,
    buildCredentials: IosAppBuildCredentialsFragment
  ): Promise<boolean> {
    const provisioningProfile = nullthrows(buildCredentials.provisioningProfile);

    const appleTeam = nullthrows(provisioningProfile.appleTeam);
    const registeredAppleDevices = await ctx.ios.getDevicesForAppleTeamAsync(this.app, appleTeam);

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
    const action = new DeviceCreateAction(ctx.appStore, this.app.account, appleTeam);
    const method = await action.runAsync();

    while (true) {
      if (method === RegistrationMethod.WEBSITE) {
        Log.newLine();
        Log.log(chalk.bold("Press any key if you've already finished device registration."));
        await pressAnyKeyToContinueAsync();
      }
      Log.newLine();

      const devices = await ctx.ios.getDevicesForAppleTeamAsync(this.app, appleTeam, {
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
