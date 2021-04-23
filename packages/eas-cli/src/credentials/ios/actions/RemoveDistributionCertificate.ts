import {
  AppleDistributionCertificateFragment,
  AppleProvisioningProfileIdentifiersFragment,
} from '../../../graphql/generated';
import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { Account } from '../../../user/Account';
import { Context } from '../../context';
import { AppLookupParams } from '../api/GraphqlClient';
import { selectDistributionCertificateWithDependenciesAsync } from './DistributionCertificateUtils';
import { RemoveProvisioningProfiles } from './RemoveProvisioningProfile';

export class SelectAndRemoveDistributionCertificate {
  constructor(private account: Account) {}

  async runAsync(ctx: Context): Promise<void> {
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
    private account: Account,
    private distributionCertificate: AppleDistributionCertificateFragment
  ) {}

  public async runAsync(ctx: Context): Promise<void> {
    const apps = this.distributionCertificate.iosAppBuildCredentialsList.map(
      buildCredentials => buildCredentials.iosAppCredentials.app
    );
    if (apps.length !== 0) {
      const appFullNames = apps.map(app => app.fullName).join(',');
      if (ctx.nonInteractive) {
        throw new Error(
          `Certificate is currently used by ${appFullNames} and cannot be deleted in non-interactive mode.`
        );
      }
      const confirm = await confirmAsync({
        message: `You are removing certificate used by ${appFullNames}. Do you want to continue?`,
      });
      if (!confirm) {
        Log.log('Aborting');
        return;
      }
    }

    Log.log('Removing Distribution Certificate');
    await ctx.ios.deleteDistributionCertificateAsync(this.distributionCertificate.id);

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

  private async removeInvalidProvisioningProfilesAsync(ctx: Context): Promise<void> {
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
