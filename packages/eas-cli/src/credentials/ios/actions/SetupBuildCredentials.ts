import { IosEnterpriseProvisioning, iOSDistributionType } from '@expo/eas-json';
import chalk from 'chalk';

import { IosAppBuildCredentialsFragment, IosDistributionType } from '../../../graphql/generated';
import Log from '../../../log';
import { promptAsync } from '../../../prompts';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { isCredentialsMap, readIosCredentialsAsync } from '../../credentialsJson/read';
import { AppLookupParams as GraphQLAppLookupParams } from '../api/GraphqlClient';
import { AppLookupParams, IosAppCredentials } from '../credentials';
import { displayProjectCredentials as legacyDisplayProjectCredentials } from '../utils/printCredentials';
import { displayProjectCredentials } from '../utils/printCredentialsBeta';
import { readAppleTeam } from '../utils/provisioningProfile';
import { SetupAdhocProvisioningProfile } from './new/SetupAdhocProvisioningProfile';
import { SetupInternalProvisioningProfile } from './new/SetupInternalProvisioningProfile';
import { SetupProvisioningProfile } from './new/SetupProvisioningProfile';

interface Options {
  app: GraphQLAppLookupParams;
  distribution: iOSDistributionType;
  enterpriseProvisioning?: IosEnterpriseProvisioning;
  skipCredentialsCheck?: boolean;
}

export class SetupBuildCredentials implements Action {
  constructor(private options: Options) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    const { app } = this.options;

    await ctx.bestEffortAppStoreAuthenticateAsync();

    if (ctx.appStore.authCtx) {
      await ctx.appStore.ensureBundleIdExistsAsync(
        {
          accountName: app.account.name,
          bundleIdentifier: app.bundleIdentifier,
          projectName: app.projectName,
        },
        { enablePushNotifications: true }
      );
    }
    try {
      const buildCredentials = await this.setupBuildCredentials(ctx);

      const appInfo = `@${app.account.name}/${app.projectName} (${app.bundleIdentifier})`;
      displayProjectCredentials(app, buildCredentials);
      Log.newLine();
      Log.log(chalk.green(`All credentials are ready to build ${appInfo}`));
      Log.newLine();
    } catch (error) {
      Log.error('Failed to setup credentials.');
      throw error;
    }
  }

  async setupBuildCredentials(ctx: Context): Promise<IosAppBuildCredentialsFragment> {
    const { app, distribution, enterpriseProvisioning } = this.options;
    if (distribution === 'internal') {
      if (enterpriseProvisioning === 'adhoc') {
        return await new SetupAdhocProvisioningProfile(app).runAsync(ctx);
      } else if (enterpriseProvisioning === 'universal') {
        return await new SetupProvisioningProfile(app, IosDistributionType.Enterprise).runAsync(
          ctx
        );
      } else {
        return await new SetupInternalProvisioningProfile(app).runAsync(ctx);
      }
    } else {
      return await new SetupProvisioningProfile(app, IosDistributionType.AppStore).runAsync(ctx);
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
