import { ExpoConfig } from '@expo/config';
import { IOSConfig } from '@expo/config-plugins';
import { IosDistributionType, IosEnterpriseProvisioning } from '@expo/eas-json';
import plist from '@expo/plist';
import chalk from 'chalk';
import fs from 'fs';
import nullthrows from 'nullthrows';

import {
  IosDistributionType as GraphQLIosDistributionType,
  IosAppBuildCredentialsFragment,
} from '../../../graphql/generated';
import Log from '../../../log';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { AppLookupParams as GraphQLAppLookupParams } from '../api/GraphqlClient';
import { displayProjectCredentials } from '../utils/printCredentials';
import { SetupAdhocProvisioningProfile } from './SetupAdhocProvisioningProfile';
import { SetupInternalProvisioningProfile } from './SetupInternalProvisioningProfile';
import { SetupProvisioningProfile } from './SetupProvisioningProfile';

interface Options {
  app: GraphQLAppLookupParams;
  distribution: IosDistributionType;
  enterpriseProvisioning?: IosEnterpriseProvisioning;
  skipCredentialsCheck?: boolean;
}

interface IosAppBuildCredentials {
  iosDistributionType: GraphQLIosDistributionType;
  provisioningProfile: string;
  distributionCertificate: {
    certificateP12: string;
    certificatePassword: string;
  };
}

function isNativeAssociatedDomainsDefined(projectDir: string): boolean | null {
  try {
    const entitlementsPath = IOSConfig.Paths.getEntitlementsPath(projectDir);
    if (entitlementsPath) {
      const entitlements = plist.parse(fs.readFileSync(entitlementsPath, 'utf8'));
      return !!entitlements['com.apple.developer.associated-domains'];
    }
  } catch {}
  return null;
}

function isAssociatedDomainsDefined(projectDir: string, exp: Pick<ExpoConfig, 'ios'>) {
  // Get the native entitlements file and determine if associated domains is defined in it.
  // If we don't enable this capability xcode will fail to build:
  // error: Provisioning profile "*[expo] com.bacon.myapp AppStore 2021-05-04T22:29:48.816Z" doesn't support the Associated Domains capability.
  let isAssociatedDomainsDefined = isNativeAssociatedDomainsDefined(projectDir);
  if (isAssociatedDomainsDefined == null) {
    // Determine if the app.json has `ios.associatedDomains` or equivalent entitlements field defined.
    isAssociatedDomainsDefined =
      !!exp.ios?.associatedDomains ||
      !!exp.ios?.entitlements?.['com.apple.developer.associated-domains'];
  }
  return isAssociatedDomainsDefined;
}

export class SetupBuildCredentials implements Action<IosAppBuildCredentials> {
  constructor(private options: Options) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<IosAppBuildCredentials> {
    const { app } = this.options;

    await ctx.bestEffortAppStoreAuthenticateAsync();

    if (ctx.appStore.authCtx) {
      const enableAssociatedDomains = isAssociatedDomainsDefined(ctx.projectDir, ctx.exp);
      await ctx.appStore.ensureBundleIdExistsAsync(
        {
          accountName: app.account.name,
          bundleIdentifier: app.bundleIdentifier,
          projectName: app.projectName,
        },
        {
          enablePushNotifications: true,
          enableAssociatedDomains,
        }
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
