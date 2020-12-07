import assert from 'assert';
import pick from 'lodash/pick';

import log from '../../../log';
import { confirmAsync, promptAsync } from '../../../prompts';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { ProvisioningProfileStoreInfo } from '../appstore/Credentials.types';
import { AppLookupParams, IosDistCredentials } from '../credentials';
import {
  validateProvisioningProfileAsync,
  validateProvisioningProfileWithoutApple,
} from '../validators/validateProvisioningProfile';
import {
  ConfigureProvisioningProfile,
  UseExistingProvisioningProfile,
} from './ConfigureProvisioningProfile';
import { CreateProvisioningProfile } from './CreateProvisioningProfile';
import { formatProvisioningProfileFromApple } from './ProvisioningProfileUtils';
import { SetupDistributionCertificateForApp } from './SetupDistributionCertificate';

export class SetupProvisioningProfile implements Action {
  constructor(private app: AppLookupParams) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    await manager.runActionAsync(new SetupDistributionCertificateForApp(this.app));
    if (await this.isCurrentProfileValidAsync(ctx)) {
      return;
    }

    if (ctx.nonInteractive) {
      throw new Error(
        'Provisioning Profile is not configured correctly. Please run this command again in interactive mode.'
      );
    }

    if (!ctx.appStore.authCtx) {
      manager.pushNextAction(new CreateProvisioningProfile(this.app));
      return;
    }

    const existingProfiles = await ctx.appStore.listProvisioningProfilesAsync(
      this.app.bundleIdentifier
    );

    if (existingProfiles.length === 0) {
      manager.pushNextAction(new CreateProvisioningProfile(this.app));
      return;
    }

    const distCert = await ctx.ios.getDistributionCertificateAsync(this.app);
    assert(distCert, 'missing Distribution Certificate');

    const autoselectedProfile = this.choosePreferred(existingProfiles, distCert);
    // autoselect credentials if we find valid certs

    if (!ctx.nonInteractive) {
      const confirm = await confirmAsync({
        message: `${formatProvisioningProfileFromApple(
          autoselectedProfile
        )} \n Would you like to use this profile?`,
      });
      if (!confirm) {
        await this.createOrReuseAsync(manager, ctx);
        return;
      }
    }

    log(`Using Provisioning Profile: ${autoselectedProfile.provisioningProfileId}`);
    await ctx.ios.updateProvisioningProfileAsync(
      this.app,
      pick(autoselectedProfile, [
        'provisioningProfile',
        'provisioningProfileId',
        'teamId',
        'teamName',
      ])
    );
    await manager.runActionAsync(new ConfigureProvisioningProfile(this.app));
  }

  private async isCurrentProfileValidAsync(ctx: Context): Promise<boolean> {
    const currentProfile = await ctx.ios.getProvisioningProfileAsync(this.app);
    const currentCertificate = await ctx.ios.getDistributionCertificateAsync(this.app);
    if (!currentProfile || !currentCertificate) {
      return false;
    }
    if (!ctx.appStore.authCtx || !currentProfile.provisioningProfileId) {
      if (!currentProfile.provisioningProfileId) {
        log.warn(
          "The provisioning profile we have on file cannot be validated on Apple's servers."
        );
      }
      const validationResult = validateProvisioningProfileWithoutApple(
        currentProfile,
        currentCertificate,
        this.app.bundleIdentifier
      );
      if (!validationResult.ok) {
        log.warn(validationResult.error);
        return false;
      }
      return true;
    }
    const validationResult = await validateProvisioningProfileAsync(
      ctx,
      currentProfile,
      currentCertificate,
      this.app.bundleIdentifier
    );
    if (!validationResult.ok) {
      log.warn(validationResult.error);
      return false;
    }
    return true;
  }

  private choosePreferred(
    profiles: ProvisioningProfileStoreInfo[],
    distCert: IosDistCredentials
  ): ProvisioningProfileStoreInfo {
    // prefer the profile that already has the same dist cert associated with it
    const profileWithSameCert = profiles.find(profile =>
      profile.certificates.some(cert => cert.id === distCert.certId)
    );

    // if not, just get an arbitrary profile
    return profileWithSameCert || profiles[0];
  }

  private async createOrReuseAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const { action } = await promptAsync({
      type: 'select',
      name: 'action',
      message: 'Select a Provisioning Profile:',
      choices: [
        {
          title: '[Choose existing provisioning profile] (Recommended)',
          value: 'CHOOSE_EXISTING',
        },
        { title: '[Add a new provisioning profile]', value: 'GENERATE' },
      ],
    });

    if (action === 'GENERATE') {
      manager.pushNextAction(new CreateProvisioningProfile(this.app));
    } else if (action === 'CHOOSE_EXISTING') {
      manager.pushNextAction(new UseExistingProvisioningProfile(this.app));
    }
  }
}
