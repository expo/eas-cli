import assert from 'assert';
import chalk from 'chalk';

import log from '../../../log';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { askForUserProvidedAsync } from '../../utils/promptForCredentials';
import { ProvisioningProfile } from '../appstore/Credentials.types';
import { AppLookupParams, provisioningProfileSchema } from '../credentials';
import { displayIosAppCredentials } from '../utils/printCredentials';
import { generateProvisioningProfileAsync } from './ProvisioningProfileUtils';

export class CreateProvisioningProfileStandaloneManager implements Action {
  constructor(private app: AppLookupParams) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    await manager.runActionAsync(new CreateProvisioningProfile(this.app));

    const appCredentials = await ctx.ios.getAppCredentialsAsync(this.app);
    displayIosAppCredentials(appCredentials);
    log.newLine();
  }
}

export class CreateProvisioningProfile implements Action {
  constructor(private app: AppLookupParams) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const provisioningProfile = await this.provideOrGenerateAsync(ctx);
    await ctx.ios.updateProvisioningProfileAsync(this.app, provisioningProfile);

    log(chalk.green('Successfully created Provisioning Profile.'));
  }

  private async provideOrGenerateAsync(ctx: Context): Promise<ProvisioningProfile> {
    if (!ctx.nonInteractive) {
      const userProvided = await askForUserProvidedAsync(provisioningProfileSchema);
      if (userProvided) {
        // userProvided profiles don't come with ProvisioningProfileId's (only accessible from Apple Portal API)
        log.warn('Provisioning profile: Unable to validate specified profile.');
        return userProvided;
      }
    }
    const distCert = await ctx.ios.getDistributionCertificateAsync(this.app);
    assert(distCert, 'missing distribution certificate');
    return await generateProvisioningProfileAsync(ctx, this.app.bundleIdentifier, distCert);
  }
}
