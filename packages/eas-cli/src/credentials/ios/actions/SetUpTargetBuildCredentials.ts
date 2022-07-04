import { DistributionType, IosEnterpriseProvisioning } from '@expo/eas-json';
import { JSONObject } from '@expo/json-file';

import {
  IosDistributionType as GraphQLIosDistributionType,
  IosAppBuildCredentialsFragment,
} from '../../../graphql/generated.js';
import Log from '../../../log.js';
import { CredentialsContext } from '../../context.js';
import { AppLookupParams as GraphQLAppLookupParams } from '../api/GraphqlClient.js';
import { SetUpAdhocProvisioningProfile } from './SetUpAdhocProvisioningProfile.js';
import { SetUpInternalProvisioningProfile } from './SetUpInternalProvisioningProfile.js';
import { SetUpProvisioningProfile } from './SetUpProvisioningProfile.js';

interface Options {
  app: GraphQLAppLookupParams;
  distribution: DistributionType;
  enterpriseProvisioning?: IosEnterpriseProvisioning;
  entitlements: JSONObject;
}
export class SetUpTargetBuildCredentials {
  constructor(private options: Options) {}

  async runAsync(ctx: CredentialsContext): Promise<IosAppBuildCredentialsFragment> {
    const { app, entitlements } = this.options;

    await ctx.bestEffortAppStoreAuthenticateAsync();

    if (ctx.appStore.authCtx) {
      await ctx.appStore.ensureBundleIdExistsAsync(
        {
          accountName: app.account.name,
          bundleIdentifier: app.bundleIdentifier,
          projectName: app.projectName,
        },
        { entitlements }
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
