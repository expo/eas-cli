import nullthrows from 'nullthrows';

import {
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../../../graphql/generated';
import Log from '../../../../log';
import { confirmAsync } from '../../../../prompts';
import { CredentialsManager } from '../../../CredentialsManager';
import { Context } from '../../../context';
import { AppLookupParams } from '../../api/GraphqlClient';
import { ProvisioningProfileStoreInfo } from '../../appstore/Credentials.types';
import { validateProvisioningProfileAsync } from '../../validators/validateProvisioningProfile';
import { formatProvisioningProfileFromApple } from '../ProvisioningProfileUtils';
import { resolveAppleTeamIfAuthenticatedAsync } from './AppleTeamUtils';
import { ConfigureProvisioningProfile } from './ConfigureProvisioningProfile';
import { CreateProvisioningProfile } from './CreateProvisioningProfile';
import { SetupDistributionCertificate } from './SetupDistributionCertificate';

export class SetupProvisioningProfile {
  constructor(private app: AppLookupParams) {}

  async areBuildCredentialsSetupAsync(ctx: Context): Promise<boolean> {
    const appCredentials = await ctx.newIos.getIosAppCredentialsWithBuildCredentialsAsync(
      this.app,
      {
        iosDistributionType: IosDistributionType.AppStore,
      }
    );
    if (!appCredentials || appCredentials.iosAppBuildCredentialsArray.length === 0) {
      return false;
    }
    const [buildCredentials] = appCredentials.iosAppBuildCredentialsArray;
    const { distributionCertificate, provisioningProfile } = buildCredentials;
    if (!distributionCertificate || !provisioningProfile) {
      return false;
    }
    return await this.isCurrentProfileValidAsync(ctx, provisioningProfile, distributionCertificate);
  }

  async getBuildCredentialsAsync(ctx: Context): Promise<IosAppBuildCredentialsFragment | null> {
    const appCredentials = await ctx.newIos.getIosAppCredentialsWithBuildCredentialsAsync(
      this.app,
      {
        iosDistributionType: IosDistributionType.AppStore,
      }
    );
    if (!appCredentials || appCredentials.iosAppBuildCredentialsArray.length === 0) {
      return null;
    }
    const [buildCredentials] = appCredentials.iosAppBuildCredentialsArray;
    return buildCredentials;
  }

  async assignNewAndDeleteOldProfileAsync(
    ctx: Context,
    distCert: AppleDistributionCertificateFragment,
    currentProfile: AppleProvisioningProfileFragment
  ): Promise<IosAppBuildCredentialsFragment> {
    const buildCredentials = await this.createAndAssignProfileAsync(ctx, distCert);
    // delete 'currentProfile' since its no longer valid
    await ctx.newIos.deleteProvisioningProfilesAsync([currentProfile.id]);
    return buildCredentials;
  }

  async createAndAssignProfileAsync(
    ctx: Context,
    distCert: AppleDistributionCertificateFragment
  ): Promise<IosAppBuildCredentialsFragment> {
    const provisioningProfile = await new CreateProvisioningProfile(this.app, distCert).runAsync(
      ctx
    );
    return await this.assignBuildCredentialsAsync(ctx, distCert, provisioningProfile);
  }

  async configureAndAssignProfileAsync(
    ctx: Context,
    distCert: AppleDistributionCertificateFragment,
    originalProvisioningProfile: AppleProvisioningProfileFragment
  ): Promise<IosAppBuildCredentialsFragment | null> {
    const profileConfigurator = new ConfigureProvisioningProfile(
      this.app,
      distCert,
      originalProvisioningProfile
    );
    const updatedProvisioningProfile = await profileConfigurator.runAsync(ctx);
    if (!updatedProvisioningProfile) {
      return null;
    }
    return await this.assignBuildCredentialsAsync(ctx, distCert, updatedProvisioningProfile);
  }

  async assignBuildCredentialsAsync(
    ctx: Context,
    distCert: AppleDistributionCertificateFragment,
    provisioningProfile: AppleProvisioningProfileFragment
  ): Promise<IosAppBuildCredentialsFragment> {
    const appleTeam = nullthrows(await resolveAppleTeamIfAuthenticatedAsync(ctx, this.app));
    const appleAppIdentifier = await ctx.newIos.createOrGetExistingAppleAppIdentifierAsync(
      this.app,
      appleTeam
    );
    return await ctx.newIos.createOrUpdateIosAppBuildCredentialsAsync(this.app, {
      appleTeam,
      appleAppIdentifierId: appleAppIdentifier.id,
      appleDistributionCertificateId: distCert.id,
      appleProvisioningProfileId: provisioningProfile.id,
      iosDistributionType: IosDistributionType.AppStore,
    });
  }

  async getProvisioningProfileAsync(
    ctx: Context
  ): Promise<AppleProvisioningProfileFragment | null> {
    const appCredentials = await ctx.newIos.getIosAppCredentialsWithBuildCredentialsAsync(
      this.app,
      {
        iosDistributionType: IosDistributionType.AppStore,
      }
    );
    if (!appCredentials || appCredentials.iosAppBuildCredentialsArray.length === 0) {
      return null;
    }
    const [buildCredentials] = appCredentials.iosAppBuildCredentialsArray;
    return buildCredentials.provisioningProfile ?? null;
  }

  async runAsync(
    manager: CredentialsManager,
    ctx: Context
  ): Promise<IosAppBuildCredentialsFragment> {
    const areBuildCredentialsSetup = await this.areBuildCredentialsSetupAsync(ctx);
    if (areBuildCredentialsSetup) {
      return nullthrows(await this.getBuildCredentialsAsync(ctx));
    }
    if (ctx.nonInteractive) {
      throw new Error(
        'Provisioning profile is not configured correctly. Please run this command again in interactive mode.'
      );
    }

    const distCertAction = new SetupDistributionCertificate(this.app, IosDistributionType.AppStore);
    await manager.runActionAsync(distCertAction);
    const distCert = distCertAction.distributionCertificate;

    const currentProfile = await this.getProvisioningProfileAsync(ctx);
    if (!currentProfile) {
      return await this.createAndAssignProfileAsync(ctx, distCert);
    }
    const existingProfiles = await ctx.appStore.listProvisioningProfilesAsync(
      this.app.bundleIdentifier
    );

    if (existingProfiles.length === 0) {
      return await this.assignNewAndDeleteOldProfileAsync(ctx, distCert, currentProfile);
    }

    const currentProfileFromServer = this.getCurrentProfileStoreInfo(
      existingProfiles,
      currentProfile
    );

    if (!currentProfileFromServer) {
      return await this.assignNewAndDeleteOldProfileAsync(ctx, distCert, currentProfile);
    }

    const confirm = await confirmAsync({
      message: `${formatProvisioningProfileFromApple(
        currentProfileFromServer
      )} \n  Would you like to reuse the original profile?`,
    });
    if (!confirm) {
      return await this.assignNewAndDeleteOldProfileAsync(ctx, distCert, currentProfile);
    }
    const updatedProfile = await this.configureAndAssignProfileAsync(ctx, distCert, currentProfile);
    if (!updatedProfile) {
      return await this.assignNewAndDeleteOldProfileAsync(ctx, distCert, currentProfile);
    }
    return updatedProfile;
  }

  private async isCurrentProfileValidAsync(
    ctx: Context,
    currentProfile: AppleProvisioningProfileFragment,
    currentCertificate: AppleDistributionCertificateFragment
  ): Promise<boolean> {
    const { provisioningProfile, developerPortalIdentifier } = currentProfile;
    const { certificateP12, certificatePassword } = currentCertificate;
    if (!provisioningProfile || !certificateP12 || !certificatePassword) {
      return false;
    }
    const validationResult = await validateProvisioningProfileAsync(
      ctx,
      {
        provisioningProfile,
        ...(developerPortalIdentifier
          ? { provisioningProfileId: developerPortalIdentifier }
          : null),
      },
      {
        certP12: certificateP12,
        certPassword: certificatePassword,
      },
      this.app.bundleIdentifier
    );
    if (!validationResult.ok) {
      Log.warn(validationResult.error);
      return false;
    }
    return true;
  }

  private getCurrentProfileStoreInfo(
    profiles: ProvisioningProfileStoreInfo[],
    currentProfile: AppleProvisioningProfileFragment
  ): ProvisioningProfileStoreInfo | null {
    return (
      profiles.find(profile =>
        currentProfile.developerPortalIdentifier
          ? currentProfile.developerPortalIdentifier === profile.provisioningProfileId
          : currentProfile.provisioningProfile === profile.provisioningProfile
      ) ?? null
    );
  }
}
