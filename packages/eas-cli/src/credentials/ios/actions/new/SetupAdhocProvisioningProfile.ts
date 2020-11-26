import assert from 'assert';
import nullthrows from 'nullthrows';

import {
  AppleDevice,
  IosAppBuildCredentials,
  IosDistributionType,
} from '../../../../graphql/generated';
import { confirmAsync } from '../../../../prompts';
import { Action, CredentialsManager } from '../../../CredentialsManager';
import { Context } from '../../../context';
import { AppLookupParams } from '../../api/GraphqlClient';
import { ProvisioningProfileStoreInfo } from '../../appstore/Credentials.types';
import { ProfileClass } from '../../appstore/provisioningProfile';
import { chooseDevices } from './DeviceUtils';
import { doUDIDsMatch, isDevPortalAdhocProfileValid } from './ProvisioningProfileUtils';
import { SetupDistributionCertificate } from './SetupDistributionCertificate';

export class SetupAdhocProvisioningProfile implements Action {
  private _iosAppBuildCredentials?: IosAppBuildCredentials;

  constructor(private app: AppLookupParams) {}

  public get iosAppBuildCredentials(): IosAppBuildCredentials {
    assert(
      this._iosAppBuildCredentials,
      'iosAppBuildCredentials can be accessed only after calling .runAsync()'
    );
    return this._iosAppBuildCredentials;
  }

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const authCtx = await ctx.appStore.ensureAuthenticatedAsync();

    // 0. Fetch apple team object
    const appleTeam = await ctx.newIos.createOrGetExistingAppleTeamAsync(this.app, {
      appleTeamIdentifier: authCtx.team.id,
      appleTeamName: authCtx.team.name,
    });

    // 1. Fetch devices registered on Expo servers.
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
    const distCertAction = new SetupDistributionCertificate(this.app);
    await manager.runActionAsync(distCertAction);
    const distCert = distCertAction.distributionCertificate;

    // 3. Fetch profile from Expo servers
    let currentProfileFromExpoServers = await ctx.newIos.getProvisioningProfileAsync(
      this.app,
      appleTeam,
      IosDistributionType.AdHoc
    );

    // 4. Choose devices for internal distribution
    let chosenDevices: AppleDevice[];
    if (currentProfileFromExpoServers) {
      const appleDeviceIdentifiersFromProfile = (
        currentProfileFromExpoServers.appleDevices ?? []
      ).map(({ identifier }) => identifier);

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
    if (currentProfileFromExpoServers) {
      if (profileWasRecreated) {
        currentProfileFromExpoServers = await ctx.newIos.updateProvisioningProfileAsync(
          currentProfileFromExpoServers.id,
          {
            appleProvisioningProfile: profileToUse.provisioningProfile,
            developerPortalIdentifier: profileToUse.provisioningProfileId,
          }
        );
      }
    } else {
      currentProfileFromExpoServers = await ctx.newIos.createProvisioningProfileAsync(
        this.app,
        appleAppIdentifier,
        {
          appleProvisioningProfile: profileToUse.provisioningProfile,
          developerPortalIdentifier: profileToUse.provisioningProfileId,
        }
      );
    }

    // 8. Create (or update) app build credentials
    this._iosAppBuildCredentials = await ctx.newIos.createOrUpdateIosAppBuildCredentialsAsync(
      this.app,
      {
        appleTeam,
        appleAppIdentifierId: appleAppIdentifier.id,
        appleDistributionCertificateId: distCert.id,
        appleProvisioningProfileId: currentProfileFromExpoServers.id,
        iosDistributionType: IosDistributionType.AdHoc,
      }
    );
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
