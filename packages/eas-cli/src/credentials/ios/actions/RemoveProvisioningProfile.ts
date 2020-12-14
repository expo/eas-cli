import chalk from 'chalk';

import log from '../../../log';
import { confirmAsync } from '../../../prompts';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { AppLookupParams, getAppLookupParams } from '../credentials';
import { selectProvisioningProfileFromExpoAsync } from './ProvisioningProfileUtils';

interface RemoveOptions {
  shouldRevoke?: boolean;
}

export class RemoveProvisioningProfile implements Action {
  constructor(private accountName: string, private options: RemoveOptions = {}) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const selected = await selectProvisioningProfileFromExpoAsync(ctx, this.accountName);
    if (selected) {
      const app = getAppLookupParams(selected.experienceName, selected.bundleIdentifier);
      await manager.runActionAsync(new RemoveSpecificProvisioningProfile(app, this.options));
    }
  }
}

interface RemoveSpecificOptions {
  shouldRevoke?: boolean;
}

export class RemoveSpecificProvisioningProfile implements Action {
  constructor(private app: AppLookupParams, private options: RemoveSpecificOptions = {}) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    await ctx.ios.deleteProvisioningProfileAsync(this.app);
    log(
      chalk.green(
        `Removed provisioning profile for @${this.app.accountName}/${this.app.projectName} (${this.app.bundleIdentifier})`
      )
    );

    let { shouldRevoke } = this.options;
    if (!shouldRevoke && !ctx.nonInteractive) {
      shouldRevoke = await confirmAsync({
        message: 'Do you also want to revoke this provisioning profile on Apple Developer Portal?',
      });
    }

    if (shouldRevoke) {
      await ctx.appStore.revokeProvisioningProfileAsync(this.app.bundleIdentifier);
    }
  }
}
