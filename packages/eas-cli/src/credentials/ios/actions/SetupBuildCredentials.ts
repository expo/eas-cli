import chalk from 'chalk';

import log from '../../../log';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { AppLookupParams } from '../credentials';
import { displayProjectCredentials } from '../utils/printCredentials';
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
