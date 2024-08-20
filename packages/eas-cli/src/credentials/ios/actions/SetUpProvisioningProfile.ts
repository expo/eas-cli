import nullthrows from 'nullthrows';

import {
  assignBuildCredentialsAsync,
  getBuildCredentialsAsync,
  getProvisioningProfileAsync,
} from './BuildCredentialsUtils';
import { ConfigureProvisioningProfile } from './ConfigureProvisioningProfile';
import { CreateProvisioningProfile } from './CreateProvisioningProfile';
import { formatProvisioningProfileFromApple } from './ProvisioningProfileUtils';
import { SetUpDistributionCertificate } from './SetUpDistributionCertificate';
import {
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType,
} from '../../../graphql/generated';
import { learnMore } from '../../../log';
import { getApplePlatformFromTarget } from '../../../project/ios/target';
import { confirmAsync } from '../../../prompts';
import { CredentialsContext } from '../../context';
import {
  ForbidCredentialModificationError,
  InsufficientAuthenticationNonInteractiveError,
} from '../../errors';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';
import { ProvisioningProfileStoreInfo } from '../appstore/Credentials.types';
import { AuthenticationMode } from '../appstore/authenticateTypes';
import { Target } from '../types';
import { validateProvisioningProfileAsync } from '../validators/validateProvisioningProfile';

/**
 * Sets up either APP_STORE or ENTERPRISE provisioning profiles
 */
export class SetUpProvisioningProfile {
  constructor(
    private readonly app: AppLookupParams,
    private readonly target: Target,
    private readonly distributionType: IosDistributionType
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
    if (ctx.freezeCredentials) {
      throw new ForbidCredentialModificationError(
        'Provisioning profile is not configured correctly. Remove the --freeze-credentials flag to configure it.'
      );
    } else if (
      ctx.nonInteractive &&
      ctx.appStore.defaultAuthenticationMode !== AuthenticationMode.API_KEY
    ) {
      throw new InsufficientAuthenticationNonInteractiveError(
        `In order to configure your Provisioning Profile, authentication with an ASC API key is required in non-interactive mode. ${learnMore(
          'https://docs.expo.dev/build/building-on-ci/#optional-provide-an-asc-api-token-for-your-apple-team'
        )}`
      );
    }

    const currentProfile = await getProvisioningProfileAsync(ctx, this.app, this.distributionType);
    if (!currentProfile) {
      return await this.createAndAssignProfileAsync(ctx, distCert);
    }

    // See if the profile we have exists on the Apple Servers
    const applePlatform = await getApplePlatformFromTarget(this.target);
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

    const isNonInteractiveOrUserDidConfirmAsync = async (): Promise<boolean> => {
      if (ctx.nonInteractive) {
        return true;
      }
      return await confirmAsync({
        message: `${formatProvisioningProfileFromApple(
          currentProfileFromServer
        )} \n  Would you like to reuse the original profile?`,
      });
    };

    const confirm = await isNonInteractiveOrUserDidConfirmAsync();
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
