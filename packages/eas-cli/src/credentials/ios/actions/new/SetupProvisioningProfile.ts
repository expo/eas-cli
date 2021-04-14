import nullthrows from 'nullthrows';

import {
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../../../graphql/generated';
import Log from '../../../../log';
import { confirmAsync } from '../../../../prompts';
import { Context } from '../../../context';
import { AppLookupParams } from '../../api/GraphqlClient';
import { ProvisioningProfileStoreInfo } from '../../appstore/Credentials.types';
import { MissingCredentialsNonInteractiveError } from '../../errors';
import { validateProvisioningProfileAsync } from '../../validators/validateProvisioningProfile';
import { formatProvisioningProfileFromApple } from '../ProvisioningProfileUtils';
import {
  assignBuildCredentialsAsync,
  getBuildCredentialsAsync,
  getProvisioningProfileAsync,
} from './BuildCredentialsUtils';
import { ConfigureProvisioningProfile } from './ConfigureProvisioningProfile';
import { CreateProvisioningProfile } from './CreateProvisioningProfile';
import { SetupDistributionCertificate } from './SetupDistributionCertificate';

export class SetupProvisioningProfile {
  constructor(private app: AppLookupParams, private distributionType: IosDistributionType) {}

  async areBuildCredentialsSetupAsync(ctx: Context): Promise<boolean> {
    const buildCredentials = await getBuildCredentialsAsync(ctx, this.app, this.distributionType);
    if (!buildCredentials) {
      return false;
    }
    const { distributionCertificate, provisioningProfile } = buildCredentials;
    if (!distributionCertificate || !provisioningProfile) {
      return false;
    }
    return await this.isCurrentProfileValidAsync(ctx, provisioningProfile, distributionCertificate);
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
    return await assignBuildCredentialsAsync(
      ctx,
      this.app,
      this.distributionType,
      distCert,
      provisioningProfile
    );
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
    return await assignBuildCredentialsAsync(
      ctx,
      this.app,
      this.distributionType,
      distCert,
      updatedProvisioningProfile
    );
  }

  async runAsync(ctx: Context): Promise<IosAppBuildCredentialsFragment> {
    const areBuildCredentialsSetup = await this.areBuildCredentialsSetupAsync(ctx);
    if (areBuildCredentialsSetup) {
      return nullthrows(await getBuildCredentialsAsync(ctx, this.app, this.distributionType));
    }
    if (ctx.nonInteractive) {
      throw new MissingCredentialsNonInteractiveError(
        'Provisioning profile is not configured correctly. Please run this command again in interactive mode.'
      );
    }

    const distCert = await new SetupDistributionCertificate(
      this.app,
      this.distributionType
    ).runAsync(ctx);

    const currentProfile = await getProvisioningProfileAsync(ctx, this.app, this.distributionType);
    if (!currentProfile) {
      return await this.createAndAssignProfileAsync(ctx, distCert);
    }

    // See if the profile we have exists on the Apple Servers
    const existingProfiles = await ctx.appStore.listProvisioningProfilesAsync(
      this.app.bundleIdentifier
    );
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

    // If we get here, we've verified the current profile still exists on Apple
    // But something wasn't quite right, so we want to fix and update it
    const updatedProfile = await this.configureAndAssignProfileAsync(ctx, distCert, currentProfile);
    if (!updatedProfile) {
      // Something went wrong, so just create a new profile instead
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
