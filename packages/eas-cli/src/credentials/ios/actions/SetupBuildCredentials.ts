import { DistributionType } from '@expo/eas-json';
import assert from 'assert';
import chalk from 'chalk';

import { AppleDevice, IosAppBuildCredentials } from '../../../graphql/generated';
import log from '../../../log';
import { promptAsync } from '../../../prompts';
import { findAccountByName } from '../../../user/Account';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { readIosCredentialsAsync } from '../../credentialsJson/read';
import { AppLookupParams, IosAppCredentials, IosDistCredentials } from '../credentials';
import { displayProjectCredentials } from '../utils/printCredentials';
import { readAppleTeam } from '../utils/provisioningProfile';
import { SetupProvisioningProfile } from './SetupProvisioningProfile';
import { SetupAdhocProvisioningProfile } from './new/SetupAdhocProvisioningProfile';

type AppCredentialsAndDistCert = {
  appCredentials: IosAppCredentials;
  distCert: IosDistCredentials | null;
};

export class SetupBuildCredentials implements Action {
  constructor(private app: AppLookupParams, private distribution: DistributionType) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    await ctx.bestEffortAppStoreAuthenticateAsync();

    if (ctx.appStore.authCtx) {
      await ctx.appStore.ensureAppExistsAsync(this.app, { enablePushNotifications: true });
    }

    let iosAppBuildCredentials: IosAppBuildCredentials | null = null;
    try {
      if (this.distribution === DistributionType.INTERNAL) {
        // todo(cedric): check if we can make `meActor.accounts` a non-nullable array (or always a non-nullable array)
        const account = findAccountByName(ctx.user.accounts ?? [], this.app.accountName);
        if (!account) {
          throw new Error(`You do not have access to the ${this.app.accountName} account`);
        }
        if (ctx.nonInteractive) {
          throw new Error('Internal distribution builds are not supported in non-interactive mode');
        }
        // for now, let's require the user to authenticate with Apple
        await ctx.appStore.ensureAuthenticatedAsync();
        const action = new SetupAdhocProvisioningProfile({
          account,
          projectName: this.app.projectName,
          bundleIdentifier: this.app.bundleIdentifier,
        });
        await manager.runActionAsync(action);
        iosAppBuildCredentials = action.iosAppBuildCredentials;
      } else {
        await manager.runActionAsync(new SetupProvisioningProfile(this.app));
      }
    } catch (error) {
      log.error('Failed to setup credentials.');
      throw error;
    }

    const { appCredentials, distCert } = await this.unifyCredentialsFormatAsync(
      ctx,
      iosAppBuildCredentials
    );
    const appInfo = `@${this.app.accountName}/${this.app.projectName} (${this.app.bundleIdentifier})`;
    displayProjectCredentials(this.app, appCredentials, /* pushKey */ null, distCert);
    log.newLine();
    log(chalk.green(`All credentials are ready to build ${appInfo}`));
    log.newLine();
  }

  async unifyCredentialsFormatAsync(
    ctx: Context,
    iosAppBuildCredentials: IosAppBuildCredentials | null
  ): Promise<AppCredentialsAndDistCert> {
    if (!iosAppBuildCredentials) {
      const [appCredentials, distCert] = await Promise.all([
        ctx.ios.getAppCredentialsAsync(this.app),
        ctx.ios.getDistributionCertificateAsync(this.app),
      ]);
      return {
        appCredentials,
        distCert,
      };
    } else {
      const { distributionCertificate, provisioningProfile } = iosAppBuildCredentials;
      assert(distributionCertificate && provisioningProfile);
      return {
        appCredentials: {
          experienceName: `${this.app.accountName}/${this.app.projectName}`,
          bundleIdentifier: this.app.bundleIdentifier,
          credentials: {
            provisioningProfile: provisioningProfile.provisioningProfile ?? undefined,
            provisioningProfileId: provisioningProfile.developerPortalIdentifier ?? undefined,
            teamId: provisioningProfile.appleTeam?.appleTeamIdentifier || '',
            teamName: provisioningProfile.appleTeam?.appleTeamName ?? undefined,
            devices: provisioningProfile.appleDevices?.filter(device => device) as
              | AppleDevice[]
              | undefined,
          },
        },
        distCert: {
          // the id doesn't really matter, it's only for displaying credentials
          id: null as any,
          type: 'dist-cert',
          certId: distributionCertificate.developerPortalIdentifier ?? undefined,
          certP12: distributionCertificate.certificateP12 ?? '',
          certPassword: distributionCertificate.certificatePassword ?? '',
          teamId: distributionCertificate.appleTeam?.appleTeamIdentifier || '',
          teamName: distributionCertificate.appleTeam?.appleTeamName ?? undefined,
        },
      };
    }
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
