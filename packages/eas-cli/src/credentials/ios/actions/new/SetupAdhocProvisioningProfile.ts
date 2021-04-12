import nullthrows from 'nullthrows';

import {
  AppleDevice,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../../../graphql/generated';
import Log from '../../../../log';
import { confirmAsync } from '../../../../prompts';
import { Context } from '../../../context';
import { AppLookupParams } from '../../api/GraphqlClient';
import { AppleProvisioningProfileMutationResult } from '../../api/graphql/mutations/AppleProvisioningProfileMutation';
import { AppleDeviceFragmentWithAppleTeam } from '../../api/graphql/queries/AppleDeviceQuery';
import { AppleProvisioningProfileQueryResult } from '../../api/graphql/queries/AppleProvisioningProfileQuery';
import { ProvisioningProfileStoreInfo } from '../../appstore/Credentials.types';
import { ProfileClass } from '../../appstore/provisioningProfile';
import { AppleTeamMissingError, MissingCredentialsNonInteractiveError } from '../../errors';
import { resolveAppleTeamIfAuthenticatedAsync } from './AppleTeamUtils';
import { chooseDevices } from './DeviceUtils';
import { doUDIDsMatch, isDevPortalAdhocProfileValid } from './ProvisioningProfileUtils';
import { SetupDistributionCertificate } from './SetupDistributionCertificate';

export class SetupAdhocProvisioningProfile {
  constructor(private app: AppLookupParams) {}

  async runAsync(ctx: Context): Promise<IosAppBuildCredentialsFragment> {
    if (ctx.nonInteractive) {
      try {
        return await this.runNonInteractiveAsync(ctx);
      } catch (err) {
        if (err instanceof AppleTeamMissingError) {
          throw new MissingCredentialsNonInteractiveError();
        }
        throw err;
      }
    } else {
      return await this.runInteractiveAsync(ctx);
    }
  }

  private async runNonInteractiveAsync(ctx: Context): Promise<IosAppBuildCredentialsFragment> {
    // 1. Setup Distribution Certificate
    await new SetupDistributionCertificate(this.app, IosDistributionType.AdHoc).runAsync(ctx);

    // 2. Fetch profile from EAS servers
    const currentProfile = await ctx.newIos.getProvisioningProfileAsync(
      this.app,
      IosDistributionType.AdHoc
    );

    if (!currentProfile) {
      throw new MissingCredentialsNonInteractiveError();
    }

    // TODO: implement validation
    Log.warn(
      'Provisioning Profile is not validated for non-interactive internal distribution builds.'
    );

    // app credentials should exist here because the profile exists
    const appCredentials = nullthrows(
      await ctx.newIos.getIosAppCredentialsWithBuildCredentialsAsync(this.app, {
        iosDistributionType: IosDistributionType.AdHoc,
      })
    );
    return appCredentials.iosAppBuildCredentialsArray[0];
  }

  private async runInteractiveAsync(ctx: Context): Promise<IosAppBuildCredentialsFragment> {
    // 0. Ensure the user is authenticated with Apple and resolve the Apple team object
    await ctx.appStore.ensureAuthenticatedAsync();
    const appleTeam = nullthrows(await resolveAppleTeamIfAuthenticatedAsync(ctx, this.app));

    // 1. Fetch devices registered on EAS servers
    const registeredAppleDevices = await ctx.newIos.getDevicesForAppleTeamAsync(
      this.app,
      appleTeam
    );
    const registeredAppleDeviceIdentifiers = registeredAppleDevices.map(
      ({ identifier }) => identifier
    );
    if (registeredAppleDeviceIdentifiers.length === 0) {
      throw new Error(`Run 'eas device:create' to register your devices first`);
    }

    // 2. Setup Distribution Certificate
    const distCert = await new SetupDistributionCertificate(
      this.app,
      IosDistributionType.AdHoc
    ).runAsync(ctx);

    let profileFromExpoServersToUse:
      | AppleProvisioningProfileQueryResult
      | AppleProvisioningProfileMutationResult
      | null = await ctx.newIos.getProvisioningProfileAsync(this.app, IosDistributionType.AdHoc, {
      appleTeam,
    });

    // 4. Choose devices for internal distribution
    let chosenDevices: AppleDeviceFragmentWithAppleTeam[];
    if (profileFromExpoServersToUse) {
      const appleDeviceIdentifiersFromProfile = ((profileFromExpoServersToUse.appleDevices ??
        []) as AppleDevice[]).map(({ identifier }) => identifier);

      let shouldAskToChooseDevices = true;
      if (doUDIDsMatch(appleDeviceIdentifiersFromProfile, registeredAppleDeviceIdentifiers)) {
        shouldAskToChooseDevices = await confirmAsync({
          message: `All your registered devices are present in the Provisioning Profile. Would you like to exclude some devices?`,
          initial: false,
        });
      }

      chosenDevices = shouldAskToChooseDevices
        ? await chooseDevices(registeredAppleDevices, appleDeviceIdentifiersFromProfile)
        : registeredAppleDevices;
    } else {
      chosenDevices = await chooseDevices(registeredAppleDevices);
    }

    // 5. Try to find the profile on Apple Developer Portal
    const currentProfileFromDevPortal = await this.getProfileFromDevPortalAsync(ctx);

    // 6. Validate the profile and possibly recreate it
    let profileToUse: ProvisioningProfileStoreInfo;
    let profileWasRecreated = false;
    if (isDevPortalAdhocProfileValid(currentProfileFromDevPortal, distCert, chosenDevices)) {
      profileToUse = nullthrows(currentProfileFromDevPortal);
    } else {
      const chosenDeviceUDIDs = chosenDevices.map(({ identifier }) => identifier);
      await ctx.appStore.createOrReuseAdhocProvisioningProfileAsync(
        chosenDeviceUDIDs,
        this.app.bundleIdentifier,
        distCert.serialNumber
      );
      profileToUse = nullthrows(await this.getProfileFromDevPortalAsync(ctx));
      profileWasRecreated = true;
    }

    // 7. Send profile to www if new has been created
    const appleAppIdentifier = await ctx.newIos.createOrGetExistingAppleAppIdentifierAsync(
      this.app,
      appleTeam
    );
    if (profileFromExpoServersToUse) {
      if (profileWasRecreated) {
        profileFromExpoServersToUse = await ctx.newIos.updateProvisioningProfileAsync(
          profileFromExpoServersToUse.id,
          {
            appleProvisioningProfile: profileToUse.provisioningProfile,
            developerPortalIdentifier: profileToUse.provisioningProfileId,
          }
        );
      }
    } else {
      profileFromExpoServersToUse = await ctx.newIos.createProvisioningProfileAsync(
        this.app,
        appleAppIdentifier,
        {
          appleProvisioningProfile: profileToUse.provisioningProfile,
          developerPortalIdentifier: profileToUse.provisioningProfileId,
        }
      );
    }

    // 8. Create (or update) app build credentials
    return await ctx.newIos.createOrUpdateIosAppBuildCredentialsAsync(this.app, {
      appleTeam,
      appleAppIdentifierId: appleAppIdentifier.id,
      appleDistributionCertificateId: distCert.id,
      appleProvisioningProfileId: profileFromExpoServersToUse.id,
      iosDistributionType: IosDistributionType.AdHoc,
    });
  }

  private async getProfileFromDevPortalAsync(
    ctx: Context
  ): Promise<ProvisioningProfileStoreInfo | null> {
    const profilesFromDevPortal = await ctx.appStore.listProvisioningProfilesAsync(
      this.app.bundleIdentifier,
      ProfileClass.Adhoc
    );
    return profilesFromDevPortal.length >= 1 ? profilesFromDevPortal[0] : null;
  }
}
