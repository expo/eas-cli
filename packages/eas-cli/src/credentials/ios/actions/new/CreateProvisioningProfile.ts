import assert from 'assert';
import nullthrows from 'nullthrows';

import { AppleDistributionCertificateFragment } from '../../../../graphql/generated';
import Log from '../../../../log';
import { Action, CredentialsManager } from '../../../CredentialsManager';
import { Context } from '../../../context';
import { askForUserProvidedAsync } from '../../../utils/promptForCredentials';
import { AppLookupParams } from '../../api/GraphqlClient';
import { AppleProvisioningProfileMutationResult } from '../../api/graphql/mutations/AppleProvisioningProfileMutation';
import { ProvisioningProfile } from '../../appstore/Credentials.types';
import { AuthCtx } from '../../appstore/authenticate';
import { provisioningProfileSchema } from '../../credentials';
import { MissingCredentialsNonInteractiveError } from '../../errors';
import { generateProvisioningProfileAsync } from '../ProvisioningProfileUtils';
import { resolveAppleTeamIfAuthenticatedAsync } from './AppleTeamUtils';

export class CreateProvisioningProfile implements Action {
  private _provisioningProfile?: AppleProvisioningProfileMutationResult;
  constructor(
    private app: AppLookupParams,
    private distributionCertificate: AppleDistributionCertificateFragment
  ) {}

  public get provisioningProfile(): AppleProvisioningProfileMutationResult {
    assert(
      this._provisioningProfile,
      'provisioningProfile can be accessed only after calling .runAsync()'
    );
    return this._provisioningProfile;
  }

  async runAsync(_manager: CredentialsManager, ctx: Context): Promise<void> {
    if (ctx.nonInteractive) {
      throw new MissingCredentialsNonInteractiveError(
        'Creating Provisioning Profiles is only supported in interactive mode.'
      );
    }
    const appleAuthCtx = await ctx.appStore.ensureAuthenticatedAsync();
    const provisioningProfile = await this.provideOrGenerateAsync(ctx, appleAuthCtx);
    const appleTeam = nullthrows(await resolveAppleTeamIfAuthenticatedAsync(ctx, this.app));
    const appleAppIdentifier = await ctx.newIos.createOrGetExistingAppleAppIdentifierAsync(
      this.app,
      appleTeam
    );
    this._provisioningProfile = await ctx.newIos.createProvisioningProfileAsync(
      this.app,
      appleAppIdentifier,
      {
        appleProvisioningProfile: provisioningProfile.provisioningProfile,
        developerPortalIdentifier: provisioningProfile.provisioningProfileId,
      }
    );
    Log.succeed('Created provisioning profile');
  }

  private async provideOrGenerateAsync(
    ctx: Context,
    appleAuthCtx: AuthCtx
  ): Promise<ProvisioningProfile> {
    const userProvided = await askForUserProvidedAsync(provisioningProfileSchema);
    if (userProvided) {
      // userProvided profiles don't come with ProvisioningProfileId's (only accessible from Apple Portal API)
      Log.warn('Provisioning profile: Unable to validate specified profile.');
      return userProvided;
    }
    assert(
      this.distributionCertificate.certificateP12,
      'Distribution Certificate must have p12 certificate'
    );
    assert(
      this.distributionCertificate.certificatePassword,
      'Distribution Certificate must have certificate password'
    );
    return await generateProvisioningProfileAsync(ctx, this.app.bundleIdentifier, {
      certId: this.distributionCertificate.developerPortalIdentifier ?? undefined,
      certP12: this.distributionCertificate.certificateP12,
      certPassword: this.distributionCertificate.certificatePassword,
      distCertSerialNumber: this.distributionCertificate.serialNumber,
      teamId: this.distributionCertificate.appleTeam?.appleTeamIdentifier ?? appleAuthCtx.appleId,
    });
  }
}
