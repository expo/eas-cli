import chalk from 'chalk';

import log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { IosAppCredentials, getAppLookupParams } from '../credentials';
import { selectDistributionCertificateAsync } from './DistributionCertificateUtils';
import { RemoveSpecificProvisioningProfile } from './RemoveProvisioningProfile';

interface RemoveOptions {
  shouldRevoke?: boolean;
}

export class RemoveDistributionCertificate implements Action {
  constructor(private accountName: string, private options: RemoveOptions = {}) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const selected = await selectDistributionCertificateAsync(ctx, this.accountName);
    if (selected?.id) {
      await manager.runActionAsync(
        new RemoveSpecificDistributionCertificate(selected?.id, this.accountName, this.options)
      );
      log(chalk.green('Removed distribution certificate'));
      log.newLine();
    }
  }
}

interface RemoveSpecificOptions {
  shouldRevoke?: boolean;
}

export class RemoveSpecificDistributionCertificate implements Action {
  constructor(
    private userCredentialsId: number | string,
    private accountName: string,
    private options: RemoveSpecificOptions = {}
  ) {}

  public async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const distributionCertificate = await ctx.ios.getDistributionCertificateByIdAsync(
      this.userCredentialsId,
      this.accountName
    );
    const credentials = await ctx.ios.getAllCredentialsAsync(this.accountName);
    const apps = credentials.appCredentials.filter(
      cred => cred.distCredentialsId === this.userCredentialsId
    );
    const appList = apps.map(appCred => chalk.green(appCred.experienceName)).join(', ');

    if (appList && !ctx.nonInteractive) {
      const confirm = await confirmAsync({
        message: `You are removing certificate used by ${appList}. Do you want to continue?`,
      });
      if (!confirm) {
        log('Aborting');
        return;
      }
    }

    log('Removing Distribution Certificate');
    await ctx.ios.deleteDistributionCertificateAsync(this.userCredentialsId, this.accountName);

    let shouldRevoke = this.options.shouldRevoke;
    if (distributionCertificate.certId) {
      if (!shouldRevoke && !ctx.nonInteractive) {
        shouldRevoke = await confirmAsync({
          message: `Do you also want to revoke this Distribution Certificate on Apple Developer Portal?`,
        });
      }
      if (shouldRevoke) {
        await ctx.appStore.revokeDistributionCertificateAsync([distributionCertificate.certId]);
      }
    }

    await this.removeInvalidProvisioningProfilesAsync(manager, ctx, apps, shouldRevoke);
  }

  private async removeInvalidProvisioningProfilesAsync(
    manager: CredentialsManager,
    ctx: Context,
    apps: IosAppCredentials[],
    shouldRevoke?: boolean
  ) {
    for (const appCredentials of apps) {
      const appLookupParams = getAppLookupParams(
        appCredentials.experienceName,
        appCredentials.bundleIdentifier
      );
      if (!(await ctx.ios.getProvisioningProfileAsync(appLookupParams))) {
        continue;
      }
      log(
        `Removing Provisioning Profile for ${appCredentials.experienceName} (${appCredentials.bundleIdentifier})`
      );
      await manager.runActionAsync(
        new RemoveSpecificProvisioningProfile(appLookupParams, { shouldRevoke })
      );
    }
  }
}
