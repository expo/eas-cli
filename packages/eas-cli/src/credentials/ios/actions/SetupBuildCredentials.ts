import { IosDistributionType, IosEnterpriseProvisioning } from '@expo/eas-json';
import chalk from 'chalk';
import nullthrows from 'nullthrows';

import {
  IosDistributionType as GraphQLIosDistributionType,
  IosAppBuildCredentialsFragment,
} from '../../../graphql/generated';
import Log from '../../../log';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { AppLookupParams as GraphQLAppLookupParams } from '../api/GraphqlClient';
import { IosCapabilitiesOptions } from '../appstore/ensureAppExists';
import { displayProjectCredentials } from '../utils/printCredentials';
import { SetupAdhocProvisioningProfile } from './SetupAdhocProvisioningProfile';
import { SetupInternalProvisioningProfile } from './SetupInternalProvisioningProfile';
import { SetupProvisioningProfile } from './SetupProvisioningProfile';

interface Options {
  app: GraphQLAppLookupParams;
  distribution: IosDistributionType;
  enterpriseProvisioning?: IosEnterpriseProvisioning;
  iosCapabilitiesOptions?: IosCapabilitiesOptions;
}

interface IosAppBuildCredentials {
  iosDistributionType: GraphQLIosDistributionType;
  provisioningProfile: string;
  distributionCertificate: {
    certificateP12: string;
    certificatePassword: string;
  };
}

export class SetupBuildCredentials implements Action<IosAppBuildCredentials> {
  constructor(private options: Options) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<IosAppBuildCredentials> {
    const { app, iosCapabilitiesOptions } = this.options;

    await ctx.bestEffortAppStoreAuthenticateAsync();

    if (ctx.appStore.authCtx) {
      await ctx.appStore.ensureBundleIdExistsAsync(
        {
          accountName: app.account.name,
          bundleIdentifier: app.bundleIdentifier,
          projectName: app.projectName,
        },
        iosCapabilitiesOptions
      );
    }
    try {
      const buildCredentials = await this.setupBuildCredentials(ctx);
      const appInfo = `@${app.account.name}/${app.projectName} (${app.bundleIdentifier})`;
      displayProjectCredentials(app, buildCredentials);
      Log.newLine();
      Log.log(chalk.green(`All credentials are ready to build ${appInfo}`));
      Log.newLine();
      return {
        iosDistributionType: buildCredentials.iosDistributionType,
        provisioningProfile: nullthrows(buildCredentials.provisioningProfile?.provisioningProfile),
        distributionCertificate: {
          certificateP12: nullthrows(buildCredentials.distributionCertificate?.certificateP12),
          certificatePassword: nullthrows(
            buildCredentials.distributionCertificate?.certificatePassword
          ),
        },
      };
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
        return await new SetupProvisioningProfile(
          app,
          GraphQLIosDistributionType.Enterprise
        ).runAsync(ctx);
      } else {
        return await new SetupInternalProvisioningProfile(app).runAsync(ctx);
      }
    } else {
      return await new SetupProvisioningProfile(app, GraphQLIosDistributionType.AppStore).runAsync(
        ctx
      );
    }
  }
}
