import assert from 'assert';
import chalk from 'chalk';

import log from '../../../log';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import {
  DistributionCertificate,
  ProvisioningProfileStoreInfo,
} from '../appstore/Credentials.types';
import { AppLookupParams } from '../credentials';
import { selectProvisioningProfileFromAppleAsync } from './ProvisioningProfileUtils';

export class UseExistingProvisioningProfile implements Action {
  constructor(private app: AppLookupParams) {}

  public async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const selected = await selectProvisioningProfileFromAppleAsync(ctx, this.app.bundleIdentifier);
    if (selected) {
      const distCert = await ctx.ios.getDistributionCertificateAsync(this.app);
      assert(distCert, 'missing distribution certificate');

      await manager.runActionAsync(new ConfigureProvisioningProfile(this.app));
    }
  }
}

export class ConfigureProvisioningProfile implements Action {
  constructor(private app: AppLookupParams) {}

  public async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const profile = await ctx.ios.getProvisioningProfileAsync(this.app);
    if (!profile) {
      throw new Error('No provisioning profile to configure');
    }

    if (!profile.provisioningProfileId) {
      log.warn("The provisioning profile we have on file cannot be validated on Apple's servers.");
      return;
    }

    if (ctx.appStore.authCtx) {
      const distCert = await ctx.ios.getDistributionCertificateAsync(this.app);
      if (!distCert) {
        log.warn('There is no distribution certificate for this app.');
        return;
      }
      const profilesFromApple = await ctx.appStore.listProvisioningProfilesAsync(
        this.app.bundleIdentifier
      );
      const profilesWithMatchingId = profilesFromApple.filter(
        appleInfo => appleInfo.provisioningProfileId === profile.provisioningProfileId
      );
      if (!profilesWithMatchingId || profilesWithMatchingId.length < 1) {
        log.warn('This profile is no longer valid on Apple Developer Portal.');
      }

      await this.configureAndUpdateAsync(ctx, this.app, distCert, profilesWithMatchingId[0]);
    } else {
      log.warn(
        "Without access to your Apple account we can't configure provisioning profiles for you."
      );
      log.warn('Make sure to recreate the profile if you selected a new distribution certificate.');
    }
  }

  private async configureAndUpdateAsync(
    ctx: Context,
    app: AppLookupParams,
    distCert: DistributionCertificate,
    profileFromApple: ProvisioningProfileStoreInfo
  ) {
    // configure profile on Apple's Server to use our distCert
    const updatedProfile = await ctx.appStore.useExistingProvisioningProfileAsync(
      app.bundleIdentifier,
      profileFromApple,
      distCert
    );
    const certIdTag = distCert.certId ? ` (${distCert.certId})` : '';
    log(
      chalk.green(
        `Updated Apple provisioning profile (${profileFromApple.provisioningProfileId}) with distribution certificate${certIdTag}`
      )
    );

    // Update profile on expo servers
    await ctx.ios.updateProvisioningProfileAsync(app, updatedProfile);
    log(
      chalk.green(
        `Updated provisioning profile for @${app.accountName}/${app.projectName} (${app.bundleIdentifier})`
      )
    );
  }
}
