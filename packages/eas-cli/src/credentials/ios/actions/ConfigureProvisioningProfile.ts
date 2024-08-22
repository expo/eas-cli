import assert from 'assert';
import chalk from 'chalk';

import {
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileFragment,
} from '../../../graphql/generated';
import Log, { learnMore } from '../../../log';
import { ora } from '../../../ora';
import { getApplePlatformFromTarget } from '../../../project/ios/target';
import { CredentialsContext } from '../../context';
import {
  ForbidCredentialModificationError,
  InsufficientAuthenticationNonInteractiveError,
} from '../../errors';
import { AppleProvisioningProfileMutationResult } from '../api/graphql/mutations/AppleProvisioningProfileMutation';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';
import { ProvisioningProfileStoreInfo } from '../appstore/Credentials.types';
import { AuthCtx, AuthenticationMode } from '../appstore/authenticateTypes';
import { Target } from '../types';

export class ConfigureProvisioningProfile {
  constructor(
    private readonly app: AppLookupParams,
    private readonly target: Target,
    private readonly distributionCertificate: AppleDistributionCertificateFragment,
    private readonly originalProvisioningProfile: AppleProvisioningProfileFragment
  ) {}

  public async runAsync(
    ctx: CredentialsContext
  ): Promise<AppleProvisioningProfileMutationResult | null> {
    if (ctx.freezeCredentials) {
      throw new ForbidCredentialModificationError(
        'Remove the --freeze-credentials flag to configure a Provisioning Profile.'
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
    const { developerPortalIdentifier, provisioningProfile } = this.originalProvisioningProfile;
    if (!developerPortalIdentifier && !provisioningProfile) {
      Log.warn("The provisioning profile we have on file cannot be configured on Apple's servers.");
      return null;
    }

    if (!ctx.appStore.authCtx) {
      Log.warn(
        "Without access to your Apple account we can't configure provisioning profiles for you."
      );
      Log.warn('Make sure to recreate the profile if you selected a new distribution certificate.');
      return null;
    }

    const applePlatform = getApplePlatformFromTarget(this.target);
    const profilesFromApple = await ctx.appStore.listProvisioningProfilesAsync(
      this.app.bundleIdentifier,
      applePlatform
    );
    const [matchingProfile] = profilesFromApple.filter(appleInfo =>
      developerPortalIdentifier
        ? appleInfo.provisioningProfileId === developerPortalIdentifier
        : appleInfo.provisioningProfile === provisioningProfile
    );
    if (!matchingProfile) {
      Log.warn(
        `Profile ${
          developerPortalIdentifier ? `${developerPortalIdentifier} ` : ''
        }not found on Apple Developer Portal.`
      );
      return null;
    }

    return await this.configureAndUpdateAsync(ctx, ctx.appStore.authCtx, this.app, matchingProfile);
  }

  private async configureAndUpdateAsync(
    ctx: CredentialsContext,
    authCtx: AuthCtx,
    app: AppLookupParams,
    profileFromApple: ProvisioningProfileStoreInfo
  ): Promise<AppleProvisioningProfileMutationResult> {
    const { developerPortalIdentifier, certificateP12, certificatePassword, serialNumber } =
      this.distributionCertificate;
    assert(
      certificateP12 && certificatePassword,
      'Distribution Certificate P12 and Password is required'
    );
    // configure profile on Apple's Server to use our distCert
    const updatedProfile = await ctx.appStore.useExistingProvisioningProfileAsync(
      app.bundleIdentifier,
      profileFromApple,
      {
        certId: developerPortalIdentifier ?? undefined,
        certP12: certificateP12,
        certPassword: certificatePassword,
        distCertSerialNumber: serialNumber,
        teamId: authCtx.team.id,
      }
    );

    const bundleIdTag = `(${app.bundleIdentifier})`;
    const slugTag = `@${app.account.name}/${app.projectName}`;
    const projectTag = `${chalk.bold(slugTag)} ${chalk.dim(bundleIdTag)}`;

    const spinner = ora(`Updating Expo profile for ${projectTag}`).start();
    try {
      const configuredProvisioningProfile = await ctx.ios.updateProvisioningProfileAsync(
        ctx.graphqlClient,
        this.originalProvisioningProfile.id,
        {
          appleProvisioningProfile: updatedProfile.provisioningProfile,
          developerPortalIdentifier: updatedProfile.provisioningProfileId,
        }
      );
      spinner.succeed(`Updated Expo profile for ${projectTag}`);
      return configuredProvisioningProfile;
    } catch (error) {
      spinner.fail();
      throw error;
    }
  }
}
