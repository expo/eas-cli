import {
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../../graphql/generated.js';
import { confirmAsync } from '../../../prompts.js';
import { nullthrows } from '../../../utils/nullthrows.js';
import { CredentialsContext } from '../../context.js';
import { MissingCredentialsNonInteractiveError } from '../../errors.js';
import { AppLookupParams } from '../api/GraphqlClient.js';
import { ProvisioningProfileStoreInfo } from '../appstore/Credentials.types.js';
import { validateProvisioningProfileAsync } from '../validators/validateProvisioningProfile.js';
import {
  assignBuildCredentialsAsync,
  getBuildCredentialsAsync,
  getProvisioningProfileAsync,
} from './BuildCredentialsUtils.js';
import { ConfigureProvisioningProfile } from './ConfigureProvisioningProfile.js';
import { CreateProvisioningProfile } from './CreateProvisioningProfile.js';
import { formatProvisioningProfileFromApple } from './ProvisioningProfileUtils.js';
import { SetUpDistributionCertificate } from './SetUpDistributionCertificate.js';

/**
 * Sets up either APP_STORE or ENTERPRISE provisioning profiles
 */
export class SetUpProvisioningProfile {
  constructor(private app: AppLookupParams, private distributionType: IosDistributionType) {}

  async areBuildCredentialsSetupAsync(ctx: CredentialsContext): Promise<boolean> {
    const buildCredentials = await getBuildCredentialsAsync(ctx, this.app, this.distributionType);
    return await validateProvisioningProfileAsync(ctx, this.app, buildCredentials);
  }

  async assignNewAndDeleteOldProfileAsync(
    ctx: CredentialsContext,
    distCert: AppleDistributionCertificateFragment,
    currentProfile: AppleProvisioningProfileFragment
  ): Promise<IosAppBuildCredentialsFragment> {
    const buildCredentials = await this.createAndAssignProfileAsync(ctx, distCert);
    // delete 'currentProfile' since its no longer valid
    await ctx.ios.deleteProvisioningProfilesAsync([currentProfile.id]);
    return buildCredentials;
  }

  async createAndAssignProfileAsync(
    ctx: CredentialsContext,
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
    ctx: CredentialsContext,
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

  async runAsync(ctx: CredentialsContext): Promise<IosAppBuildCredentialsFragment> {
    const distCert = await new SetUpDistributionCertificate(
      this.app,
      this.distributionType
    ).runAsync(ctx);

    const areBuildCredentialsSetup = await this.areBuildCredentialsSetupAsync(ctx);
    if (areBuildCredentialsSetup) {
      return nullthrows(await getBuildCredentialsAsync(ctx, this.app, this.distributionType));
    }
    if (ctx.nonInteractive) {
      throw new MissingCredentialsNonInteractiveError(
        'Provisioning profile is not configured correctly. Please run this command again in interactive mode.'
      );
    }

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
