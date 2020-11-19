import chalk from 'chalk';

import log from '../../../log';
import { promptAsync } from '../../../prompts';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { readIosCredentialsAsync } from '../../credentialsJson/read';
import { AppLookupParams, IosAppCredentials } from '../credentials';
import { displayProjectCredentials } from '../utils/printCredentials';
import { readAppleTeam } from '../utils/provisioningProfile';
import { SetupProvisioningProfile } from './SetupProvisioningProfile';

export class SetupBuildCredentials implements Action {
  constructor(private app: AppLookupParams) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    await ctx.bestEffortAppStoreAuthenticateAsync();

    if (ctx.appStore.authCtx) {
      await ctx.appStore.ensureAppExistsAsync(this.app, { enablePushNotifications: true });
    }

    try {
      await manager.runActionAsync(new SetupProvisioningProfile(this.app));
    } catch (error) {
      log.error('Failed to prepare Provisioning Profile.');
      throw error;
    }

    const appInfo = `@${this.app.accountName}/${this.app.projectName} (${this.app.bundleIdentifier})`;
    displayProjectCredentials(
      this.app,
      await ctx.ios.getAppCredentialsAsync(this.app),
      undefined,
      await ctx.ios.getDistributionCertificateAsync(this.app)
    );
    log.newLine();
    log(chalk.green(`All credentials are ready to build ${appInfo}`));
    log.newLine();
  }
}

export class SetupBuildCredentialsFromCredentialsJson implements Action {
  constructor(private app: AppLookupParams) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    let localCredentials;
    try {
      localCredentials = await readIosCredentialsAsync(ctx.projectDir);
    } catch (error) {
      log.error(
        'Reading credentials from credentials.json failed. Make sure this file is correct and all credentials are present there.'
      );
      throw error;
    }

    const team = readAppleTeam(localCredentials.provisioningProfile);
    await ctx.ios.updateProvisioningProfileAsync(this.app, {
      ...team,
      provisioningProfile: localCredentials.provisioningProfile,
    });
    const credentials = await ctx.ios.getAllCredentialsAsync(this.app.accountName);
    const distCert = await ctx.ios.getDistributionCertificateAsync(this.app);
    const appsUsingCert = distCert?.id
      ? (credentials.appCredentials || []).filter(
          (cred: IosAppCredentials) => cred.distCredentialsId === distCert.id
        )
      : [];

    const appInfo = `@${this.app.accountName}/${this.app.projectName} (${this.app.bundleIdentifier})`;
    const newDistCert = {
      ...team,
      certP12: localCredentials.distributionCertificate.certP12,
      certPassword: localCredentials.distributionCertificate.certPassword,
    };

    if (appsUsingCert.length > 1 && distCert?.id) {
      const { update } = await promptAsync({
        type: 'select',
        name: 'update',
        message:
          'Current distribution certificate is used by multiple apps. Do you want to update all of them?',
        choices: [
          { title: 'Update all apps', value: 'all' },
          { title: `Update only ${appInfo}`, value: 'app' },
        ],
      });
      if (update === 'all') {
        await ctx.ios.updateDistributionCertificateAsync(
          distCert.id,
          this.app.accountName,
          newDistCert
        );
      } else {
        const createdDistCert = await ctx.ios.createDistributionCertificateAsync(
          this.app.accountName,
          newDistCert
        );
        await ctx.ios.useDistributionCertificateAsync(this.app, createdDistCert.id);
      }
    } else if (distCert?.id) {
      await ctx.ios.updateDistributionCertificateAsync(
        distCert.id,
        this.app.accountName,
        newDistCert
      );
    } else {
      const createdDistCert = await ctx.ios.createDistributionCertificateAsync(
        this.app.accountName,
        newDistCert
      );
      await ctx.ios.useDistributionCertificateAsync(this.app, createdDistCert.id);
    }

    displayProjectCredentials(
      this.app,
      await ctx.ios.getAppCredentialsAsync(this.app),
      undefined,
      await ctx.ios.getDistributionCertificateAsync(this.app)
    );
    log.newLine();
    log(chalk.green(`All credentials are ready to build ${appInfo}`));
    log.newLine();
  }
}
