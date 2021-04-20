import { EasConfig } from '@expo/eas-json';
import uniq from 'lodash/uniq';

import {
  CommonIosAppCredentialsFragment,
  IosDistributionType as IosDistributionTypeGraphql,
} from '../../graphql/generated';
import { promptAsync } from '../../prompts';
import { Context } from '../context';

export class SelectIosDistributionTypeGraphqlFromBuildProfile {
  constructor(private easConfig: EasConfig) {}
  async runAsync(
    ctx: Context,
    iosAppCredentials: CommonIosAppCredentialsFragment | null
  ): Promise<IosDistributionTypeGraphql> {
    const iosDistributionTypeEasConfig = this.easConfig.builds.ios?.distribution;
    if (!iosDistributionTypeEasConfig) {
      throw new Error(`The distributionType field is required in your iOS build profile`);
    }
    if (iosDistributionTypeEasConfig === 'simulator') {
      throw new Error('A simulator distribution does not require credentials to be configured.');
    } else if (iosDistributionTypeEasConfig === 'store') {
      return IosDistributionTypeGraphql.AppStore;
    } else return this.resolveInternalDistributionAsync(ctx, iosAppCredentials);
  }

  async resolveInternalDistributionAsync(
    ctx: Context,
    iosAppCredentials: CommonIosAppCredentialsFragment | null
  ): Promise<IosDistributionTypeGraphql> {
    // check if the type is specified in eas config
    const maybeEnterpriseProvisioning = this.easConfig.builds.ios?.enterpriseProvisioning;
    if (maybeEnterpriseProvisioning) {
      switch (maybeEnterpriseProvisioning) {
        case 'universal':
          return IosDistributionTypeGraphql.Enterprise;
        case 'adhoc':
          return IosDistributionTypeGraphql.AdHoc;
        default:
          throw new Error(
            `Unsupported Enterprise Provisioning type: ${maybeEnterpriseProvisioning}`
          );
      }
    }

    // only enterprise accounts support enterprise distributions
    const isDefinitelyNotAnEnterpriseAccount = ctx.appStore.authCtx?.team.inHouse === false;
    if (isDefinitelyNotAnEnterpriseAccount) {
      return IosDistributionTypeGraphql.AdHoc;
    }

    // extrapolate type from existing app credentials
    const iosAppBuildCredentialsArray = iosAppCredentials?.iosAppBuildCredentialsArray ?? [];
    const existingInternalIosDistributionTypes = uniq(
      iosAppBuildCredentialsArray
        .map(buildCredentials => buildCredentials.iosDistributionType)
        .filter(
          distributionTypeGraphql =>
            distributionTypeGraphql === IosDistributionTypeGraphql.AdHoc ||
            distributionTypeGraphql === IosDistributionTypeGraphql.Enterprise
        )
    );
    if (existingInternalIosDistributionTypes.length === 1) {
      return existingInternalIosDistributionTypes[0];
    }

    // ask the user as a last resort
    const { iosDistributionTypeGraphql } = await promptAsync({
      type: 'select',
      name: 'iosDistributionTypeGraphql',
      message: 'Which type of internal distribution would you like to configure?',
      choices: [
        {
          value: IosDistributionTypeGraphql.AdHoc,
          title: 'Adhoc: distribution to a small number of test users',
        },
        {
          value: IosDistributionTypeGraphql.Enterprise,
          title:
            'Enterprise: distribution to members of your company. Restricted to Apple Enterprise Accounts.',
        },
      ],
    });
    return iosDistributionTypeGraphql;
  }
}
