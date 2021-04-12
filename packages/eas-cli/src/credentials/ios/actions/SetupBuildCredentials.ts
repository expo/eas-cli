import { iOSDistributionType } from '@expo/eas-json';
import chalk from 'chalk';

import { IosAppBuildCredentialsFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { promptAsync } from '../../../prompts';
import { findAccountByName } from '../../../user/Account';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { isCredentialsMap, readIosCredentialsAsync } from '../../credentialsJson/read';
import { AppLookupParams as GraphQLAppLookupParams } from '../api/GraphqlClient';
import { AppLookupParams, IosAppCredentials } from '../credentials';
import { displayProjectCredentials as legacyDisplayProjectCredentials } from '../utils/printCredentials';
import { displayProjectCredentials } from '../utils/printCredentialsBeta';
import { readAppleTeam } from '../utils/provisioningProfile';
import { SetupAdhocProvisioningProfile } from './new/SetupAdhocProvisioningProfile';
import { SetupProvisioningProfile } from './new/SetupProvisioningProfile';

export class SetupBuildCredentials implements Action {
  constructor(private app: AppLookupParams, private distribution: iOSDistributionType) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    await ctx.bestEffortAppStoreAuthenticateAsync();

    if (ctx.appStore.authCtx) {
      await ctx.appStore.ensureBundleIdExistsAsync(this.app, { enablePushNotifications: true });
    }

    let iosAppBuildCredentials: IosAppBuildCredentialsFragment | null = null;
    try {
      const account = findAccountByName(ctx.user.accounts, this.app.accountName);
      if (!account) {
        throw new Error(`You do not have access to the ${this.app.accountName} account`);
      }
      const appLookupParams: GraphQLAppLookupParams = {
        account,
        projectName: this.app.projectName,
        bundleIdentifier: this.app.bundleIdentifier,
      };
      if (this.distribution === 'internal') {
        iosAppBuildCredentials = await new SetupAdhocProvisioningProfile(appLookupParams).runAsync(
          ctx
        );
      } else {
        iosAppBuildCredentials = await new SetupProvisioningProfile(appLookupParams).runAsync(ctx);
      }

      const appInfo = `@${this.app.accountName}/${this.app.projectName} (${this.app.bundleIdentifier})`;
      displayProjectCredentials(appLookupParams, iosAppBuildCredentials);
      Log.newLine();
      Log.log(chalk.green(`All credentials are ready to build ${appInfo}`));
      Log.newLine();
    } catch (error) {
      Log.error('Failed to setup credentials.');
      throw error;
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
      Log.error(
        'Reading credentials from credentials.json failed. Make sure this file is correct and all credentials are present there.'
      );
      throw error;
    }

    // TODO: implement storing multi-target credentials on EAS servers
    if (isCredentialsMap(localCredentials)) {
      throw new Error(
        'Storing multi-target iOS credentials from credentials.json on EAS servers is not yet supported.'
      );
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

    legacyDisplayProjectCredentials(
      this.app,
      await ctx.ios.getAppCredentialsAsync(this.app),
      undefined,
      await ctx.ios.getDistributionCertificateAsync(this.app)
    );
    Log.newLine();
    Log.log(chalk.green(`All credentials are ready to build ${appInfo}`));
    Log.newLine();
  }
}
