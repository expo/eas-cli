import { AppleDistributionCertificateFragment } from '../../../../graphql/generated';
import log from '../../../../log';
import { confirmAsync } from '../../../../prompts';
import { Account } from '../../../../user/Account';
import { Action, CredentialsManager } from '../../../CredentialsManager';
import { Context } from '../../../context';
import { selectDistributionCertificateWithDependenciesAsync } from './DistributionCertificateUtils';
import { RemoveProvisioningProfiles } from './RemoveProvisioningProfile';

export class SelectAndRemoveDistributionCertificate implements Action {
  constructor(private account: Account) {}

  async runAsync(_manager: CredentialsManager, ctx: Context): Promise<void> {
    const selected = await selectDistributionCertificateWithDependenciesAsync(ctx, this.account);
    if (selected) {
      await new RemoveDistributionCertificate(this.account, selected).runAsync(ctx);
      log.succeed('Removed distribution certificate');
      log.newLine();
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
    if (apps.length !== 0 && !ctx.nonInteractive) {
      const appFullNames = apps.map(app => app.fullName).join(',');
      const confirm = await confirmAsync({
        message: `You are removing certificate used by ${appFullNames}. Do you want to continue?`,
      });
      if (!confirm) {
        log('Aborting');
        return;
      }
    }

    log('Removing Distribution Certificate');
    await ctx.newIos.deleteDistributionCertificateAsync(this.distributionCertificate.id);

    if (this.distributionCertificate.developerPortalIdentifier) {
      let shouldRevoke = false;
      if (!ctx.nonInteractive) {
        shouldRevoke = await confirmAsync({
          message: `Do you also want to revoke this Distribution Certificate on Apple Developer Portal?`,
        });
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
    const appsWithProfilesToRemove = [];
    const profilesToRemove = [];
    for (const buildCredentials of buildCredentialsList) {
      const projectSlug = buildCredentials.iosAppCredentials.app.slug;
      const bundleIdentifier =
        buildCredentials.iosAppCredentials.appleAppIdentifier.bundleIdentifier;
      const appLookupParams = { account: this.account, projectName: projectSlug, bundleIdentifier };
      const maybeProvisioningProfile = buildCredentials.provisioningProfile;
      if (maybeProvisioningProfile) {
        appsWithProfilesToRemove.push(appLookupParams);
        profilesToRemove.push(maybeProvisioningProfile);
      }
    }
    await new RemoveProvisioningProfiles(appsWithProfilesToRemove, profilesToRemove).runAsync(ctx);
  }
}
