import { IosDistributionType as IosDistributionTypeEasConfig } from '@expo/eas-json';
import _ from 'lodash';

import {
  CommonIosAppCredentialsFragment,
  IosDistributionType as IosDistributionTypeGraphql,
} from '../../graphql/generated';
import { promptAsync } from '../../prompts';
import { Context } from '../context';

export class SelectIosDistributionTypeGraphqlFromIosDistributionTypeEasConfig {
  constructor(private iosDistributionTypeEasConfig: IosDistributionTypeEasConfig) {}
  async runAsync(
    ctx: Context,
    iosAppCredentials: CommonIosAppCredentialsFragment | null
  ): Promise<IosDistributionTypeGraphql> {
    if (this.iosDistributionTypeEasConfig === 'store') {
      return IosDistributionTypeGraphql.AppStore;
    } else if (this.iosDistributionTypeEasConfig === 'simulator') {
      return IosDistributionTypeGraphql.Development;
    }
    return this.resolveInternalDistributionAsync(ctx, iosAppCredentials);
  }

  async resolveInternalDistributionAsync(
    ctx: Context,
    iosAppCredentials: CommonIosAppCredentialsFragment | null
  ): Promise<IosDistributionTypeGraphql> {
    const isDefinitelyNotAnEnterpriseAccount = ctx.appStore.authCtx?.team.inHouse === false;
    if (isDefinitelyNotAnEnterpriseAccount) {
      return IosDistributionTypeGraphql.AdHoc;
    }
    const iosAppBuildCredentialsArray = iosAppCredentials?.iosAppBuildCredentialsArray ?? [];
    const existingInternalIosDistributionTypes = _.uniq(
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
