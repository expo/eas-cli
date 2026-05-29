import nullthrows from 'nullthrows';

import { tryAuthenticateAppStoreWithEasAscApiKeyAsync } from './AscApiKeyUtils';
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
import Log, { learnMore } from '../../../log';
import { getApplePlatformFromTarget } from '../../../project/ios/target';
import { confirmAsync } from '../../../prompts';
import { CredentialsContext } from '../../context';
import {
  ForbidCredentialModificationError,
  InsufficientAuthenticationNonInteractiveError,
} from '../../errors';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';
import { ProvisioningProfileStoreInfo } from '../appstore/Credentials.types';
import { resolveAppleTeamTypeFromEnvironment } from '../appstore/resolveCredentials';
import { AppleTeamType } from '../appstore/authenticateTypes';
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
    if (ctx.nonInteractive && !ctx.appStore.authCtx) {
      await tryAuthenticateAppStoreWithEasAscApiKeyAsync(
        ctx,
        this.app,
        this.resolveTeamTypeForAuthentication()
      );
    }

    let areBuildCredentialsSetup: boolean;
    try {
      areBuildCredentialsSetup = await this.areBuildCredentialsSetupAsync(ctx);
    } catch (error: any) {
      if (ctx.nonInteractive) {
        Log.warn(
          'Skipping Provisioning Profile validation on Apple servers due to an unexpected validation error. Continuing with local validation result.'
        );
        Log.debug('Provisioning profile validation on Apple servers failed:', error);
        areBuildCredentialsSetup = true;
      } else {
        throw error;
      }
    }
    if (areBuildCredentialsSetup) {
      return nullthrows(await getBuildCredentialsAsync(ctx, this.app, this.distributionType));
    }
    if (ctx.freezeCredentials) {
      throw new ForbidCredentialModificationError(
        'Provisioning profile is not configured correctly. Remove the --freeze-credentials flag to configure it.'
      );
    }

    if (ctx.nonInteractive && !ctx.appStore.authCtx) {
      throw new InsufficientAuthenticationNonInteractiveError(
        `In order to configure your Provisioning Profile, authentication with an ASC API key is required in non-interactive mode. Either set the EXPO_ASC_API_KEY_PATH/EXPO_ASC_KEY_ID/EXPO_ASC_ISSUER_ID environment variables, or configure an App Store Connect API Key for this app on EAS. ${learnMore(
          'https://docs.expo.dev/build/building-on-ci/#optional-provide-an-asc-api-token-for-your-apple-team'
        )}`
      );
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

    const isNonInteractiveOrUserDidConfirmAsync = async (): Promise<boolean> => {
      if (ctx.nonInteractive || ctx.autoAcceptCredentialReuse) {
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

  /**
   * The team type determines `team.inHouse`, which in turn selects the Apple profile
   * type used for every subsequent profile lookup and creation (IOS_APP_INHOUSE for
   * enterprise vs IOS_APP_STORE otherwise). We derive it from the distribution
   * type, which is exactly what the requested operation needs: enterprise
   * builds require an in-house team, other distribution types don't.
   * A genuine team/distribution mismatch is rejected by Apple regardless of this value.
   */
  private getDerivedTeamTypeForAuthentication(): AppleTeamType {
    return this.distributionType === IosDistributionType.Enterprise
      ? AppleTeamType.IN_HOUSE
      : AppleTeamType.COMPANY_OR_ORGANIZATION;
  }

  private resolveTeamTypeForAuthentication(): AppleTeamType {
    return resolveAppleTeamTypeFromEnvironment() ?? this.getDerivedTeamTypeForAuthentication();
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
