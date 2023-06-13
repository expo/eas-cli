import nullthrows from 'nullthrows';

import {
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../../graphql/generated';
import { getApplePlatformFromTarget } from '../../../project/ios/target';
import { confirmAsync } from '../../../prompts';
import { CredentialsContext } from '../../context';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';
import { ProvisioningProfileStoreInfo } from '../appstore/Credentials.types';
import { Target } from '../types';
import { validateProvisioningProfileAsync } from '../validators/validateProvisioningProfile';
import {
  assignBuildCredentialsAsync,
  getBuildCredentialsAsync,
  getProvisioningProfileAsync,
} from './BuildCredentialsUtils';
import { ConfigureProvisioningProfile } from './ConfigureProvisioningProfile';
import { CreateProvisioningProfile } from './CreateProvisioningProfile';
import { formatProvisioningProfileFromApple } from './ProvisioningProfileUtils';
import { SetUpDistributionCertificate } from './SetUpDistributionCertificate';

/**
 * Sets up either APP_STORE or ENTERPRISE provisioning profiles
 */
export class SetUpProvisioningProfile {
  constructor(
    private app: AppLookupParams,
    private target: Target,
    private distributionType: IosDistributionType
  ) {}

  async areBuildCredentialsSetupAsync(ctx: CredentialsContext): Promise<boolean> {
    const buildCredentials = await getBuildCredentialsAsync(ctx, this.app, this.distributionType);
    return await validateProvisioningProfileAsync(ctx, this.target, this.app, buildCredentials);
  }

  async assignNewAndDeleteOldProfileAsync(
    ctx: CredentialsContext,
    distCert: AppleDistributionCertificateFragment,
    currentProfile: AppleProvisioningProfileFragment
  ): Promise<IosAppBuildCredentialsFragment> {
    const buildCredentials = await this.createAndAssignProfileAsync(ctx, distCert);
    // delete 'currentProfile' since its no longer valid
    await ctx.ios.deleteProvisioningProfilesAsync(ctx.graphqlClient, [currentProfile.id]);
    await ctx.appStore.revokeProvisioningProfileAsync(this.app.bundleIdentifier, currentProfile.id);
    return buildCredentials;
  }

  async createAndAssignProfileAsync(
    ctx: CredentialsContext,
    distCert: AppleDistributionCertificateFragment
  ): Promise<IosAppBuildCredentialsFragment> {
    const provisioningProfile = await new CreateProvisioningProfile(
      this.app,
      this.target,
      distCert
    ).runAsync(ctx);
    return await assignBuildCredentialsAsync(
      ctx,
      this.app,
      this.distributionType,
      distCert,
      provisioningProfile
    );
  }

  async configureAndAssignProfileAsync(
    ctx: CredentialsContext,
    distCert: AppleDistributionCertificateFragment,
    originalProvisioningProfile: AppleProvisioningProfileFragment
  ): Promise<IosAppBuildCredentialsFragment | null> {
    const profileConfigurator = new ConfigureProvisioningProfile(
      this.app,
      this.target,
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

  async runAsync(ctx: CredentialsContext): Promise<IosAppBuildCredentialsFragment> {
    const distCert = await new SetUpDistributionCertificate(
      this.app,
      this.distributionType
    ).runAsync(ctx);

    const areBuildCredentialsSetup = await this.areBuildCredentialsSetupAsync(ctx);
    if (areBuildCredentialsSetup) {
      return nullthrows(await getBuildCredentialsAsync(ctx, this.app, this.distributionType));
    }

    const currentProfile = await getProvisioningProfileAsync(ctx, this.app, this.distributionType);
    if (!currentProfile) {
      return await this.createAndAssignProfileAsync(ctx, distCert);
    }

    // See if the profile we have exists on the Apple Servers
    const applePlatform = getApplePlatformFromTarget(this.target);
    const existingProfiles = await ctx.appStore.listProvisioningProfilesAsync(
      this.app.bundleIdentifier,
      applePlatform
    );
    const currentProfileFromServer = this.getCurrentProfileStoreInfo(
      existingProfiles,
      currentProfile
    );
    if (!currentProfileFromServer) {
      return await this.assignNewAndDeleteOldProfileAsync(ctx, distCert, currentProfile);
    }

    if (!ctx.nonInteractive) {
      const confirm = await confirmAsync({
        message: `${formatProvisioningProfileFromApple(
          currentProfileFromServer
        )} \n  Would you like to reuse the original profile?`,
      });
      if (!confirm) {
        return await this.assignNewAndDeleteOldProfileAsync(ctx, distCert, currentProfile);
      }
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
