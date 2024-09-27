import { selectDistributionCertificateWithDependenciesAsync } from './DistributionCertificateUtils';
import { RemoveProvisioningProfiles } from './RemoveProvisioningProfile';
import {
  AccountFragment,
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileIdentifiersFragment,
} from '../../../graphql/generated';
import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { CredentialsContext } from '../../context';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';

export class SelectAndRemoveDistributionCertificate {
  constructor(private readonly account: AccountFragment) {}

  async runAsync(ctx: CredentialsContext): Promise<void> {
    const selected = await selectDistributionCertificateWithDependenciesAsync(ctx, this.account);
    if (selected) {
      await new RemoveDistributionCertificate(this.account, selected).runAsync(ctx);
      Log.succeed('Removed distribution certificate');
      Log.newLine();
    }
  }
}

export class RemoveDistributionCertificate {
  constructor(
    private readonly account: AccountFragment,
    private readonly distributionCertificate: AppleDistributionCertificateFragment
  ) {}

  public async runAsync(ctx: CredentialsContext): Promise<void> {
    const apps = this.distributionCertificate.iosAppBuildCredentialsList.map(
      buildCredentials => buildCredentials.iosAppCredentials.app
    );
    if (apps.length !== 0) {
      // iosAppBuildCredentialsList is capped at 20 on www
      const appFullNames = apps
        .map(app => app.fullName)
        .slice(0, 19)
        .join(',');
      const andMaybeMore = apps.length > 19 ? ' (and more)' : '';

      if (ctx.nonInteractive) {
        throw new Error(
          `Certificate is currently used by ${appFullNames}${andMaybeMore} and cannot be deleted in non-interactive mode.`
        );
      }
      const confirm = await confirmAsync({
        message: `You are removing certificate used by ${appFullNames}${andMaybeMore}. Do you want to continue?`,
      });
      if (!confirm) {
        Log.log('Aborting');
        return;
      }
    }

    Log.log('Removing Distribution Certificate');
    await ctx.ios.deleteDistributionCertificateAsync(
      ctx.graphqlClient,
      this.distributionCertificate.id
    );

    if (this.distributionCertificate.developerPortalIdentifier) {
      let shouldRevoke = false;
      if (!ctx.nonInteractive) {
        shouldRevoke = await confirmAsync({
          message: `Do you also want to revoke this Distribution Certificate on Apple Developer Portal?`,
        });
      } else if (ctx.nonInteractive) {
        Log.log('Skipping certificate revocation on the Apple Developer Portal.');
      }
      if (shouldRevoke) {
        await ctx.appStore.revokeDistributionCertificateAsync([
          this.distributionCertificate.developerPortalIdentifier,
        ]);
      }
    }

    await this.removeInvalidProvisioningProfilesAsync(ctx);
  }

  private async removeInvalidProvisioningProfilesAsync(ctx: CredentialsContext): Promise<void> {
    const buildCredentialsList = this.distributionCertificate.iosAppBuildCredentialsList;
    const appsWithProfilesToRemove: AppLookupParams[] = [];
    const profilesToRemove: AppleProvisioningProfileIdentifiersFragment[] = [];
    for (const buildCredentials of buildCredentialsList) {
      const projectName = buildCredentials.iosAppCredentials.app.slug;
      const { bundleIdentifier } = buildCredentials.iosAppCredentials.appleAppIdentifier;
      const appLookupParams = { account: this.account, projectName, bundleIdentifier };
      const maybeProvisioningProfile = buildCredentials.provisioningProfile;
      if (maybeProvisioningProfile) {
        appsWithProfilesToRemove.push(appLookupParams);
        profilesToRemove.push(maybeProvisioningProfile);
      }
    }
    await new RemoveProvisioningProfiles(appsWithProfilesToRemove, profilesToRemove).runAsync(ctx);
  }
}
