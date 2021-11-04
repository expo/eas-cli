import { DistributionType, IosEnterpriseProvisioning } from '@expo/eas-json';

import {
  IosDistributionType as GraphQLIosDistributionType,
  IosAppBuildCredentialsFragment,
} from '../../../graphql/generated';
import Log from '../../../log';
import { CredentialsContext } from '../../context';
import { AppLookupParams as GraphQLAppLookupParams } from '../api/GraphqlClient';
import { IosCapabilitiesOptions } from '../appstore/ensureAppExists';
import { SetUpAdhocProvisioningProfile } from './SetUpAdhocProvisioningProfile';
import { SetUpInternalProvisioningProfile } from './SetUpInternalProvisioningProfile';
import { SetUpProvisioningProfile } from './SetUpProvisioningProfile';

interface Options {
  app: GraphQLAppLookupParams;
  distribution: DistributionType;
  enterpriseProvisioning?: IosEnterpriseProvisioning;
  iosCapabilitiesOptions?: IosCapabilitiesOptions;
}
export class SetUpTargetBuildCredentials {
  constructor(private options: Options) {}

  async runAsync(ctx: CredentialsContext): Promise<IosAppBuildCredentialsFragment> {
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
      return await this.setupBuildCredentialsAsync(ctx);
    } catch (error) {
      Log.error('Failed to set up credentials.');
      throw error;
    }
  }

  async setupBuildCredentialsAsync(
    ctx: CredentialsContext
  ): Promise<IosAppBuildCredentialsFragment> {
    const { app, distribution, enterpriseProvisioning } = this.options;
    if (distribution === 'internal') {
      if (enterpriseProvisioning === 'adhoc') {
        return await new SetUpAdhocProvisioningProfile(app).runAsync(ctx);
      } else if (enterpriseProvisioning === 'universal') {
        return await new SetUpProvisioningProfile(
          app,
          GraphQLIosDistributionType.Enterprise
        ).runAsync(ctx);
      } else {
        return await new SetUpInternalProvisioningProfile(app).runAsync(ctx);
      }
    } else {
      return await new SetUpProvisioningProfile(app, GraphQLIosDistributionType.AppStore).runAsync(
        ctx
      );
    }
  }
}
