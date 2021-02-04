import chalk from 'chalk';

import Log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { getAppLookupParams } from '../credentials';
import { displayIosUserCredentials } from '../utils/printCredentials';
import {
  provideOrGenerateDistributionCertificateAsync,
  selectDistributionCertificateAsync,
} from './DistributionCertificateUtils';
import { RemoveSpecificProvisioningProfile } from './RemoveProvisioningProfile';

export class UpdateDistributionCertificate implements Action {
  constructor(private accountName: string) {}

  public async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const selected = await selectDistributionCertificateAsync(ctx, this.accountName);
    if (!selected) {
      return;
    }
    const credentials = await ctx.ios.getAllCredentialsAsync(this.accountName);
    const apps = credentials.appCredentials.filter(cred => cred.distCredentialsId === selected.id);
    const appList = apps.map(appCred => chalk.green(appCred.experienceName)).join(', ');

    if (apps.length > 1) {
      if (ctx.nonInteractive) {
        throw new Error(
          `Start the CLI without the '--non-interactive' flag to update the certificate used by ${appList}.`
        );
      }

      const confirm = await confirmAsync({
        message: `You are updating certificate used by ${appList}. Do you want to continue?`,
      });
      if (!confirm) {
        Log.log('Aborting update process');
        return;
      }
    }

    await manager.runActionAsync(
      new UpdateSpecificDistributionCertificate(selected.id, this.accountName)
    );

    const newDistCert = await ctx.ios.getDistributionCertificateByIdAsync(
      selected.id,
      this.accountName
    );
    displayIosUserCredentials(newDistCert);
    Log.newLine();
  }
}

export class UpdateSpecificDistributionCertificate implements Action {
  constructor(private userCredentialsId: number | string, private accountName: string) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const credentials = await ctx.ios.getAllCredentialsAsync(this.accountName);
    const apps = credentials.appCredentials.filter(
      cred => cred.distCredentialsId === this.userCredentialsId
    );

    const newDistCert = await provideOrGenerateDistributionCertificateAsync(
      manager,
      ctx,
      this.accountName
    );
    await ctx.ios.updateDistributionCertificateAsync(
      this.userCredentialsId,
      this.accountName,
      newDistCert
    );
    Log.succeed('Updated distribution certificate');
    Log.newLine();

    for (const appCredentials of apps) {
      Log.log(
        `Removing provisioning profile for ${appCredentials.experienceName} (${appCredentials.bundleIdentifier})`
      );
      const appLookupParams = getAppLookupParams(
        appCredentials.experienceName,
        appCredentials.bundleIdentifier
      );
      await manager.runActionAsync(
        new RemoveSpecificProvisioningProfile(appLookupParams, { shouldRevoke: true })
      );
    }
  }
}
