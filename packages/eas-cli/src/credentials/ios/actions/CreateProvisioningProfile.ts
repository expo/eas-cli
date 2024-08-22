import assert from 'assert';
import nullthrows from 'nullthrows';

import { resolveAppleTeamIfAuthenticatedAsync } from './AppleTeamUtils';
import { generateProvisioningProfileAsync } from './ProvisioningProfileUtils';
import { AppleDistributionCertificateFragment } from '../../../graphql/generated';
import Log, { learnMore } from '../../../log';
import { CredentialsContext } from '../../context';
import {
  ForbidCredentialModificationError,
  InsufficientAuthenticationNonInteractiveError,
} from '../../errors';
import { askForUserProvidedAsync } from '../../utils/promptForCredentials';
import { AppleProvisioningProfileMutationResult } from '../api/graphql/mutations/AppleProvisioningProfileMutation';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';
import { ProvisioningProfile } from '../appstore/Credentials.types';
import { AuthCtx, AuthenticationMode } from '../appstore/authenticateTypes';
import { provisioningProfileSchema } from '../credentials';
import { Target } from '../types';

export class CreateProvisioningProfile {
  constructor(
    private readonly app: AppLookupParams,
    private readonly target: Target,
    private readonly distributionCertificate: AppleDistributionCertificateFragment
  ) {}

  async runAsync(ctx: CredentialsContext): Promise<AppleProvisioningProfileMutationResult> {
    if (ctx.freezeCredentials) {
      throw new ForbidCredentialModificationError(
        'Run this command again without the --freeze-credentials flag in order to generate a new Provisioning Profile.'
      );
    } else if (
      ctx.nonInteractive &&
      ctx.appStore.defaultAuthenticationMode !== AuthenticationMode.API_KEY
    ) {
      throw new InsufficientAuthenticationNonInteractiveError(
        `In order to generate a new Provisioning Profile, authentication with an ASC API key is required in non-interactive mode. ${learnMore(
          'https://docs.expo.dev/build/building-on-ci/#optional-provide-an-asc-api-token-for-your-apple-team'
        )}`
      );
    }
    const appleAuthCtx = await ctx.appStore.ensureAuthenticatedAsync();
    const provisioningProfile = await this.provideOrGenerateAsync(ctx, appleAuthCtx);
    const appleTeam = nullthrows(await resolveAppleTeamIfAuthenticatedAsync(ctx, this.app));
    const appleAppIdentifier = await ctx.ios.createOrGetExistingAppleAppIdentifierAsync(
      ctx.graphqlClient,
      this.app,
      appleTeam
    );
    const provisioningProfileMutationResult = await ctx.ios.createProvisioningProfileAsync(
      ctx.graphqlClient,
      this.app,
      appleAppIdentifier,
      {
        appleProvisioningProfile: provisioningProfile.provisioningProfile,
        developerPortalIdentifier: provisioningProfile.provisioningProfileId,
      }
    );
    Log.succeed('Created provisioning profile');
    return provisioningProfileMutationResult;
  }

  private async maybeGetUserProvidedAsync(
    ctx: CredentialsContext
  ): Promise<ProvisioningProfile | null> {
    if (ctx.nonInteractive) {
      return null;
    }
    const userProvided = await askForUserProvidedAsync(provisioningProfileSchema);
    if (userProvided) {
      // userProvided profiles don't come with ProvisioningProfileId's (only accessible from Apple Portal API)
      Log.warn('Provisioning profile: Unable to validate specified profile.');
      return userProvided;
    }
    return null;
  }

  private async provideOrGenerateAsync(
    ctx: CredentialsContext,
    appleAuthCtx: AuthCtx
  ): Promise<ProvisioningProfile> {
    const maybeUserProvided = await this.maybeGetUserProvidedAsync(ctx);
    if (maybeUserProvided) {
      // userProvided profiles don't come with ProvisioningProfileId's (only accessible from Apple Portal API)
      Log.warn('Provisioning profile: Unable to validate specified profile.');
      return maybeUserProvided;
    }
    assert(
      this.distributionCertificate.certificateP12,
      'Distribution Certificate must have p12 certificate'
    );
    assert(
      this.distributionCertificate.certificatePassword,
      'Distribution Certificate must have certificate password'
    );
    return await generateProvisioningProfileAsync(ctx, this.target, this.app.bundleIdentifier, {
      certId: this.distributionCertificate.developerPortalIdentifier ?? undefined,
      certP12: this.distributionCertificate.certificateP12,
      certPassword: this.distributionCertificate.certificatePassword,
      distCertSerialNumber: this.distributionCertificate.serialNumber,
      teamId: this.distributionCertificate.appleTeam?.appleTeamIdentifier ?? appleAuthCtx.team.id,
    });
  }
}
