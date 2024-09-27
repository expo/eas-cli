import { DistributionType, IosEnterpriseProvisioning } from '@expo/eas-json';
import { JSONObject } from '@expo/json-file';

import { SetUpAdhocProvisioningProfile } from './SetUpAdhocProvisioningProfile';
import { SetUpInternalProvisioningProfile } from './SetUpInternalProvisioningProfile';
import { SetUpProvisioningProfile } from './SetUpProvisioningProfile';
import {
  IosDistributionType as GraphQLIosDistributionType,
  IosAppBuildCredentialsFragment,
} from '../../../graphql/generated';
import Log from '../../../log';
import { CredentialsContext } from '../../context';
import { AppLookupParams as GraphQLAppLookupParams } from '../api/graphql/types/AppLookupParams';
import { Target } from '../types';

interface Options {
  app: GraphQLAppLookupParams;
  distribution: DistributionType;
  enterpriseProvisioning?: IosEnterpriseProvisioning;
  entitlements: JSONObject;
  target: Target;
}
export class SetUpTargetBuildCredentials {
  constructor(private readonly options: Options) {}

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
    const { app, distribution, enterpriseProvisioning, target } = this.options;
    if (distribution === 'internal') {
      if (enterpriseProvisioning === 'adhoc') {
        return await new SetUpAdhocProvisioningProfile({ app, target }).runAsync(ctx);
      } else if (enterpriseProvisioning === 'universal') {
        return await new SetUpProvisioningProfile(
          app,
          target,
          GraphQLIosDistributionType.Enterprise
        ).runAsync(ctx);
      } else {
        return await new SetUpInternalProvisioningProfile({ app, target }).runAsync(ctx);
      }
    } else {
      return await new SetUpProvisioningProfile(
        app,
        target,
        GraphQLIosDistributionType.AppStore
      ).runAsync(ctx);
    }
  }
}
