import { DistributionType, IosEnterpriseProvisioning } from '@expo/eas-json';

import {
  IosDistributionType as GraphQLIosDistributionType,
  IosAppBuildCredentialsFragment,
} from '../../../graphql/generated';
import Log from '../../../log';
import { Action, Context } from '../../context';
import { AppLookupParams as GraphQLAppLookupParams } from '../api/GraphqlClient';
import { IosCapabilitiesOptions } from '../appstore/ensureAppExists';
import { SetupAdhocProvisioningProfile } from './SetupAdhocProvisioningProfile';
import { SetupInternalProvisioningProfile } from './SetupInternalProvisioningProfile';
import { SetupProvisioningProfile } from './SetupProvisioningProfile';

interface Options {
  app: GraphQLAppLookupParams;
  distribution: DistributionType;
  enterpriseProvisioning?: IosEnterpriseProvisioning;
  iosCapabilitiesOptions?: IosCapabilitiesOptions;
}
export class SetupTargetBuildCredentials implements Action<IosAppBuildCredentialsFragment> {
  constructor(private options: Options) {}

  async runAsync(ctx: Context): Promise<IosAppBuildCredentialsFragment> {
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
      return await this.setupBuildCredentials(ctx);
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
